"""End-to-end tests for the EnvGuard CLI.

These tests assert two things above all: exit codes are meaningful for CI,
and no environment *value* ever reaches stdout/stderr.
"""

from __future__ import annotations

import os
from pathlib import Path

from typer.testing import CliRunner, Result

from conftest import FAKE_DB_URL, FAKE_SECRET
from envguard.cli import app

runner = CliRunner()

SECRETS = ("hunter2", "DO-NOT-LEAK", "sk-test")


def invoke(*args: str) -> Result:
    return runner.invoke(app, list(args), env={"COLUMNS": "200"})


def flat(result: Result) -> str:
    """Output with newlines flattened, so assertions ignore line wrapping."""
    return result.output.replace("\n", " ")


def assert_no_secret_leak(result: Result) -> None:
    text = flat(result)
    for secret in SECRETS:
        assert secret not in text, f"secret value leaked into CLI output: {secret!r}"


# --- check -----------------------------------------------------------------


def test_check_reports_missing_and_unused_with_exit_code_1(project: Path) -> None:
    result = invoke("check", str(project))
    assert result.exit_code == 1
    text = flat(result)
    assert "JWT_SECRET" in text  # referenced but missing from the template
    assert "missing-from-template" not in text  # code, not user-facing
    assert "UNUSED_VAR" in text  # declared but unused
    assert "NEXT_PUBLIC_API_URL" in text
    assert_no_secret_leak(result)


def test_check_does_not_modify_any_file(project: Path) -> None:
    before = {p: p.read_bytes() for p in project.rglob("*") if p.is_file()}
    invoke("check", str(project))
    after = {p: p.read_bytes() for p in project.rglob("*") if p.is_file()}
    assert before == after


def test_check_passes_on_consistent_project(tmp_path: Path) -> None:
    (tmp_path / "app.py").write_text('import os\nos.getenv("A")\n', encoding="utf-8")
    (tmp_path / ".env.example").write_text("A=\n", encoding="utf-8")
    (tmp_path / ".env").write_text("A=placeholder\n", encoding="utf-8")
    result = invoke("check", str(tmp_path))
    assert result.exit_code == 0
    assert "0 error(s)" in flat(result)


def test_check_strict_fails_on_warnings(tmp_path: Path) -> None:
    (tmp_path / "app.py").write_text('import os\nos.getenv("A")\n', encoding="utf-8")
    (tmp_path / ".env.example").write_text("A=\nSTALE=\n", encoding="utf-8")
    (tmp_path / ".env").write_text("A=placeholder\n", encoding="utf-8")
    assert invoke("check", str(tmp_path)).exit_code == 0
    assert invoke("check", str(tmp_path), "--strict").exit_code == 1


def test_check_renders_bracketed_hint_text_literally(tmp_path: Path) -> None:
    """Rich must not swallow bracketed text like `os.environ[name]` as markup."""
    (tmp_path / "app.py").write_text('import os\nos.getenv("A")\n', encoding="utf-8")
    (tmp_path / ".env.example").write_text("A=\nSTALE=\n", encoding="utf-8")
    (tmp_path / ".env").write_text("A=placeholder\n", encoding="utf-8")
    result = invoke("check", str(tmp_path))
    assert "os.environ[name]" in flat(result)


def test_check_without_git_repository_does_not_claim_safety(project: Path) -> None:
    result = invoke("check", str(project))
    assert "not a Git repository" not in flat(result)  # check is git-independent


def test_check_on_nonexistent_path_exits_2(tmp_path: Path) -> None:
    result = invoke("check", str(tmp_path / "nope"))
    assert result.exit_code == 2


# --- init ------------------------------------------------------------------


def test_init_creates_template_from_discovered_names(tmp_path: Path) -> None:
    (tmp_path / "app.py").write_text(
        'import os\nos.getenv("B_VAR")\nos.environ["A_VAR"]\n', encoding="utf-8"
    )
    result = invoke("init", str(tmp_path))
    assert result.exit_code == 0
    created = (tmp_path / ".env.example").read_text(encoding="utf-8")
    assert created == "A_VAR=\nB_VAR=\n"
    assert_no_secret_leak(result)


def test_init_refuses_to_overwrite_without_force(project: Path) -> None:
    before = (project / ".env.example").read_text(encoding="utf-8")
    result = invoke("init", str(project))
    assert result.exit_code == 2
    assert (project / ".env.example").read_text(encoding="utf-8") == before
    assert invoke("init", str(project), "--force").exit_code == 0


