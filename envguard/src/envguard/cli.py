"""EnvGuard command-line interface (Typer).

Exit codes (also used by the individual commands):

* ``0`` — success, no blocking findings.
* ``1`` — findings reported (missing variables, tracked real env file, or
  differences with ``sync`` in dry-run mode). With ``--strict``, warnings
  also fail.
* ``2`` — operational error (bad path, unreadable input, refusal to
  overwrite, missing file, or unsafe target).
"""

from __future__ import annotations

import contextlib
import json
import os
import stat
import tempfile
from pathlib import Path
from typing import Annotated

import typer
from rich.markup import escape

from envguard import __version__
from envguard import report as out
from envguard.analysis import AnalysisReport, Finding, analyze
from envguard.discovery import DiscoveredFile, discover_env_files, discover_source_files
from envguard.envfiles import EnvFile, parse_env_file, pick_real_env, pick_template
from envguard.gitcheck import GitExposure, classify
from envguard.sources import SourceScanResult, scan_sources

EXIT_OK = 0
EXIT_ISSUES = 1
EXIT_ERROR = 2

# JSON output schema version
JSON_SCHEMA_VERSION = "1.0.0"

app = typer.Typer(
    name="envguard",
    help="Inspect environment-variable configuration and prevent configuration mistakes.",
    no_args_is_help=True,
    add_completion=False,
)


