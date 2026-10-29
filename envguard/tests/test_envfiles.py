"""Tests for environment-file parsing (names only, never values)."""

from __future__ import annotations

from pathlib import Path

from conftest import FAKE_SECRET
from envguard.discovery import DiscoveredFile
from envguard.envfiles import (
    EnvFile,
    parse_env_file,
    pick_real_env,
    pick_template,
)


def parse_text(tmp_path: Path, name: str, content: str) -> EnvFile:
    path = tmp_path / name
    path.write_text(content, encoding="utf-8")
    return parse_env_file(DiscoveredFile(path=path, relative_path=name))


def test_extracts_names_and_never_exposes_values(tmp_path: Path) -> None:
    parsed = parse_text(
        tmp_path,
        ".env",
        f"DATABASE_URL=postgres://x\nJWT_SECRET={FAKE_SECRET}\n",
    )
    assert parsed.names == ["DATABASE_URL", "JWT_SECRET"]
    # The value must not appear anywhere in the parsed representation.
    assert FAKE_SECRET not in repr(parsed)
    assert parsed.populated_values == 2


def test_handles_export_quotes_comments_and_blanks(tmp_path: Path) -> None:
    parsed = parse_text(
        tmp_path,
        ".env",
        "# comment\n\nexport API_KEY=\"with spaces\"\nEMPTY=\nTRAILING_QUOTE='v'\n",
    )
    assert parsed.names == ["API_KEY", "EMPTY", "TRAILING_QUOTE"]
    # EMPTY has no value, the other two do — count only, no values.
    assert parsed.populated_values == 2
    assert parsed.issues == []


def test_malformed_lines_are_reported_not_raised(tmp_path: Path) -> None:
    parsed = parse_text(tmp_path, ".env", "GOOD=1\nJUST_A_WORD\n1BAD=x\n")
    issues = parsed.issues
    assert parsed.names == ["GOOD"]
    assert len(issues) == 2
    assert {issue.line for issue in issues} == {2, 3}
    # Issue messages contain line numbers only, never file contents.
    assert "JUST_A_WORD" not in repr(issues)


def test_non_utf8_file_is_marked_unreadable(tmp_path: Path) -> None:
    path = tmp_path / ".env"
    path.write_bytes(b"\xff\xfe\x00broken")
    parsed = parse_env_file(DiscoveredFile(path=path, relative_path=".env"))
    assert parsed.error is not None
    assert parsed.names == []


def test_missing_file_is_reported_not_raised(tmp_path: Path) -> None:
    parsed = parse_env_file(DiscoveredFile(path=tmp_path / ".env", relative_path=".env"))
    assert parsed.error is not None
    assert parsed.names == []


def test_duplicate_names_are_deduplicated(tmp_path: Path) -> None:
    parsed = parse_text(tmp_path, ".env", "A=1\nB=2\nA=3\n")
    assert parsed.names == ["A", "B"]
    assert parsed.populated_values == 3


def test_template_and_real_env_selection(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text("A=1\n", encoding="utf-8")
    (tmp_path / ".env.example").write_text("A=\n", encoding="utf-8")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / ".env").write_text("B=1\n", encoding="utf-8")
    files = [
        parse_env_file(DiscoveredFile(path=p, relative_path=p.name))
        for p in [tmp_path / ".env", tmp_path / ".env.example"]
    ]
    files.append(
        parse_env_file(DiscoveredFile(path=tmp_path / "sub" / ".env", relative_path="sub/.env"))
    )
    template = pick_template(files)
    real = pick_real_env(files)
    assert template is not None and template.relative_path == ".env.example"
    assert real is not None and real.relative_path == ".env"
    assert template.is_template and not real.is_template