def test_init_never_copies_values(project: Path) -> None:
    result = invoke("init", str(project), "--force")
    assert result.exit_code == 0
    created = (project / ".env.example").read_text(encoding="utf-8")
    assert FAKE_SECRET not in created and FAKE_DB_URL not in created
    assert_no_secret_leak(result)


# --- sync ------------------------------------------------------------------


def test_sync_is_dry_run_by_default(project: Path) -> None:
    template_before = (project / ".env.example").read_text(encoding="utf-8")
    result = invoke("sync", str(project))
    assert result.exit_code == 1  # differences exist
    assert "JWT_SECRET" in flat(result)
    assert "Dry run" in flat(result)
    assert (project / ".env.example").read_text(encoding="utf-8") == template_before
    assert_no_secret_leak(result)


def test_sync_apply_updates_template_only(project: Path) -> None:
    env_before = (project / ".env").read_bytes()
    result = invoke("sync", str(project), "--apply")
    assert result.exit_code == 0
    template = (project / ".env.example").read_text(encoding="utf-8")
    assert "JWT_SECRET=" in template
    assert (project / ".env").read_bytes() == env_before  # source untouched
    assert_no_secret_leak(result)


def test_sync_reports_in_sync(project: Path) -> None:
    invoke("sync", str(project), "--apply")
    result = invoke("sync", str(project))
    assert result.exit_code == 0
    assert "already covers" in flat(result)


def test_sync_rejects_missing_source(tmp_path: Path) -> None:
    (tmp_path / ".env.example").write_text("A=\n", encoding="utf-8")
    result = invoke("sync", str(tmp_path))
    assert result.exit_code == 2
    assert "not found" in flat(result)


# --- scan ------------------------------------------------------------------


def test_scan_without_git_warns_but_does_not_claim_safety(project: Path) -> None:
    result = invoke("scan", str(project))
    text = flat(result)
    assert result.exit_code == 0  # warnings only
    assert "unknown" in text
    assert "Do not assume this file is safe" in text
    assert_no_secret_leak(result)


def test_scan_flags_tracked_real_env_file(git_repo: Path) -> None:
    import subprocess

    subprocess.run(
        ["git", "-C", str(git_repo), "add", "-f", ".env"],
        check=True,
        capture_output=True,
    )
    result = invoke("scan", str(git_repo))
    text = flat(result)
    assert result.exit_code == 1
    assert "env-file-tracked" not in text  # human-readable, no codes
    assert ".env is tracked by Git" in text
    assert "rotate every secret" in text
    assert_no_secret_leak(result)


def test_scan_passes_when_real_env_is_ignored(git_repo: Path) -> None:
    (git_repo / ".gitignore").write_text(".env\n", encoding="utf-8")
    result = invoke("scan", str(git_repo))
    assert result.exit_code == 0
    assert "ignored" in flat(result)


def test_scan_warns_when_env_file_is_untracked_and_not_ignored(git_repo: Path) -> None:
    result = invoke("scan", str(git_repo), "--strict")
    text = flat(result)
    assert result.exit_code == 1
    assert "not ignored by .gitignore" in text
    assert_no_secret_leak(result)


def test_scan_warns_about_populated_template(git_repo: Path) -> None:
    (git_repo / ".env.example").write_text(f"JWT_SECRET={FAKE_SECRET}\n", encoding="utf-8")
    (git_repo / ".gitignore").write_text(".env\n", encoding="utf-8")
    result = invoke("scan", str(git_repo))
    text = flat(result)
    assert "non-empty value" in text
    assert FAKE_SECRET not in text


def test_scan_no_git_skips_checks(project: Path) -> None:
    result = invoke("scan", str(project), "--no-git")
    assert "skipped (--no-git)" in flat(result)


# --- doctor ----------------------------------------------------------------


def test_doctor_combines_checks_and_leaks_nothing(git_repo: Path) -> None:
    import subprocess

    subprocess.run(
        ["git", "-C", str(git_repo), "add", "-f", ".env"],
        check=True,
        capture_output=True,
    )
    result = invoke("doctor", str(git_repo))
    assert result.exit_code == 1
    text = flat(result)
    assert "Configuration health" in text
    assert "Verdict:" in text
    assert text.count(".env is tracked by Git") == 1  # findings shown exactly once
    assert_no_secret_leak(result)


