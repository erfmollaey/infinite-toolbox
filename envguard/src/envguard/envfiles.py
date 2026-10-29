"""Parsing of environment files: variable *names* only.

Values are intentionally never stored, returned, or logged. Parsing computes
the ordered list of defined names, lightweight line-level issues, and a count
of populated values (a boolean-ish fact that never reveals the value itself),
which is enough for every check EnvGuard performs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from envguard.discovery import DiscoveredFile

#: Names that look like conventional environment variables.
NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

#: Substrings that mark a file as a template rather than a real environment file.
TEMPLATE_TAGS = (".example", ".sample", ".template", ".dist")

#: Templates considered "appropriate" for a project, in order of preference.
TEMPLATE_FILE_NAMES = (".env.example", ".env.template", ".env.sample", ".env.dist")


@dataclass(frozen=True)
class ParseIssue:
    """A line-level problem. Contains no file contents beyond line numbers."""

    line: int
    message: str


@dataclass
class EnvFile:
    """The parsed representation of one environment file."""

    path: Path
    relative_path: str
    is_template: bool
    names: list[str] = field(default_factory=list)  # unique, first-seen order
    issues: list[ParseIssue] = field(default_factory=list)
    populated_values: int = 0  # count of non-empty values (values never stored)
    error: str | None = None  # set when the file could not be read/parsed

    @property
    def name_set(self) -> set[str]:
        return set(self.names)

    @property
    def kind(self) -> str:
        if self.error:
            return "unreadable"
        return "template" if self.is_template else "environment"


def is_template_name(file_name: str) -> bool:
    """True when a file name marks a template (``.env.example``, ``.env.sample``...)."""
    return file_name.startswith(".env") and any(tag in file_name for tag in TEMPLATE_TAGS)


def parse_env_file(discovered: DiscoveredFile) -> EnvFile:
    """Parse an environment file into names, issues and a populated-value count.

    Malformed lines, invalid encodings, and permission errors are reported as
    data (``issues`` / ``error``) instead of raising.
    """
    env_file = EnvFile(
        path=discovered.path,
        relative_path=discovered.relative_path,
        is_template=is_template_name(discovered.path.name),
    )
    try:
        raw = discovered.path.read_bytes()
    except OSError as exc:
        env_file.error = f"could not be read ({exc.strerror or exc.__class__.__name__})"
        return env_file

    try:
        text = raw.decode("utf-8-sig")  # handles UTF-8 BOM automatically
    except UnicodeDecodeError:
        env_file.error = "not valid UTF-8; skipping"
        return env_file

    seen: set[str] = set()
    for lineno, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("export "):
            stripped = stripped[len("export ") :].lstrip()
        if "=" not in stripped:
            env_file.issues.append(ParseIssue(lineno, "malformed line: expected NAME=VALUE"))
            continue
        name, _, value = stripped.partition("=")
        name = name.strip()
        if not NAME_RE.match(name):
            env_file.issues.append(
                ParseIssue(lineno, "malformed line: invalid variable name before '='")
            )
            continue
        if name not in seen:
            seen.add(name)
            env_file.names.append(name)
        if value.strip():
            env_file.populated_values += 1
    return env_file


def pick_template(env_files: list[EnvFile]) -> EnvFile | None:
    """Choose the preferred template file: canonical name first, shallowest path wins."""
    readable = [f for f in env_files if f.is_template and f.error is None]
    if not readable:
        return None
    for wanted in TEMPLATE_FILE_NAMES:
        candidates = [f for f in readable if f.path.name == wanted]
        if candidates:
            return min(candidates, key=lambda f: (f.relative_path.count("/"), f.relative_path))
    return min(readable, key=lambda f: (f.relative_path.count("/"), f.relative_path))


def pick_real_env(env_files: list[EnvFile]) -> EnvFile | None:
    """Choose the primary real environment file (``.env``, shallowest path wins)."""
    readable = [f for f in env_files if not f.is_template and f.error is None]
    exact = [f for f in readable if f.path.name == ".env"]
    pool = exact or readable
    if not pool:
        return None
    return min(pool, key=lambda f: (f.relative_path.count("/"), f.relative_path))
