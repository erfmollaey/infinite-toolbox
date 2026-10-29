"""Tests for safe filesystem discovery (no symlinks, no irrelevant directories)."""

from __future__ import annotations

import os
from pathlib import Path

from envguard.discovery import (
    discover_env_files,
    discover_source_files,
    is_env_file_name,
)


def test_env_file_name_matching() -> None:
    assert is_env_file_name(".env")
    assert is_env_file_name(".env.example")
    assert is_env_file_name(".env.local")
    assert not is_env_file_name(".envrc")
    assert not is_env_file_name("environment.py")
    assert not is_env_file_name("env.example")


def test_discovers_env_variants_but_skips_irrelevant_directories(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text("A=1\n", encoding="utf-8")
    (tmp_path / ".env.example").write_text("A=\n", encoding="utf-8")
    (tmp_path / "apps" / "web").mkdir(parents=True)
    (tmp_path / "apps" / "web" / ".env.local").write_text("B=1\n", encoding="utf-8")

    for blocked in ("node_modules", ".git", "__pycache__", ".venv", "dist"):
        nested = tmp_path / blocked / "sub"
        nested.mkdir(parents=True)
        (nested / ".env").write_text("LEAK=1\n", encoding="utf-8")

    found = [f.relative_path for f in discover_env_files(tmp_path)]
    assert found == [".env", ".env.example", "apps/web/.env.local"]


def test_source_discovery_fallback_skips_irrelevant_directories(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "app.py").write_text("pass\n", encoding="utf-8")
    (tmp_path / "package.json").write_text("{}", encoding="utf-8")
    blocked = tmp_path / "node_modules" / "pkg"
    blocked.mkdir(parents=True)
    (blocked / "index.js").write_text("process.env.X;\n", encoding="utf-8")
    (tmp_path / ".venv").mkdir()
    (tmp_path / ".venv" / "lib.py").write_text("pass\n", encoding="utf-8")

    found = [f.relative_path for f in discover_source_files(tmp_path)]
    assert found == ["src/app.py"]


def test_symlinked_directories_are_not_followed(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / ".env").write_text("OUTSIDE=1\n", encoding="utf-8")
    root = tmp_path / "project"
    root.mkdir()
    try:
        os.symlink(outside, root / "linked")
    except OSError:  # pragma: no cover - platform without symlink support
        return
    found = [f.relative_path for f in discover_env_files(root)]
    assert found == []


def test_env_discovery_prefers_shallow_files(tmp_path: Path) -> None:
    (tmp_path / "a" / "b").mkdir(parents=True)
    (tmp_path / ".env").write_text("A=1\n", encoding="utf-8")
    (tmp_path / "a" / "b" / ".env").write_text("B=1\n", encoding="utf-8")
    found = [f.relative_path for f in discover_env_files(tmp_path)]
    assert found == [".env", "a/b/.env"]
