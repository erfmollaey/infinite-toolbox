"""Git-based exposure checks for environment files.

Distinguishes three reliable states (``tracked``, ``ignored``, ``untracked``)
plus ``unknown`` when Git cannot answer. A file is *never* reported as safe
because an inspection failed: failure yields ``unknown`` with a reason.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

State = str  # "tracked" | "ignored" | "untracked" | "unknown"


@dataclass(frozen=True)
class GitExposure:
    relative_path: str
    state: State
    detail: str


@dataclass(frozen=True)
class GitLookup:
    """Outcome of a batched Git inspection for one project root."""

    available: bool
    error: str | None
    tracked: frozenset[str]
    ignored: frozenset[str]


def _run_git(root: Path, args: list[str]) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


def inspect_git(root: Path, relative_paths: list[str]) -> GitLookup:
    """Batch-classify ``relative_paths`` (tracked vs ignored vs untracked)."""
    if not relative_paths:
        return GitLookup(available=True, error=None, tracked=frozenset(), ignored=frozenset())

    probe = _run_git(root, ["rev-parse", "--is-inside-work-tree"])
    if probe is None or probe.returncode != 0 or (probe.stdout or "").strip() != "true":
        return GitLookup(
            available=False,
            error="not a Git repository (or git is unavailable)",
            tracked=frozenset(),
            ignored=frozenset(),
        )

    tracked: set[str] = set()
    proc = _run_git(root, ["ls-files", "--", *relative_paths])
    if proc is None or proc.returncode != 0:
        return GitLookup(
            available=False,
            error="`git ls-files` failed; exposure state cannot be determined",
            tracked=frozenset(),
            ignored=frozenset(),
        )
    tracked = {entry for entry in (proc.stdout or "").split("\n") if entry}

    ignored: set[str] = set()
    proc = _run_git(root, ["check-ignore", "--", *relative_paths])
    if proc is None or proc.returncode not in (0, 1):
        return GitLookup(
            available=False,
            error="`git check-ignore` failed; exposure state cannot be determined",
            tracked=frozenset(tracked),
            ignored=frozenset(),
        )
    if proc.returncode == 0:
        ignored = {entry for entry in (proc.stdout or "").split("\n") if entry}

    return GitLookup(
        available=True, error=None, tracked=frozenset(tracked), ignored=frozenset(ignored)
    )


_DETAIL = {
    "tracked": "committed to Git history",
    "ignored": "excluded by .gitignore",
    "untracked": "exists locally but is not ignored",
    "unknown": "state unknown",
}


def classify(root: Path, relative_paths: list[str]) -> list[GitExposure]:
    """Return one :class:`GitExposure` per path, in the given order."""
    lookup = inspect_git(root, relative_paths)
    results: list[GitExposure] = []
    for rel in relative_paths:
        if not lookup.available:
            results.append(GitExposure(rel, "unknown", lookup.error or "unknown error"))
        elif rel in lookup.tracked:
            results.append(GitExposure(rel, "tracked", _DETAIL["tracked"]))
        elif rel in lookup.ignored:
            results.append(GitExposure(rel, "ignored", _DETAIL["ignored"]))
        else:
            results.append(GitExposure(rel, "untracked", _DETAIL["untracked"]))
    return results
