# EnvGuard v0.1.0

**EnvGuard** is a local-first command-line tool that inspects your project's environment-variable configuration. It helps you find missing variables, spot stale template entries, catch `NEXT_PUBLIC_*` exposure, and detect real `.env` files that may be tracked by Git.

EnvGuard runs entirely on your machine. It does not require accounts, API keys, network access, or paid services.

## What it does

- **Finds missing variables.** Detects environment variables referenced in your code that are missing from your `.env.example` template or your real `.env` file.
- **Flags stale template variables.** Warns about variables in your template that no longer appear to be referenced in your code. Verify these before removing them — static analysis can miss dynamic access.
- **Catches `NEXT_PUBLIC_*` exposure.** Flags any `NEXT_PUBLIC_*` variables as browser-exposed configuration.
- **Detects tracked real `.env` files.** Classifies each environment file's Git exposure status so you can see whether a real env file is tracked, ignored, untracked, or unknown.
- **Synchronizes safely.** Syncs variable names from a real `.env` into a template. Writes are symlink-safe and non-destructive by default.
- **Initializes templates.** Generates a `.env.example` from the variables your code references.
- **Outputs human-readable and JSON reports.** Human-readable output is the default. Use `--json` for a single machine-readable JSON document suitable for CI.

## Installation

```bash
cd envguard
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
envguard --version
```

## Requirements

- Python 3.12 or newer
- Git is optional. It enables Git exposure checks. Without a repository, EnvGuard reports states as `unknown`.

## Basic usage

```bash
envguard check          # detect missing variables and configuration inconsistencies
envguard init           # create .env.example from referenced variables
envguard sync           # propose safe synchronization (dry-run by default)
envguard scan           # inspect env files and Git exposure
envguard doctor         # concise overall configuration-health report
envguard check --json   # machine-readable JSON output
envguard check --strict # also fail on warnings
```

Run `envguard --help` for the full command list and `envguard <command> --help` for command-specific options.

## Exit codes

- `0` — success, no blocking findings
- `1` — findings reported (errors, or warnings with `--strict`)
- `2` — operational error, such as a missing path or an unsafe write target

## CI usage

Use `envguard check --strict` or `envguard check --json --strict` in CI to fail the build when required variables are missing or when a real `.env` file is tracked.

The repository includes a GitHub Actions workflow for EnvGuard's own quality checks. That workflow validates EnvGuard itself, not the environment configuration of whatever project installs it.

## License

EnvGuard is MIT-licensed, copyright 2026 Infinity™.

The full license text is in `envguard/LICENSE`.

> Infinite Toolbox is a monorepo containing multiple independent tools. The MIT license in `envguard/LICENSE` applies to EnvGuard only and does not imply any particular license for other tools in the repository.

## Known limitations

- Detection is best-effort static analysis. Dynamic access patterns such as `os.environ[name]` or `process.env[key]` are not detected. `unused-in-template` warnings can be false positives.
- "Missing from `.env`" is evaluated against the file on disk, not the runtime environment of a deployed service.
- Multi-line quoted values are not parsed as continuations.
- Git checks cover the repository you run EnvGuard in. Worktrees and submodules are inspected as their own repositories.
- The scanner is best-effort detection, not a guarantee that all secrets or all configuration problems have been found.
- Environment-file discovery is limited to 4 directory levels below the project root.
- In non-Git projects, the fallback source walk does not apply `.gitignore`.
- Remote CI execution has not yet been verified.

## Where to read more

- EnvGuard README: `envguard/README.md`
- Full audit record: `docs/audits/ENVGUARD_PRE_RELEASE_AUDIT.md`
