"""Tests for Git exposure classification (tracked / ignored / untracked / unknown)."""

from __future__ import annotations

from pathlib import Path

from conftest import git
from envguard.gitcheck import classify, inspect_git


def test_non_repository_yields_unknown_not_safe(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text("A=1\n", encoding="utf-8")
    lookup = inspect_git(tmp_path, [".env"])
    assert lookup.available is False
    assert lookup.error is not None
    results = classify(tmp_path, [".env"])
    assert results[0].state == "unknown"
    assert "not a Git repository" in results[0].detail


def test_tracked_file_is_detected(git_repo: Path) -> None:
    git(git_repo, "add", "-f", ".env")
    results = classify(git_repo, [".env"])
    assert results[0].state == "tracked"


def test_ignored_file_is_detected(git_repo: Path) -> None:
    (git_repo / ".gitignore").write_text(".env\n", encoding="utf-8")
    results = classify(git_repo, [".env"])
    assert results[0].state == "ignored"


def test_untracked_but_not_ignored_file_is_detected(git_repo: Path) -> None:
    (git_repo / ".gitignore").write_text("node_modules/\n", encoding="utf-8")
    results = classify(git_repo, [".env"])
    assert results[0].state == "untracked"
    assert "not ignored" in results[0].detail


def test_batch_classification_keeps_order(git_repo: Path) -> None:
    (git_repo / ".gitignore").write_text(".env\n", encoding="utf-8")
    (git_repo / ".env.example").write_text("A=\n", encoding="utf-8")
    git(git_repo, "add", ".env.example")
    results = classify(git_repo, [".env", ".env.example"])
    assert [(r.relative_path, r.state) for r in results] == [
        (".env", "ignored"),
        (".env.example", "tracked"),
    ]


def test_tracked_wins_over_ignored(git_repo: Path) -> None:
    """A file already in history stays 'tracked' even if newly ignored."""
    (git_repo / ".env").write_text("A=1\n", encoding="utf-8")
    git(git_repo, "add", "-f", ".env")
    (git_repo / ".gitignore").write_text(".env\n", encoding="utf-8")
    results = classify(git_repo, [".env"])
    assert results[0].state == "tracked"
