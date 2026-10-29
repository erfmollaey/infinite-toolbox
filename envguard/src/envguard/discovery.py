"""Filesystem discovery for environment files and source files.

This module only locates files; it never reads file contents. Reading and
parsing live in :mod:`envguard.envfiles` and :mod:`envguard.sources`.

Safety rules implemented here:

* Irrelevant directories (``.git``, virtualenvs, ``node_modules``, build and
  cache outputs) are never entered.
* Symbolic links are not followed, so discovery cannot escape the project.
* Source discovery prefers ``git ls-files`` so ``.gitignore`` is honored
  exactly; a bounded directory walk is used only when Git is unavailable.
"""

from __future__ import annotations

import subprocess
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

#: Directories that are never traversed.
EXCLUDED_DIRS: frozenset[str] = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".venv",
        "venv",
        "env",
        ".tox",
        ".nox",
        ".mypy_cache",
        ".ruff_cache",
        ".pytest_cache",
        ".eggs",
        ".next",
        ".nuxt",
        ".cache",
        "__pycache__",
        "node_modules",
        "bower_components",
        "vendor",
        "target",
        "dist",
        "build",
        "coverage",
        "htmlcov",
        "site-packages",
        ".idea",
        ".vscode",
    }
)

#: Source extensions scanned for environment-variable references.
SOURCE_SUFFIXES: frozenset[str] = frozenset(
    {".py", ".pyi", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}
)

#: How deep (in directories below the root) environment files are searched.
ENV_FILE_MAX_DEPTH = 4


@dataclass(frozen=True)
class DiscoveredFile:
    """A file found inside the project, referenced relative to the root."""

    path: Path  # absolute path on disk
    relative_path: str  # POSIX-style path relative to the project root


def is_env_file_name(name: str) -> bool:
    """Return True for ``.env`` and its variants (``.env.local``, ``.env.example``...)."""
    return name == ".env" or name.startswith(".env.")


def _relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def _walk(root: Path, *, max_depth: int | None) -> Iterator[Path]:
    """Yield files under ``root`` without following symlinks.

    ``max_depth`` limits how many directory levels below ``root`` are visited;
    ``None`` means unlimited.
    """
    stack: list[tuple[Path, int]] = [(root, 0)]
    while stack:
        directory, depth = stack.pop()
        try:
            entries = sorted(directory.iterdir())
        except OSError:
            continue
        for entry in entries:
            try:
                if entry.is_symlink():
                    continue
                if entry.is_dir():
                    if entry.name in EXCLUDED_DIRS:
                        continue
                    if max_depth is None or depth + 1 <= max_depth:
                        stack.append((entry, depth + 1))
                elif entry.is_file():
                    yield entry
            except OSError:
                continue


def discover_env_files(root: Path, max_depth: int = ENV_FILE_MAX_DEPTH) -> list[DiscoveredFile]:
    """Locate ``.env`` and its variants anywhere in the project (bounded depth).

    Only files whose *name* matches the environment-file convention are
    returned; unrelated files are never opened.
    """
    found = [
        DiscoveredFile(path=p, relative_path=_relative(root, p))
        for p in _walk(root, max_depth=max_depth)
        if is_env_file_name(p.name)
    ]
    return sorted(found, key=lambda f: (f.relative_path.count("/"), f.relative_path))


def _git_ls_files(root: Path) -> list[str] | None:
    """Return tracked and not-ignored files via Git, or ``None`` if Git is unusable."""
    try:
        proc = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-co", "--exclude-standard", "-z"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    return [entry for entry in (proc.stdout or "").split("\0") if entry]


def discover_source_files(root: Path) -> list[DiscoveredFile]:
    """Locate source files that may reference environment variables.

    Uses ``git ls-files`` when the project is a Git repository so that
    ``.gitignore`` is respected exactly; otherwise falls back to a bounded
    directory walk with the standard excluded-directory list.
    """
    names = _git_ls_files(root)
    if names is not None:
        found = []
        for name in names:
            candidate = root / name
            if candidate.suffix.lower() not in SOURCE_SUFFIXES:
                continue
            try:
                if candidate.is_file() and not candidate.is_symlink():
                    found.append(DiscoveredFile(path=candidate, relative_path=name))
            except OSError:
                continue
        return sorted(found, key=lambda f: f.relative_path)

    found = [
        DiscoveredFile(path=p, relative_path=_relative(root, p))
        for p in _walk(root, max_depth=None)
        if p.suffix.lower() in SOURCE_SUFFIXES
    ]
    return sorted(found, key=lambda f: f.relative_path)
