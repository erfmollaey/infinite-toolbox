# Infinite Toolbox

**Infinite Toolbox** is a collection of small, practical developer tools, maintained under the **Infinity™** brand and developed in a single monorepo.

Every tool targets one specific, recurring developer problem, ships with a small installation footprint, and can be released and versioned independently.

## The problem it solves

Developer teams accumulate small utilities — scripts to check configuration, quick audits, local helpers — that are either glued into private repositories or reinvented per project. Infinite Toolbox packages these helpers as consistent, well-tested command-line tools that:

- work **locally**, without API keys, accounts, network access, or paid services;
- are small enough to understand and contribute to in one sitting;
- can be adopted one tool at a time, without adopting the whole collection.

## Principles

- **Genuine utility.** A tool must do something developers currently do by hand — not merely wrap an existing command.
- **Small and focused.** Minimal dependencies, a narrow scope, and output you can read without scrolling.
- **Local-first and private.** Core functionality runs on your machine. No telemetry, no uploads.
- **Security-conscious.** Tools that touch secrets treat them carefully by construction, not by convention.
- **Independent lifecycle.** Each tool lives in its own directory with its own version, tests, and README.
- **Honest documentation.** Implemented features are documented as implemented; planned ones are labeled as planned.

## Audience

Individual developers, full-stack and backend engineers, DevOps practitioners, and small engineering teams who want focused tooling without heavyweight platforms.

## Tools

| Tool | Status | Description |
| --- | --- | --- |
| [**EnvGuard**](envguard/README.md) | ✅ Implemented — v0.1.0 (local MVP) | Local-first CLI that inspects environment-variable configuration: missing variables, stale templates, `NEXT_PUBLIC_*` exposure, and `.env` files accidentally tracked by Git. |
| Further tools | 🗓 Planned | New tools will be added to this table as they are implemented. Nothing is listed here as available before it actually works. |

> **Available today:** EnvGuard. Everything else in this repository is scaffolding, documentation, or planned work.

## EnvGuard

EnvGuard answers three questions without you grepping the whole codebase:

1. Which environment variables does my code **require**, and which are missing?
2. Which variables in my template are **stale or unused**?
3. Is a real `.env` file **tracked by Git** — i.e. already in my history?

```console
$ envguard check
...
Summary: 2 error(s), 1 warning(s), 1 info
```

Full documentation, usage examples, and security notes: [`envguard/README.md`](envguard/README.md).

## Repository structure

```text
infinite-toolbox/
├── README.md            # this file — the collection overview
├── .gitignore           # keeps real .env files out, keeps templates in
└── envguard/            # Tool 1: EnvGuard (independently maintainable)
    ├── README.md
    ├── pyproject.toml
    ├── src/envguard/    # package source (src layout)
    └── tests/           # pytest suite
```

Each tool is a self-contained directory with its own packaging configuration, so tools can be developed, tested, and released independently while sharing one repository.

## Prerequisites

- **Python 3.12+** (developed and tested on 3.14)
- **Git** — optional; enables Git exposure checks in EnvGuard
- `pip` and `venv` (or any equivalent virtual-environment tooling)

## Basic setup

```bash
cd envguard
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
envguard --help
```

## Development

All checks used by the maintainers:

```bash
cd envguard
pytest              # test suite
ruff check src tests # lint
ruff format src tests --check
mypy src tests       # strict type checking
```

## Contributing

- **Bugs and ideas:** open an issue describing the problem, a minimal reproduction where possible, and the tool it affects.
- **Changes:** keep pull requests small and scoped to one tool; include tests for behavior changes; never commit real secrets, credentials, or real `.env` files — fixtures must use made-up placeholder values.
- **New tools:** discuss the problem and the scope first; a tool belongs here when it solves one recurring developer problem well, offline, and with a small footprint.

## License

EnvGuard is MIT-licensed. See [`envguard/LICENSE`](envguard/LICENSE) for the full license text.

> This is a monorepo. Other tools (when they exist) may have their own license terms. The MIT license in `envguard/LICENSE` applies to EnvGuard only.
