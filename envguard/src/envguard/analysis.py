"""Comparison of referenced variables against environment files.

Pure data-in / data-out logic: no terminal output, no filesystem access, so it
can be unit-tested independently of the CLI.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from envguard.envfiles import EnvFile
from envguard.sources import PUBLIC_PREFIX, SourceScanResult

Severity = Literal["error", "warning", "info"]


@dataclass(frozen=True)
class Finding:
    """One actionable result. Messages never contain environment values."""

    severity: Severity
    code: str
    message: str
    hint: str | None = None


@dataclass
class AnalysisReport:
    findings: list[Finding] = field(default_factory=list)
    referenced: dict[str, list[str]] = field(default_factory=dict)  # var -> files
    template: str | None = None  # relative path of the template used
    real_env: str | None = None  # relative path of the real env file used

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "error"]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "warning"]

    @property
    def infos(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "info"]


def analyze(
    scan: SourceScanResult,
    template: EnvFile | None,
    real_env: EnvFile | None,
) -> AnalysisReport:
    """Build the findings for ``envguard check``."""
    report = AnalysisReport(
        referenced=scan.variables,
        template=template.relative_path if template else None,
        real_env=real_env.relative_path if real_env else None,
    )
    referenced = set(scan.variables)
    template_names = template.name_set if template else set()

    if template is None:
        report.findings.append(
            Finding(
                severity="warning",
                code="no-template",
                message="No environment template (.env.example, .env.template or "
                ".env.sample) was found.",
                hint="Run `envguard init` to create one from the variables "
                "referenced in your source code.",
            )
        )

    # 1. Referenced in code but missing from the template.
    if template is not None:
        missing = sorted(referenced - template_names)
        if missing:
            report.findings.append(
                Finding(
                    severity="error",
                    code="missing-from-template",
                    message=f"{len(missing)} variable(s) referenced in code but missing "
                    f"from {template.relative_path}: {', '.join(missing)}",
                    hint="Document each variable in the template, or remove the "
                    "unused code reference.",
                )
            )

    # 2. Referenced in code but absent from the real environment file.
    if real_env is not None:
        missing_env = sorted(referenced - real_env.name_set)
        if missing_env:
            report.findings.append(
                Finding(
                    severity="error",
                    code="missing-from-env",
                    message=f"{len(missing_env)} variable(s) referenced in code but not "
                    f"defined in {real_env.relative_path}: {', '.join(missing_env)}",
                    hint="The application may fail at runtime. Add them locally "
                    "(never commit the real file) or provide them via your CI/host.",
                )
            )
    elif referenced:
        report.findings.append(
            Finding(
                severity="info",
                code="no-env-file",
                message="No real environment file (.env) found; referenced variables "
                "must come from the shell or the deployment platform.",
            )
        )

    # 3. Declared in the template but not detected in source (possible staleness).
    if template is not None:
        unused = sorted(template_names - referenced)
        if unused:
            report.findings.append(
                Finding(
                    severity="warning",
                    code="unused-in-template",
                    message=f"{len(unused)} variable(s) in {template.relative_path} were "
                    f"not detected in source: {', '.join(unused)}",
                    hint="Static analysis is best-effort: dynamic access (e.g. "
                    "os.environ[name]) is not detected, so this can be a false "
                    "positive. Verify manually before removing anything.",
                )
            )

    # 4. Browser-exposed configuration.
    public = sorted(
        {v for v in referenced if v.startswith(PUBLIC_PREFIX)}
        | (
            {n for n in template_names if n.startswith(PUBLIC_PREFIX)}
            if template is not None
            else set()
        )
    )
    if public:
        report.findings.append(
            Finding(
                severity="info",
                code="public-vars",
                message=f"{len(public)} NEXT_PUBLIC_* variable(s) are exposed to the "
                f"browser bundle: {', '.join(public)}",
                hint="Anything prefixed NEXT_PUBLIC_ is embedded at build time and "
                "readable by end users. Never put secrets there.",
            )
        )

    # 5. Malformed environment files.
    for env_file in (template, real_env):
        if env_file is None:
            continue
        if env_file.error:
            report.findings.append(
                Finding(
                    severity="warning",
                    code="unreadable-env-file",
                    message=f"{env_file.relative_path} could not be parsed: {env_file.error}",
                )
            )
        elif env_file.issues:
            lines = ", ".join(str(issue.line) for issue in env_file.issues[:5])
            report.findings.append(
                Finding(
                    severity="warning",
                    code="malformed-env-file",
                    message=f"{env_file.relative_path} has "
                    f"{len(env_file.issues)} malformed line(s) (line {lines}).",
                )
            )

    if not referenced:
        report.findings.append(
            Finding(
                severity="warning",
                code="no-references",
                message="No environment-variable references were detected in source files.",
                hint="If your project does use environment variables, the supported "
                "patterns may not cover your access style yet.",
            )
        )

    return report
