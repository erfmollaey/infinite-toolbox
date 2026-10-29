"""Tests for the pure analysis layer (comparison and findings)."""

from __future__ import annotations

from pathlib import Path

from envguard.analysis import analyze
from envguard.discovery import DiscoveredFile
from envguard.envfiles import EnvFile, parse_env_file
from envguard.sources import SourceRef, SourceScanResult


def make_env(tmp_path: Path, name: str, names: list[str]) -> EnvFile:
    path = tmp_path / name
    path.write_text("".join(f"{n}=\n" for n in names), encoding="utf-8")
    return parse_env_file(DiscoveredFile(path=path, relative_path=name))


def make_scan(**variables: str) -> SourceScanResult:
    refs = [
        SourceRef(variable=var, relative_path=files, line=1) for var, files in variables.items()
    ]
    return SourceScanResult(refs=refs)


def codes(report: object) -> set[str]:
    return {finding.code for finding in report.findings}  # type: ignore[attr-defined]


def test_missing_referenced_variables_are_errors(tmp_path: Path) -> None:
    template = make_env(tmp_path, ".env.example", ["DATABASE_URL"])
    scan = make_scan(DATABASE_URL="src/app.py", JWT_SECRET="src/app.py")
    report = analyze(scan, template, real_env=None)
    assert "missing-from-template" in codes(report)
    error = next(f for f in report.findings if f.code == "missing-from-template")
    assert error.severity == "error"
    assert "JWT_SECRET" in error.message
    assert "DATABASE_URL" not in error.message


def test_unused_template_variables_warn_with_caveat(tmp_path: Path) -> None:
    template = make_env(tmp_path, ".env.example", ["USED", "STALE"])
    report = analyze(make_scan(USED="app.py"), template, real_env=None)
    warning = next(f for f in report.findings if f.code == "unused-in-template")
    assert warning.severity == "warning"
    assert "STALE" in warning.message and "USED" not in warning.message
    assert warning.hint and "false" in warning.hint.lower()


def test_missing_from_real_env_is_an_error(tmp_path: Path) -> None:
    template = make_env(tmp_path, ".env.example", ["A", "B"])
    real_env = make_env(tmp_path, ".env", ["A"])
    report = analyze(make_scan(A="x.py", B="y.py"), template, real_env)
    error = next(f for f in report.findings if f.code == "missing-from-env")
    assert error.severity == "error"
    assert "B" in error.message


def test_public_variables_are_flagged(tmp_path: Path) -> None:
    template = make_env(tmp_path, ".env.example", ["NEXT_PUBLIC_API"])
    report = analyze(make_scan(NEXT_PUBLIC_API="web/app.ts"), template, real_env=None)
    assert "public-vars" in codes(report)


def test_no_template_yields_warning_not_crash(tmp_path: Path) -> None:
    report = analyze(make_scan(A="a.py"), template=None, real_env=None)
    assert "no-template" in codes(report)


def test_report_grouping_properties(tmp_path: Path) -> None:
    template = make_env(tmp_path, ".env.example", ["A", "STALE"])
    report = analyze(make_scan(B="a.py"), template, real_env=None)
    assert report.errors and report.warnings
    assert report.template == ".env.example"
    assert report.referenced == {"B": ["a.py"]}