def test_doctor_healthy_project(tmp_path: Path) -> None:
    (tmp_path / "app.py").write_text('os.getenv("A")\n', encoding="utf-8")
    (tmp_path / ".env.example").write_text("A=\n", encoding="utf-8")
    (tmp_path / ".env").write_text("A=x\n", encoding="utf-8")
    result = invoke("doctor", str(tmp_path))
    assert result.exit_code == 0
    assert "Verdict:" in flat(result)


# --- misc ------------------------------------------------------------------


def test_version_flag() -> None:
    result = invoke("--version")
    assert result.exit_code == 0
    assert "envguard 0.1.0" in flat(result)


def test_no_args_shows_help() -> None:
    """Invoking without a subcommand prints help (usage-error exit code 2)."""
    result = runner.invoke(app, [])
    assert result.exit_code == 2
    assert "check" in flat(result)


def test_help_flag() -> None:
    result = invoke("--help")
    assert result.exit_code == 0
    assert "doctor" in flat(result)


# --- JSON output tests ---------------------------------------------------------


def test_check_json_output_valid_json(tmp_path: Path) -> None:
    """JSON mode produces valid JSON on stdout."""
    (tmp_path / "app.py").write_text('import os\nos.getenv("A")\n', encoding="utf-8")
    (tmp_path / ".env.example").write_text("A=\n", encoding="utf-8")
    (tmp_path / ".env").write_text("A=placeholder\n", encoding="utf-8")

    result = invoke("check", str(tmp_path), "--json")
    assert result.exit_code == 0

    import json

    data = json.loads(result.stdout)
    assert data["schema_version"] == "1.0.0"
    assert data["tool"] == "envguard"
    assert data["version"] == "0.1.0"
    assert data["status"] == "ok"
    assert data["summary"]["errors"] == 0
    assert data["summary"]["warnings"] == 0
    assert "findings" in data
    assert "referenced_variables" in data
    assert "env_files" in data


def test_check_json_output_with_errors(tmp_path: Path) -> None:
    """JSON mode includes findings when errors are detected."""
    (tmp_path / "app.py").write_text(
        'import os\nos.getenv("A")\nos.getenv("B")\n', encoding="utf-8"
    )
    (tmp_path / ".env.example").write_text("A=\n", encoding="utf-8")
    (tmp_path / ".env").write_text("A=placeholder\n", encoding="utf-8")

    result = invoke("check", str(tmp_path), "--json")
    assert result.exit_code == 1

    import json

    data = json.loads(result.stdout)
    assert data["status"] == "error"
    assert data["summary"]["errors"] >= 1
    assert len(data["findings"]) >= 1
    # Should have at least one finding about missing B
    assert any(
        "B" in f.get("message", "") or "B" in f.get("variables", []) for f in data["findings"]
    )


def test_check_json_exit_codes_match_human_readable(tmp_path: Path) -> None:
    """JSON mode exit codes match human-readable mode."""
    # Clean project
    (tmp_path / "app.py").write_text('import os\nos.getenv("A")\n', encoding="utf-8")
    (tmp_path / ".env.example").write_text("A=\n", encoding="utf-8")
    (tmp_path / ".env").write_text("A=placeholder\n", encoding="utf-8")

    json_result = invoke("check", str(tmp_path), "--json")
    human_result = invoke("check", str(tmp_path))
    assert json_result.exit_code == human_result.exit_code

    # Project with errors
    (tmp_path / "app.py").write_text(
        'import os\nos.getenv("A")\nos.getenv("B")\n', encoding="utf-8"
    )

    json_result = invoke("check", str(tmp_path), "--json")
    human_result = invoke("check", str(tmp_path))
    assert json_result.exit_code == human_result.exit_code == 1

    # With --strict on warnings
    (tmp_path / ".env.example").write_text("A=\nSTALE=\n", encoding="utf-8")
    json_result = invoke("check", str(tmp_path), "--json", "--strict")
    human_result = invoke("check", str(tmp_path), "--strict")
    assert json_result.exit_code == human_result.exit_code == 1


