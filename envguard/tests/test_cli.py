"""End-to-end tests for the EnvGuard CLI.

These tests assert two things above all: exit codes are meaningful for CI,
and no environment *value* ever reaches stdout/stderr.
"""

from __future__ import annotations

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
