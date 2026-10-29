# EnvGuard

**EnvGuard** is a local-first command-line tool that inspects your project's environment-variable configuration and prevents the configuration mistakes that break deploys and leak secrets.

It answers, without you grepping the entire codebase:

1. Which environment variables does my code **require**, and which are missing?
2. Which variables in my template are **stale or unused**?
3. Is a real `.env` file **tracked by Git** — i.e. already in my history?
4. Are any variables in the **`NEXT_PUBLIC_*`** namespace headed for the browser bundle?

Security and developer experience are treated as equal requirements: EnvGuard never prints, logs, or stores environment **values** — only names, counts, paths, and line numbers.

## Status

**v0.1.0 — working local MVP.** All five commands below are implemented and covered by tests. EnvGuard is **not** published to any package index yet; it is installed from this repository (see Installation).

| Area | Status |
| --- | --- |
| `.env` / `.env.example` / variant discovery | ✅ implemented |
| Variable-name extraction (values never read into reports) | ✅ implemented |
| Python / JS / TS / Next.js reference detection | ✅ implemented |
| `check`, `init`, `sync`, `scan`, `doctor` | ✅ implemented |
| Git exposure classification (tracked / ignored / untracked / unknown) | ✅ implemented |
| CI-friendly exit codes + `--strict` | ✅ implemented |
| JSON output, custom required-variable annotations, pre-commit hook | 🗓 planned |

## Use cases

- **Before you commit:** catch a real `.env` file that Git is about to record forever.
- **Onboarding:** generate a `.env.example` from what the code actually reads.
- **CI gate:** fail the build when required variables are missing from the template or a secret-bearing file is tracked.
- **Auditing:** list every variable your code references and where — across Python, TypeScript, and Next.js in one pass.

## Requirements

- Python **3.12+**
- **Git** (optional) — enables exposure checks; without a repository, EnvGuard reports states as `unknown` and never claims a file is safe

## Installation (development stage)

```bash
cd envguard
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
envguard --version
```

Runtime dependencies are only **Typer** and **Rich**.

## Commands

### `envguard check [PATH]`

Detect missing variables and configuration inconsistencies.

```console
$ envguard check
envguard check — /private/tmp/envguard-demo
  File            Kind           Vars    Notes
  .env            environment       2
  .env.example    template          2

Referenced variables (3):
  DATABASE_URL (src/app.py)
  JWT_SECRET (src/app.py)
  NEXT_PUBLIC_API_URL public (web/client.ts)

Findings
  ERROR 1 variable(s) referenced in code but not defined in .env:
NEXT_PUBLIC_API_URL
         The application may fail at runtime. Add them locally (never commit the
real file) or provide them via your CI/host.
  ERROR 2 variable(s) referenced in code but missing from .env.example:
JWT_SECRET, NEXT_PUBLIC_API_URL
         Document each variable in the template, or remove the unused code
reference.
  WARN  1 variable(s) in .env.example were not detected in source: UNUSED_VAR
         Static analysis is best-effort: dynamic access (e.g. os.environ[name])
is not detected, so this can be a false positive. Verify manually before removing
anything.
  INFO  1 NEXT_PUBLIC_* variable(s) are exposed to the browser bundle:
NEXT_PUBLIC_API_URL
         Anything prefixed NEXT_PUBLIC_ is embedded at build time and readable
by end users. Never put secrets there.

Summary: 2 error(s), 1 warning(s), 1 info
```

Exit code: `1` (errors found). Add `--strict` to also fail on warnings.

### `envguard init [PATH]`

Create a sample environment file from safely discovered variable names (source references ∪ existing environment files). Values are always written empty.

```console
$ envguard init
envguard init — /private/tmp/envguard-init
Created .env.example with 2 name(s):
  API_KEY=
  DB_URL=
Values are intentionally left empty — fill them in locally and never commit a
real .env file.
```

Refuses to overwrite an existing file unless `--force` is given (exit `2`).
`--output/-o` chooses a different file name.

### `envguard sync [PATH]`

Compare a real environment file against a template and propose safe synchronization. **Dry-run by default** — nothing is written until you pass `--apply`, the source file is never modified, and no line is ever removed from the target.

```console
$ envguard sync
envguard sync — /private/tmp/envguard-demo
Compared .env (2 names) → .env.example (2 names)
  only in .env.example (1): UNUSED_VAR

Proposed additions to .env.example (1):
  JWT_SECRET=

Dry run: no file was modified. Re-run with --apply to append these names.
```

```console
$ envguard sync --apply
...
Appended 1 name(s) to .env.example.
The source file was not modified.
```

Exit codes: `1` when differences exist in dry-run mode, `0` after a successful `--apply` or when already in sync. `--source` / `--target` select the two files.

### `envguard scan [PATH]`

