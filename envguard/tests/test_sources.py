"""Tests for source-code reference detection (best-effort static analysis)."""

from __future__ import annotations

from pathlib import Path

from envguard.discovery import DiscoveredFile
from envguard.sources import scan_source_text, scan_sources

PYTHON_SAMPLE = """
import os

def f() -> None:
    a = os.getenv("DATABASE_URL")
    b = os.environ["JWT_SECRET"]
    c = os.environ.get("REDIS_URL")
    d = os.environ.setdefault("LOG_LEVEL", "info")
    dynamic = os.environ[name]
"""

JS_SAMPLE = """
const url = process.env.API_URL;
const key = process.env["SECRET_KEY"];
const pub = process.env.NEXT_PUBLIC_API_URL;
const vite = import.meta.env.VITE_BASE;
const dynamic = process.env[key];
"""


def test_detects_python_patterns() -> None:
    refs = scan_source_text(PYTHON_SAMPLE, "app.py")
    names = {ref.variable for ref in refs}
    assert names == {"DATABASE_URL", "JWT_SECRET", "REDIS_URL", "LOG_LEVEL"}
    assert all(ref.relative_path == "app.py" for ref in refs)
    assert all(ref.line > 0 for ref in refs)


def test_detects_javascript_and_nextjs_patterns() -> None:
    refs = scan_source_text(JS_SAMPLE, "client.ts")
    names = {ref.variable for ref in refs}
    assert names == {"API_URL", "SECRET_KEY", "NEXT_PUBLIC_API_URL", "VITE_BASE"}


def test_dynamic_access_is_not_claimed_as_detected() -> None:
    refs = scan_source_text("x = os.environ[name]\ny = process.env[key]\n", "a.py")
    assert refs == []


def test_duplicate_mentions_on_one_line_are_deduplicated() -> None:
    refs = scan_source_text('a = os.getenv("X") or os.getenv("X")\n', "a.py")
    assert len(refs) == 1


def test_scan_sources_skips_unreadable_and_binary_files(tmp_path: Path) -> None:
    binary = tmp_path / "img.png"
    binary.write_bytes(b"\x89PNG\x00\x01")
    good = tmp_path / "app.py"
    good.write_text('x = os.getenv("GOOD_VAR")\n', encoding="utf-8")
    result = scan_sources(
        [
            DiscoveredFile(path=binary, relative_path="img.png"),
            DiscoveredFile(path=good, relative_path="app.py"),
        ]
    )
    assert [ref.variable for ref in result.refs] == ["GOOD_VAR"]
    assert result.skipped and result.skipped[0][0] == "img.png"


def test_variable_index_groups_files_and_flags_public_vars() -> None:
    from envguard.sources import SourceScanResult

    refs = scan_source_text('os.getenv("SHARED")\n', "a.py") + scan_source_text(
        "process.env.SHARED\nprocess.env.NEXT_PUBLIC_CDN\n", "b.ts"
    )
    scan = SourceScanResult(refs=refs)
    assert scan.variables == {
        "NEXT_PUBLIC_CDN": ["b.ts"],
        "SHARED": ["a.py", "b.ts"],
    }
    assert scan.public_variables == ["NEXT_PUBLIC_CDN"]