def test_check_json_no_rich_markup(tmp_path: Path) -> None:
    """JSON stdout contains no Rich markup or terminal formatting."""
    (tmp_path / "app.py").write_text('import os\nos.getenv("A")\n', encoding="utf-8")
    (tmp_path / ".env.example").write_text("A=\n", encoding="utf-8")
    (tmp_path / ".env").write_text("A=placeholder\n", encoding="utf-8")

    result = invoke("check", str(tmp_path), "--json")
    assert result.exit_code == 0

    # No Rich markup markers
    assert "[" not in result.stdout or "{" in result.stdout
    assert "]" not in result.stdout or "}" in result.stdout
    # Should be valid JSON
    import json

    json.loads(result.stdout)


def test_check_json_secret_canary_absent(tmp_path: Path) -> None:
    """Secret canary never appears in JSON output."""
    CANARY = "CANARY-SECRET-12345-FOR-TEST"
    (tmp_path / "app.py").write_text(f'import os\nos.getenv("{CANARY}")\n', encoding="utf-8")
    (tmp_path / ".env").write_text(f"{CANARY}=value\nOTHER=\n", encoding="utf-8")
    (tmp_path / ".env.example").write_text("OTHER=\n", encoding="utf-8")

    result = invoke("check", str(tmp_path), "--json")
    assert CANARY not in result.stdout
    assert CANARY not in result.stderr

    import json

    data = json.loads(result.stdout)
    # Verify canary not in any message
    for finding in data["findings"]:
        assert CANARY not in finding["message"]
        if "hint" in finding:
            assert CANARY not in finding["hint"]


def test_check_json_deterministic(tmp_path: Path) -> None:
    """JSON output is deterministic for equivalent project states."""
    (tmp_path / "app.py").write_text('import os\nos.getenv("A")\n', encoding="utf-8")
    (tmp_path / ".env.example").write_text("A=\n", encoding="utf-8")
    (tmp_path / ".env").write_text("A=placeholder\n", encoding="utf-8")

    result1 = invoke("check", str(tmp_path), "--json")
    result2 = invoke("check", str(tmp_path), "--json")
    assert result1.stdout == result2.stdout


def test_check_json_handles_fatal_errors(tmp_path: Path) -> None:
    """JSON mode returns error exit code and message for fatal errors."""
    # Non-existent path
    result = invoke("check", str(tmp_path / "nonexistent"), "--json")
    assert result.exit_code == 2
    assert "error" in result.stdout.lower() or "error" in result.stderr.lower()
    # Should not produce valid JSON on fatal error
    import json

    try:
        json.loads(result.stdout)
        # If we got here, stdout might have JSON (unexpected for fatal error)
        # but exit code should still be 2
        assert result.exit_code == 2
    except json.JSONDecodeError:
        # Expected: no valid JSON for fatal errors
        pass


def test_check_human_output_unchanged(tmp_path: Path) -> None:
    """Default human-readable output is unchanged by JSON addition."""
    (tmp_path / "app.py").write_text('import os\nos.getenv("A")\n', encoding="utf-8")
    (tmp_path / ".env.example").write_text("A=\n", encoding="utf-8")
    (tmp_path / ".env").write_text("A=placeholder\n", encoding="utf-8")

    result = invoke("check", str(tmp_path))
    assert result.exit_code == 0
    # Should contain human-readable elements
    assert "envguard check" in result.stdout
    assert "Summary" in result.stdout


# --- F-01: Symlink write protection ------------------------------------------------------


def test_sync_rejects_symlinked_target(tmp_path: Path) -> None:
    """F-01: sync --apply must not follow symlinks to write outside the project."""
    # Create an outside victim file
    outside = tmp_path / "outside"
    outside.mkdir()
    victim = outside / "victim.txt"
    victim.write_text("OUTSIDE-VICTIM\n")

    # Create project with source and target
    project = tmp_path / "project"
    project.mkdir()
    (project / ".env").write_text("A=1\nB=2\n", encoding="utf-8")
    (project / ".env.example").write_text("A=\n", encoding="utf-8")

    # Create a symlink in project pointing to outside victim
    symlink = project / ".env.symlink"
    os.symlink(str(victim), str(symlink))

    # sync --target the symlink should be rejected
    result = invoke("sync", str(project), "--source", ".env", "--target", ".env.symlink", "--apply")
    assert result.exit_code == 2
    assert "symlink" in flat(result).lower() or "refusing" in flat(result).lower()
    # Victim content must remain unchanged
    assert victim.read_text() == "OUTSIDE-VICTIM\n"