Inspect environment files and Git configuration for potential secret exposure.

```console
$ envguard scan
envguard scan — /private/tmp/envguard-demo
  File            Kind           Vars    Notes
  .env            environment       2
  .env.example    template          2

Git exposure
  .env: tracked — committed to Git history
  .env.example: untracked — exists locally but is not ignored

Findings
  ERROR .env is tracked by Git. A real environment file must never be committed.
         Remove it from the index (`git rm --cached <file>`), rotate every
secret it contained, and add it to .gitignore.

Summary: 1 error(s), 0 warning(s), 0 info
```

Exit code: `1` when a real environment file is tracked. `--no-git` skips Git checks; `--strict` also fails on warnings.

### `envguard doctor [PATH]`

Concise overall configuration-health report: environment files, Git exposure, all findings from `check` + `scan`, and a one-line verdict.

```console
$ envguard doctor
...
Summary: 3 error(s), 1 warning(s), 1 info
Verdict: UNSAFE configuration — fix the errors above.
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success, no blocking findings (warnings allowed unless `--strict`) |
| `1` | Findings reported: missing variables, tracked real `.env`, or `sync` differences in dry-run |
| `2` | Operational error: bad path, missing/unreadable file, refusal to overwrite without `--force` |
| `2` | Invoking `envguard` with no subcommand (help is printed) |

## Supported detection patterns

| Language | Patterns |
| --- | --- |
| Python | `os.getenv("X")`, `getenv("X")`, `os.environ["X"]`, `os.environ.get("X")`, `os.environ.setdefault("X", ...)` |
| JavaScript / TypeScript | `process.env.X`, `process.env["X"]` |
| Next.js / Vite | `process.env.NEXT_PUBLIC_X`, `import.meta.env.X` |

Environment-file discovery covers `.env`, `.env.local`, `.env.example`, `.env.sample`, `.env.template`, `.env.development`, `.env.production`, and other `.env.*` variants — matched **by file name only**, so unrelated files are never opened.

## Security guarantees

- **Values are never printed** — not in reports, hints, exceptions, or debug output. The parser extracts names and counts non-empty values without ever handing values to the reporting layer.
- **Values never enter test snapshots or assertion messages.** Test fixtures use obvious placeholders (`sk-test-DO-NOT-LEAK-12345`) and the suite asserts these never appear in CLI output.
- **Nothing leaves your machine.** No network access, no telemetry, no persistence outside your project.
- **`.gitignore` is respected** and `.git`, `.venv`, `node_modules`, build outputs, and caches are never traversed; symlinks are not followed.
- **Non-destructive by default.** `check`, `scan`, and `doctor` never write; `sync` requires `--apply`; `init` refuses to overwrite without `--force`; Git history is never modified and nothing is ever staged or committed.
- **Failure is never reported as safety.** When Git cannot answer (no repository, permission error, Git missing), the state is `unknown` with the reason shown — never "safe" or "untracked".
- **`NEXT_PUBLIC_*` is always flagged** as browser-exposed configuration, regardless of where it appears.

## Limitations

- Detection is **best-effort static analysis**: literal references are found; dynamic access such as `os.environ[name]` or `process.env[key]` is not. `unused-in-template` warnings can therefore be false positives — verify before removing variables.
- "Missing from `.env`" is evaluated against the file on disk, not the runtime environment of a deployed service.
- Multi-line quoted values in environment files are not parsed as continuations (the first line's name is still captured; following lines are reported as malformed).
- Git checks cover the repository you run EnvGuard in; worktrees/submodules are inspected as their own repositories.
- The scanner is best-effort detection, **not a guarantee** that all secrets or all configuration problems have been found.

## Development

```bash
cd envguard
source .venv/bin/activate

pytest                 # test suite (55 tests)
ruff check src tests   # lint
ruff format src tests  # format
mypy src tests         # strict type checking
```

Module layout — parsing/analysis are deliberately separate from presentation:

```text
src/envguard/
├── discovery.py   # safe filesystem discovery (no symlinks, no irrelevant dirs)
├── envfiles.py    # env-file parsing → names only, never values
├── sources.py     # reference detection (Python/JS/TS/Next.js patterns)
├── analysis.py    # pure comparison logic → findings (no I/O, no output)
├── gitcheck.py    # tracked / ignored / untracked / unknown classification
├── report.py      # Rich rendering (receives names & counts only)
└── cli.py         # Typer commands, exit codes
```

## Future improvements

- Machine-readable `--json` output for CI tooling
- Optional per-variable annotations (e.g. required vs optional)
- Pre-commit hook and CI workflow examples
- Additional language patterns (Go `os.Getenv`, Rust `std::env::var`, shell `${VAR}`)
- Multi-line value-aware parsing for environment files
