"""Detection of environment-variable references in source code.

Detectors are plain regular expressions registered in :data:`PATTERNS`, which
makes the supported set explicit and easy to extend. Detection is
best-effort static analysis: literal references are found, dynamic access such
as ``os.environ[name]`` or ``process.env[key]`` is not.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from envguard.discovery import DiscoveredFile

#: A plausible environment-variable name.
_NAME = r"([A-Za-z_][A-Za-z0-9_]*)"

#: Ordered detection patterns. Each must expose the variable name as group 1.
PATTERNS: tuple[re.Pattern[str], ...] = (
    # Python: os.getenv("X"), getenv("X")
    re.compile(rf"\bgetenv\s*\(\s*['\"]{_NAME}['\"]"),
    # Python: os.environ["X"]
    re.compile(rf"\benviron\s*\[\s*['\"]{_NAME}['\"]\s*\]"),
    # Python: os.environ.get("X"), os.environ.setdefault("X", ...)
    re.compile(rf"\benviron\s*\.\s*(?:get|setdefault)\s*\(\s*['\"]{_NAME}['\"]"),
    # JavaScript / TypeScript / Next.js: process.env.X
    re.compile(rf"\bprocess\s*\.\s*env\s*\.\s*{_NAME}"),
    # JavaScript / TypeScript: process.env["X"]
    re.compile(rf"\bprocess\s*\.\s*env\s*\[\s*['\"]{_NAME}['\"]\s*\]"),
    # Vite / bundlers: import.meta.env.X
    re.compile(rf"\bimport\s*\.\s*meta\s*\.\s*env\s*\.\s*{_NAME}"),
)

#: ``NEXT_PUBLIC_*`` variables are inlined into the browser bundle by Next.js.
PUBLIC_PREFIX = "NEXT_PUBLIC_"


@dataclass(frozen=True)
class SourceRef:
    """One reference to an environment variable in source code."""

    variable: str
    relative_path: str
    line: int


@dataclass
class SourceScanResult:
    refs: list[SourceRef] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)  # (relative_path, reason)

    @property
    def variables(self) -> dict[str, list[str]]:
        """Variable name -> sorted list of files referencing it."""
        mapping: dict[str, set[str]] = {}
        for ref in self.refs:
            mapping.setdefault(ref.variable, set()).add(ref.relative_path)
        return {name: sorted(files) for name, files in sorted(mapping.items())}

    @property
    def public_variables(self) -> list[str]:
        return sorted({r.variable for r in self.refs if r.variable.startswith(PUBLIC_PREFIX)})


def scan_source_text(text: str, relative_path: str) -> list[SourceRef]:
    """Return every reference found in one already-decoded source text."""
    found: dict[tuple[str, int], SourceRef] = {}
    for lineno, line in enumerate(text.splitlines(), start=1):
        for pattern in PATTERNS:
            for match in pattern.finditer(line):
                variable = match.group(1)
                found.setdefault(
                    (variable, lineno),
                    SourceRef(variable=variable, relative_path=relative_path, line=lineno),
                )
    return list(found.values())


def scan_sources(files: list[DiscoveredFile]) -> SourceScanResult:
    """Scan discovered source files for variable references.

    Unreadable or non-UTF-8 files are skipped and recorded rather than raised.
    """
    result = SourceScanResult()
    for discovered in files:
        try:
            raw = discovered.path.read_bytes()
        except OSError as exc:
            result.skipped.append(
                (discovered.relative_path, exc.strerror or exc.__class__.__name__)
            )
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            result.skipped.append((discovered.relative_path, "not valid UTF-8"))
            continue
        result.refs.extend(scan_source_text(text, discovered.relative_path))
    result.refs.sort(key=lambda r: (r.variable, r.relative_path, r.line))
    return result