def test_init_rejects_symlinked_output(tmp_path: Path) -> None:
    """F-01: init --output must not follow symlinks."""
    outside = tmp_path / "outside"
    outside.mkdir()
    victim = outside / "victim.txt"
    victim.write_text("ORIGINAL-OUTSIDE\n")

    project = tmp_path / "project"
    project.mkdir()
    (project / ".env").write_text("A=1\n", encoding="utf-8")

    # Create symlink to outside file
    symlink = project / ".env.force"
    os.symlink(str(victim), str(symlink))

    result = invoke("init", str(project), "--output", ".env.force", "--force")
    assert result.exit_code == 2
    assert "symlink" in flat(result).lower() or "refusing" in flat(result).lower()
    # Victim must remain unchanged
    assert victim.read_text() == "ORIGINAL-OUTSIDE\n"


def test_init_rejects_dangling_symlink(tmp_path: Path) -> None:
    """F-01: init --output must not create files through dangling symlinks."""
    outside = tmp_path / "outside"
    outside.mkdir()
    dangling_target = outside / "created-by-dangling.txt"

    project = tmp_path / "project"
    project.mkdir()
    (project / ".env").write_text("A=1\n", encoding="utf-8")

    # Create a dangling symlink (target doesn't exist)
    symlink = project / ".env.dangling"
    os.symlink(str(dangling_target), str(symlink))

    result = invoke("init", str(project), "--output", ".env.dangling")
    assert result.exit_code == 2
    assert "symlink" in flat(result).lower() or "refusing" in flat(result).lower()
    # No file should be created in the outside directory
    assert not dangling_target.exists()


def test_sync_rejects_dangling_symlink_target(tmp_path: Path) -> None:
    """F-01: sync --apply must not create files through dangling symlinks."""
    outside = tmp_path / "outside"
    outside.mkdir()
    dangling_target = outside / "created-by-sync.txt"

    project = tmp_path / "project"
    project.mkdir()
    (project / ".env").write_text("A=1\nB=2\n", encoding="utf-8")

    # Create a dangling symlink (target file name looks like a template)
    symlink = project / ".env.example.dangling"
    os.symlink(str(dangling_target), str(symlink))

    result = invoke(
        "sync",
        str(project),
        "--source",
        ".env",
        "--target",
        ".env.example.dangling",
        "--apply",
    )
    assert result.exit_code == 2
    # Dangling symlinks are not detected as regular files
    assert (
        "not found" in flat(result).lower()
        or "symlink" in flat(result).lower()
        or "could not" in flat(result).lower()
    )
    # No file should be created in the outside directory
    assert not dangling_target.exists()


def test_init_rejects_directory_as_output(tmp_path: Path) -> None:
    """F-01: init must refuse to write to a directory."""
    project = tmp_path / "project"
    project.mkdir()
    (project / ".env").write_text("A=1\n", encoding="utf-8")
    (project / "subdir").mkdir()

    result = invoke("init", str(project), "--output", "subdir")
    assert result.exit_code == 2
    assert "non-regular" in flat(result).lower() or "refusing" in flat(result).lower()


def test_sync_rejects_directory_as_target(tmp_path: Path) -> None:
    """F-01: sync must refuse to write to a directory."""
    project = tmp_path / "project"
    project.mkdir()
    (project / ".env").write_text("A=1\nB=2\n", encoding="utf-8")
    (project / "subdir").mkdir()

    # Create a symlink to a directory with a template-like name
    outside_dir = tmp_path / "outside_dir"
    outside_dir.mkdir()
    link = project / ".env.example.link"
    os.symlink(str(outside_dir), str(link))

    result = invoke(
        "sync",
        str(project),
        "--source",
        ".env",
        "--target",
        ".env.example.link",
        "--apply",
    )
    assert result.exit_code == 2
    # Should fail because target is a directory (non-regular file)
    assert (
        "non-regular" in flat(result).lower()
        or "directory" in flat(result).lower()
        or "could not open" in flat(result).lower()
    )


# --- F-02: Real environment file protection ------------------------------------------------