def _write_safe_target(path: Path, content: str) -> None:
    """Safely replace a file's content, never following symlinks.

    Creates a temporary file in the same directory and atomically replaces
    the target via os.replace. Uses os.lstat to reject symlinks and
    non-regular files before any write.

    Raises OSError on any unsafe condition or write failure.
    """
    # Reject symlinks and non-regular files BEFORE any write
    try:
        st = os.lstat(path)
    except OSError:
        # File doesn't exist yet — that's fine for creation
        pass
    else:
        if stat.S_ISLNK(st.st_mode):
            raise OSError(f"refusing to write through symlink: {path}")
        if not stat.S_ISREG(st.st_mode):
            raise OSError(f"refusing to write non-regular file: {path}")

    # Atomic write via temp file + os.replace
    dir_path = str(path.parent)
    fd, tmp_path = tempfile.mkstemp(dir=dir_path, prefix=".envguard-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
        os.replace(tmp_path, str(path))
    except BaseException:
        # Clean up temp file on any failure
        with contextlib.suppress(OSError):
            os.unlink(tmp_path)
        raise


def _append_safe_target(path: Path, lines: list[str]) -> None:
    """Safely append lines to a file, never following symlinks.

    Uses os.open with O_NOFOLLOW to ensure we never follow a symlink.
    Verifies the target is a regular file before appending.

    Raises OSError on any unsafe condition or write failure.
    """
    # Reject symlinks and non-regular files BEFORE any write
    try:
        st = os.lstat(path)
    except OSError as exc:
        raise OSError(f"target does not exist: {path}") from exc

    if stat.S_ISLNK(st.st_mode):
        raise OSError(f"refusing to append through symlink: {path}")
    if not stat.S_ISREG(st.st_mode):
        raise OSError(f"refusing to append to non-regular file: {path}")

    # Open with O_NOFOLLOW to prevent any TOCTOU race
    try:
        fd = os.open(
            str(path),
            os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW,
            0o644,
        )
    except OSError as exc:
        raise OSError(f"could not open target safely: {path}") from exc

    try:
        with os.fdopen(fd, "a", encoding="utf-8") as handle:
            for line in lines:
                handle.write(line)
    except BaseException:
        # fdopen closes the fd on error, but be safe
        with contextlib.suppress(OSError):
            os.close(fd)
        raise


def _is_template_target(target_name: str) -> bool:
    """True when a target file name looks like a template."""
    return target_name.startswith(".env") and any(
        suffix in target_name for suffix in (".example", ".sample", ".template", ".dist")
    )


def _exists_and_is_regular(path: Path) -> bool:
    """True if path exists and is a regular file (no symlink follow)."""
    try:
        st = os.lstat(path)
    except OSError:
        return False
    return stat.S_ISREG(st.st_mode)


def _version_callback(value: bool) -> None:
    if value:
        out.console.print(f"envguard {__version__}")
        raise typer.Exit(EXIT_OK)


def _fail(message: str) -> None:
    out.console.print(f"[red]error:[/red] {escape(message)}")
    raise typer.Exit(EXIT_ERROR)


def _to_json_output(
    report: AnalysisReport,
    env_files: list[EnvFile],
    scan: SourceScanResult,
    root: Path,
) -> dict[str, object]:
    """Convert analysis results to JSON-safe dictionary.

    Never includes environment values, absolute paths, or sensitive data.
    Paths are relative to the project root.
    """
    findings_json: list[dict[str, object]] = []
    for finding in report.findings:
        finding_dict: dict[str, object] = {
            "code": finding.code,
            "severity": finding.severity,
            "message": finding.message,
        }
        if finding.hint:
            finding_dict["hint"] = finding.hint

        # Extract file and variable context where applicable
        message = finding.message
        if "referenced in code but missing from" in message:
            # Extract variable names from message
            parts = message.split(":", 1)
            if len(parts) == 2:
                vars_part = parts[1].strip()
                variables = [v.strip() for v in vars_part.split(",")]
                finding_dict["variables"] = variables
        elif "not defined in" in message or "missing from" in message:
            # Extract file reference
            for _i, part in enumerate(message.split()):
                if part.startswith("."):
                    finding_dict["file"] = part.rstrip(":")
                    break

        findings_json.append(finding_dict)

    return {
        "schema_version": JSON_SCHEMA_VERSION,
        "tool": "envguard",
        "version": __version__,
        "status": "error" if report.errors else ("warning" if report.warnings else "ok"),
        "summary": {
            "errors": len(report.errors),
            "warnings": len(report.warnings),
            "info": len(report.infos),
        },
        "findings": findings_json,
        "referenced_variables": [
            {"name": name, "files": files} for name, files in sorted(report.referenced.items())
        ],
        "env_files": [
            {
                "path": f.relative_path,
                "kind": f.kind,
                "variables": len(f.names),
                "notes": [
                    f.error
                    if f.error
                    else (
                        f"malformed: {len(f.issues)} line(s)"
                        if f.issues
                        else (
                            f"non-empty values: {f.populated_values}"
                            if f.populated_values and f.is_template
                            else ""
                        )
                    )
                ],
            }
            for f in env_files
            if f.relative_path  # skip any with empty paths
        ],
        "skipped_sources": [{"path": path, "reason": reason} for path, reason in scan.skipped],
    }


def _resolve_root(path: Path) -> Path:
    root = path.expanduser().resolve()
    if not root.exists():
        _fail(f"path does not exist: {path}")
    if not root.is_dir():
        _fail(f"not a directory: {path}")
    return root


def _check_exit(report: AnalysisReport, strict: bool) -> None:
    if report.errors:
        raise typer.Exit(EXIT_ISSUES)
    if strict and report.warnings:
        raise typer.Exit(EXIT_ISSUES)
    raise typer.Exit(EXIT_OK)


def _load_env_files(root: Path) -> list[EnvFile]:
    return [parse_env_file(d) for d in discover_env_files(root)]


def _run_analysis(root: Path) -> tuple[list[EnvFile], SourceScanResult, AnalysisReport]:
    env_files = _load_env_files(root)
    template = pick_template(env_files)
    real_env = pick_real_env(env_files)
    scan = scan_sources(discover_source_files(root))
    report = analyze(scan, template, real_env)
    return env_files, scan, report


def _scan_findings(env_files: list[EnvFile], exposures: list[GitExposure]) -> list[Finding]:
    """Security findings for `scan`/`doctor`, based on files and Git states."""
    findings: list[Finding] = []
    by_path = {item.relative_path: item for item in exposures}
    for env_file in env_files:
        if env_file.error:
            continue
        exposure = by_path.get(env_file.relative_path)
        if not env_file.is_template:
            if exposure is None or exposure.state == "unknown":
                detail = exposure.detail if exposure else "Git checks were skipped"
                findings.append(
                    Finding(
                        severity="warning",
                        code="env-file-state-unknown",
                        message=f"Could not verify the Git state of "
                        f"{env_file.relative_path}: {detail}.",
                        hint="Do not assume this file is safe — check it manually.",
                    )
                )
            elif exposure.state == "tracked":
                findings.append(
                    Finding(
                        severity="error",
                        code="env-file-tracked",
                        message=f"{env_file.relative_path} is tracked by Git. A real "
                        "environment file must never be committed.",
                        hint="Remove it from the index (`git rm --cached <file>`), "
                        "rotate every secret it contained, and add it to .gitignore.",
                    )
                )
            elif exposure.state == "untracked":
                findings.append(
                    Finding(
                        severity="warning",
                        code="env-file-not-ignored",
                        message=f"{env_file.relative_path} exists locally but is not "
                        "ignored by .gitignore.",
                        hint="Add it to .gitignore so it cannot be committed by accident.",
                    )
                )
        elif env_file.populated_values:
            findings.append(
                Finding(
                    severity="warning",
                    code="template-populated",
                    message=f"{env_file.relative_path} contains "
                    f"{env_file.populated_values} non-empty value(s); templates should "
                    "hold keys only.",
                    hint="Replace values with placeholders (values are never printed by EnvGuard).",
                )
            )
        public = [n for n in env_file.names if n.startswith("NEXT_PUBLIC_")]
        if public and not env_file.is_template:
            findings.append(
                Finding(
                    severity="info",
                    code="public-vars-in-env",
                    message=f"{env_file.relative_path} defines browser-exposed "
                    f"variable(s): {', '.join(sorted(public))}.",
                    hint="NEXT_PUBLIC_* values ship to every visitor; never store "
                    "secrets under that prefix.",
                )
            )
    return findings


@app.callback()
def main(
    version: Annotated[
        bool,
        typer.Option(
            "--version",
            "-V",
            callback=_version_callback,
            is_eager=True,
            help="Show the version and exit.",
        ),
    ] = False,
) -> None:
    """EnvGuard — local-first environment-configuration inspection."""


@app.command()
def check(
    path: Annotated[
        Path,
        typer.Argument(help="Project directory to inspect.", exists=True, file_okay=False),
    ] = Path("."),
    strict: Annotated[
        bool, typer.Option("--strict", help="Exit non-zero on warnings as well as errors.")
    ] = False,
    json_output: Annotated[
        bool, typer.Option("--json", help="Output results as machine-readable JSON to stdout.")
    ] = False,
) -> None:
    """Detect missing variables and configuration inconsistencies."""
    root = _resolve_root(path)
    env_files, scan, report = _run_analysis(root)

    if json_output:
        # JSON mode: produce single JSON document on stdout, no Rich markup
        json_data = _to_json_output(report, env_files, scan, root)
        out.console.file.write(json.dumps(json_data, indent=2))
        out.console.file.write("\n")
        out.console.file.flush()
        _check_exit(report, strict)
        return

    out.print_header(root, "check")
    out.print_env_files(env_files)
    out.print_referenced(scan)
    out.console.print("\n[bold]Findings[/bold]")
    out.print_findings(report.findings)
    out.print_summary(report, strict=strict)
    _check_exit(report, strict)


@app.command()
def init(
    path: Annotated[
        Path,
        typer.Argument(help="Project directory to initialize.", exists=True, file_okay=False),
    ] = Path("."),
    output: Annotated[
        str, typer.Option("--output", "-o", help="Template file name to create.")
    ] = ".env.example",
    force: Annotated[
        bool, typer.Option("--force", "-f", help="Overwrite an existing template file.")
    ] = False,
) -> None:
    """Create a sample environment file from safely discovered names."""
    root = _resolve_root(path)
    out.print_header(root, "init")
    if Path(output).name != output or output in {".", ".."}:
        _fail("--output must be a plain file name inside the project (e.g. .env.example)")

    target = root / output
    if _exists_and_is_regular(target) and not force:
        _fail(f"{output} already exists; use --force to overwrite it")

    env_files = _load_env_files(root)
    names: set[str] = set()
    for env_file in env_files:
        names |= env_file.name_set
    scan = scan_sources(discover_source_files(root))
    names |= set(scan.variables)

    if not names:
        out.console.print(
            "[yellow]No variable names discovered in source or existing "
            "environment files; nothing was written.[/yellow]"
        )
        raise typer.Exit(EXIT_OK)

    content = "".join(f"{name}=\n" for name in sorted(names))
    try:
        _write_safe_target(target, content)
    except OSError as exc:
        _fail(f"could not write {output}: {exc.strerror or exc}")
    out.console.print(f"[green]Created[/green] {escape(output)} with {len(names)} name(s):")
    for name in sorted(names):
        out.console.print(f"  {name}=")
    out.console.print(
        "[dim]Values are intentionally left empty — fill them in locally and "
        "never commit a real .env file.[/dim]"
    )
    raise typer.Exit(EXIT_OK)


@app.command()
def sync(
    path: Annotated[
        Path,
        typer.Argument(help="Project directory to inspect.", exists=True, file_okay=False),
    ] = Path("."),
    source: Annotated[
        str, typer.Option("--source", help="Environment file to read variable names from.")
    ] = ".env",
    target: Annotated[
        str, typer.Option("--target", help="Template file to compare and update.")
    ] = ".env.example",
    apply: Annotated[
        bool,
        typer.Option(
            "--apply",
            help="Append missing names to the target (never touches the source).",
        ),
    ] = False,
) -> None:
    """Compare environment files and propose safe synchronization (dry-run by default)."""
    root = _resolve_root(path)
    out.print_header(root, "sync")
    for label, name in (("--source", source), ("--target", target)):
        if Path(name).name != name or name in {".", ".."}:
            _fail(f"{label} must be a plain file name inside the project")
    if source == target:
        _fail("--source and --target must be different files")

    src_path, dst_path = root / source, root / target

    # F-02: validate target is a template BEFORE checking existence
    # This prevents accidentally targeting a real .env file
    if not _is_template_target(target):
        _fail(
            f"--target must be a template file (e.g. .env.example, .env.sample); "
            f"{target} does not look like a template. "
            "This prevents accidentally modifying a real environment file."
        )

    if not _exists_and_is_regular(src_path):
        _fail(f"{source} not found or not a regular file; create it first (e.g. `envguard init`)")
    if not _exists_and_is_regular(dst_path):
        _fail(f"{target} not found or not a regular file; create it first (e.g. `envguard init`)")

    src = parse_env_file(DiscoveredFile(path=src_path, relative_path=source))
    dst = parse_env_file(DiscoveredFile(path=dst_path, relative_path=target))
    if src.error:
        _fail(f"could not read {source}: {src.error}")
    if dst.error:
        _fail(f"could not read {target}: {dst.error}")

    missing = [name for name in src.names if name not in dst.name_set]
    extra = sorted(dst.name_set - set(src.names))
    out.console.print(
        f"Compared [cyan]{escape(source)}[/cyan] ({len(src.names)} names) → "
        f"[cyan]{escape(target)}[/cyan] ({len(dst.names)} names)"
    )

    if extra:
        out.console.print(
            f"  [dim]only in {escape(target)} ({len(extra)}): {escape(', '.join(extra))}[/dim]"
        )
    if not missing:
        out.console.print(
            f"[green]{escape(target)} already covers every name in {escape(source)}.[/green]"
        )
        raise typer.Exit(EXIT_OK)

    out.console.print(f"\n[bold]Proposed additions to {escape(target)}[/bold] ({len(missing)}):")
    for name in missing:
        out.console.print(f"  {name}=")

    if not apply:
        out.console.print(
            "\n[yellow]Dry run:[/yellow] no file was modified. "
            "Re-run with [bold]--apply[/bold] to append these names."
        )
        raise typer.Exit(EXIT_ISSUES)

    try:
        # Build the lines to append (including trailing newline fix)
        lines_to_write: list[str] = []
        if dst_path.stat().st_size and not dst_path.read_bytes().endswith(b"\n"):
            lines_to_write.append("\n")
        for name in missing:
            lines_to_write.append(f"{name}=\n")
        _append_safe_target(dst_path, lines_to_write)
    except OSError as exc:
        _fail(f"could not write {target}: {exc.strerror or exc}")

    out.console.print(f"[green]Appended {len(missing)} name(s) to {escape(target)}.[/green]")
    out.console.print("[dim]The source file was not modified.[/dim]")
    raise typer.Exit(EXIT_OK)


@app.command()
def scan(
    path: Annotated[
        Path,
        typer.Argument(help="Project directory to inspect.", exists=True, file_okay=False),
    ] = Path("."),
    strict: Annotated[
        bool, typer.Option("--strict", help="Exit non-zero on warnings as well as errors.")
    ] = False,
    no_git: Annotated[bool, typer.Option("--no-git", help="Skip Git exposure checks.")] = False,
) -> None:
    """Inspect environment files and Git configuration for secret exposure."""
    root = _resolve_root(path)
    out.print_header(root, "scan")
    env_files = _load_env_files(root)

    exposures: list[GitExposure] = []
    if no_git:
        out.console.print("[dim]Git exposure checks skipped (--no-git).[/dim]")
    else:
        exposures = classify(root, [f.relative_path for f in env_files])

    findings = _scan_findings(env_files, exposures)
    report = AnalysisReport(findings=findings)

    out.print_env_files(env_files)
    out.print_scan(findings, exposures)
    out.print_summary(report, strict=strict)
    _check_exit(report, strict)


@app.command()
def doctor(
    path: Annotated[
        Path,
        typer.Argument(help="Project directory to diagnose.", exists=True, file_okay=False),
    ] = Path("."),
    strict: Annotated[
        bool, typer.Option("--strict", help="Exit non-zero on warnings as well as errors.")
    ] = False,
) -> None:
    """Print a concise overall configuration-health report."""
    root = _resolve_root(path)
    out.print_header(root, "doctor")
    env_files, _scan, analysis = _run_analysis(root)
    exposures = classify(root, [f.relative_path for f in env_files])
    scan_findings = _scan_findings(env_files, exposures)

    report = AnalysisReport(
        findings=analysis.findings + scan_findings,
        referenced=analysis.referenced,
        template=analysis.template,
        real_env=analysis.real_env,
    )

    out.print_env_files(env_files)
    out.print_scan([], exposures)  # git exposure only; findings are printed once below
    out.console.print("\n[bold]Configuration health[/bold]")
    out.print_findings(report.findings)
    out.print_summary(report, strict=strict)

    if report.errors:
        out.console.print("[red]Verdict: UNSAFE configuration — fix the errors above.[/red]")
    elif report.warnings:
        out.console.print("[yellow]Verdict: configuration needs attention.[/yellow]")
    else:
        out.console.print("[green]Verdict: configuration looks healthy.[/green]")
    _check_exit(report, strict)


def main_cli() -> None:  # pragma: no cover - thin alias
    app()


if __name__ == "__main__":  # pragma: no cover
    main_cli()
