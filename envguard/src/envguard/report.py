"""Terminal presentation for EnvGuard (Rich).

All rendering lives here so parsing/analysis stay presentation-free. Nothing
in this module ever receives an environment *value* — only names, counts,
line numbers and paths — which keeps secrets out of the terminal by
construction.
"""

from __future__ import annotations

from pathlib import Path

from rich.console import Console
from rich.markup import escape
from rich.table import Table
from rich.text import Text

from envguard.analysis import AnalysisReport, Finding
from envguard.envfiles import EnvFile
from envguard.gitcheck import GitExposure
from envguard.sources import SourceScanResult

console = Console()

_SEVERITY_STYLES = {"error": "red", "warning": "yellow", "info": "blue"}
_SEVERITY_LABELS = {"error": "ERROR", "warning": "WARN ", "info": "INFO "}


def print_header(root: Path, title: str) -> None:
    console.print()
    console.print(f"[bold]envguard {title}[/bold] — [cyan]{escape(str(root))}[/cyan]")


def print_env_files(env_files: list[EnvFile]) -> None:
    if not env_files:
        console.print("[yellow]No environment files found (.env and its variants).[/yellow]")
        return
    table = Table(show_header=True, header_style="bold", box=None, padding=(0, 2))
    table.add_column("File", style="cyan")
    table.add_column("Kind")
    table.add_column("Vars", justify="right")
    table.add_column("Notes")
    for env_file in env_files:
        notes: list[str] = []
        if env_file.error:
            notes.append(f"[red]{escape(env_file.error)}[/red]")
        elif env_file.issues:
            notes.append(f"[yellow]{len(env_file.issues)} malformed line(s)[/yellow]")
        if env_file.populated_values and env_file.is_template:
            notes.append(
                f"[yellow]{env_file.populated_values} non-empty value(s) in a template[/yellow]"
            )
        table.add_row(
            escape(env_file.relative_path),
            env_file.kind,
            "-" if env_file.error else str(len(env_file.names)),
            "; ".join(notes),
        )
    console.print(table)


def print_findings(findings: list[Finding]) -> None:
    if not findings:
        console.print("[green]No findings.[/green]")
        return
    order = {"error": 0, "warning": 1, "info": 2}
    for finding in sorted(findings, key=lambda f: (order[f.severity], f.code)):
        style = _SEVERITY_STYLES[finding.severity]
        label = _SEVERITY_LABELS[finding.severity]
        console.print(f"  [{style}]{label}[/{style}] {escape(finding.message)}")
        if finding.hint:
            console.print(f"         [dim]{escape(finding.hint)}[/dim]")


def print_referenced(scan: SourceScanResult) -> None:
    variables = scan.variables
    if not variables:
        return
    console.print(f"\n[bold]Referenced variables[/bold] ({len(variables)}):")
    for name, files in variables.items():
        suffix = f" [dim]({escape(', '.join(files))})[/dim]" if files else ""
        marker = " [magenta]public[/magenta]" if name.startswith("NEXT_PUBLIC_") else ""
        console.print(f"  {escape(name)}{marker}{suffix}")


def print_scan(findings: list[Finding], exposures: list[GitExposure]) -> None:
    if exposures:
        console.print("\n[bold]Git exposure[/bold]")
        state_styles = {
            "tracked": "red",
            "ignored": "green",
            "untracked": "yellow",
            "unknown": "dim",
        }
        for item in exposures:
            style = state_styles.get(item.state, "dim")
            console.print(
                f"  {escape(item.relative_path)}: [{style}]{item.state}[/{style}] — "
                f"{escape(item.detail)}"
            )
    if findings:
        console.print("\n[bold]Findings[/bold]")
        print_findings(findings)


def summary_line(report: AnalysisReport) -> Text:
    errors, warnings, infos = len(report.errors), len(report.warnings), len(report.infos)
    text = Text(f"Summary: {errors} error(s), {warnings} warning(s), {infos} info")
    if errors:
        text.stylize("red")
    elif warnings:
        text.stylize("yellow")
    else:
        text.stylize("green")
    return text


def print_summary(report: AnalysisReport, *, strict: bool = False) -> None:
    console.print()
    console.print(summary_line(report))
    if strict and report.warnings and not report.errors:
        console.print("[dim](--strict: warnings are treated as failures)[/dim]")