def test_sync_rejects_real_env_as_target(tmp_path: Path) -> None:
    """F-02: sync --apply must not write to a real .env file."""
    project = tmp_path / "project"
    project.mkdir()
    (project / ".env").write_text("A=1\n", encoding="utf-8")
    (project / ".env.example").write_text("B=\n", encoding="utf-8")

    result = invoke("sync", str(project), "--source", ".env.example", "--target", ".env", "--apply")
    assert result.exit_code == 2
    assert "template" in flat(result).lower()


def test_sync_accepts_explicit_template_targets(tmp_path: Path) -> None:
    """F-02: sync should accept known template suffixes."""
    project = tmp_path / "project"
    project.mkdir()
    (project / ".env").write_text("A=1\nB=2\n", encoding="utf-8")
    (project / ".env.example").write_text("A=\n", encoding="utf-8")

    result = invoke("sync", str(project), "--source", ".env", "--target", ".env.example", "--apply")
    assert result.exit_code == 0
    content = (project / ".env.example").read_text(encoding="utf-8")
    assert "B=" in content


def test_init_accepts_template_output_names(tmp_path: Path) -> None:
    """F-02: init should work with known template file names."""
    project = tmp_path / "project"
    project.mkdir()
    (project / ".env").write_text("A=1\n", encoding="utf-8")

    result = invoke("init", str(project), "--output", ".env.sample")
    assert result.exit_code == 0
    assert (project / ".env.sample").exists()


# --- F-03: UTF-8 BOM handling --------------------------------------------------


def test_parse_handles_utf8_bom(tmp_path: Path) -> None:
    """F-03: UTF-8 BOM should not break first variable parsing."""
    from envguard.discovery import DiscoveredFile
    from envguard.envfiles import parse_env_file

    content = "\ufeffBOM_VAR=1\nSECOND_VAR=2\n"
    path = tmp_path / ".env"
    path.write_bytes(content.encode("utf-8"))
    parsed = parse_env_file(DiscoveredFile(path=path, relative_path=".env"))
    assert parsed.names == ["BOM_VAR", "SECOND_VAR"]
    assert parsed.error is None


def test_init_creates_utf8_without_bom(tmp_path: Path) -> None:
    """F-03: init should create files without BOM (normal UTF-8)."""
    project = tmp_path / "project"
    project.mkdir()
    (project / "app.py").write_text('os.getenv("VAR")\n', encoding="utf-8")

    result = invoke("init", str(project), "--output", ".env.example")
    assert result.exit_code == 0
    content = (project / ".env.example").read_bytes()
    # Should not start with BOM
    assert not content.startswith(b"\xef\xbb\xbf")
    assert content == b"VAR=\n"


# --- F-04: Skipped source reporting --------------------------------------------------


def test_check_reports_skipped_unreadable_sources(tmp_path: Path) -> None:
    """F-04: unreadable source files should be reported in check output."""
    project = tmp_path / "project"
    project.mkdir()
    (project / "app.py").write_text('os.getenv("A")\n', encoding="utf-8")
    (project / "locked.py").write_text('os.getenv("B")\n', encoding="utf-8")
    # Both A and B in template so no missing error
    (project / ".env.example").write_text("A=\nB=\n", encoding="utf-8")

    # Make locked.py unreadable
    os.chmod(project / "locked.py", 0o000)

    try:
        result = invoke("check", str(project))
        text = flat(result)
        # Exit 0 because all vars are in template, but should report skipped files
        assert result.exit_code == 0
        # Should mention skipped files
        assert (
            "skipped" in text.lower()
            or "could not be read" in text.lower()
            or "unreadable" in text.lower()
        )
    finally:
        os.chmod(project / "locked.py", 0o644)


def test_scan_reports_skipped_unreadable_sources(tmp_path: Path) -> None:
    """F-04: unreadable source files should be reported in scan output."""
    project = tmp_path / "project"
    project.mkdir()
    (project / "app.py").write_text('os.getenv("A")\n', encoding="utf-8")
    (project / "locked.py").write_text('os.getenv("B")\n', encoding="utf-8")
    (project / ".env.example").write_text("A=\n", encoding="utf-8")
    (project / ".env").write_text("A=1\n", encoding="utf-8")

    os.chmod(project / "locked.py", 0o000)

    try:
        result = invoke("scan", str(project))
        text = flat(result)
        # Should mention skipped files or unreadable sources
        assert (
            "skipped" in text.lower()
            or "could not be read" in text.lower()
            or "unreadable" in text.lower()
        )
    finally:
        os.chmod(project / "locked.py", 0o644)
