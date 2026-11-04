# Infinite Toolbox

**Infinite Toolbox** is a collection of focused, practical developer tools, maintained under the **Infinity™** brand in a single monorepo.

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
| [**EnvGuard**](envguard/README.md) | ✅ Released — v0.1.0 (PyPI pending) | Local-first CLI that inspects environment-variable configuration: missing variables, stale templates, `NEXT_PUBLIC_*` exposure, and `.env` files accidentally tracked by Git. |
| [**Infinity MCP Toolbox**](mcp-tools/README.md) | ✅ Release Candidate — v0.1.0 | TypeScript MCP server providing four read-only project-inspection tools for AI assistants and MCP-compatible clients. |

> **Available today:** EnvGuard and Infinity MCP Toolbox (release candidate). MCP Toolbox is technically approved for release but not yet published to npm.

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

## Infinity MCP Toolbox

Infinity MCP Toolbox is a TypeScript MCP server that exposes four read-only tools to AI assistants and MCP-compatible clients (OpenCode, Cursor, etc.):

1. **`infinity_project_doctor`** — Analyzes project structure, detects project type, and identifies missing recommended files.
2. **`infinity_git_context`** — Returns structured Git information: branch, working-tree status, diff stats, and recent commits (secrets redacted).
3. **`infinity_environment_inspector`** — Inspects environment configuration templates without exposing any values.
4. **`infinity_dependency_inspector`** — Analyzes dependency declarations from `package.json` and `requirements.txt` without installing anything.

All tools are strictly read-only, operate within workspace boundaries, and never expose secrets. Git subprocesses use fixed arguments with `shell: false` and bounded output.

Full documentation, installation, and security notes: [`mcp-tools/README.md`](mcp-tools/README.md).

## Repository structure

```text
infinite-toolbox/
├── README.md            # this file — collection overview
├── .github/
│   └── workflows/       # CI and release workflows
├── envguard/            # Tool 1: EnvGuard (Python CLI)
│   ├── README.md
│   ├── pyproject.toml
│   ├── src/envguard/
│   └── tests/
└── mcp-tools/           # Tool 2: Infinity MCP Toolbox (TypeScript)
    ├── README.md
    ├── package.json
    ├── src/
    └── tests/
```

Each tool is a self-contained directory with its own packaging configuration, so tools can be developed, tested, and released independently while sharing one repository.

## Prerequisites

- **Python 3.12+** (developed and tested on 3.14) — for EnvGuard
- **Node.js 18+** — for Infinity MCP Toolbox
- **Git** — optional; enables Git exposure checks in EnvGuard

## Development

### EnvGuard (Python)

```bash
cd envguard
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
envguard --help

# Tests
pytest
ruff check src tests
ruff format src tests --check
mypy src tests
```

### Infinity MCP Toolbox (Node.js / TypeScript)

```bash
cd mcp-tools
npm ci
npm run build
npm start

# Quality checks
npm test
npm run typecheck
npm run lint
```

## Contributing

- **Bugs and ideas:** open an issue describing the problem, a minimal reproduction where possible, and the tool it affects.
- **Changes:** keep pull requests small and scoped to one tool; include tests for behavior changes; never commit real secrets, credentials, or real `.env` files — fixtures must use made-up placeholder values.
- **New tools:** discuss the problem and the scope first; a tool belongs here when it solves one recurring developer problem well, offline, and with a small footprint.

## License

Each tool in this monorepo has its own license. See the respective `LICENSE` files:

- EnvGuard: [`envguard/LICENSE`](envguard/LICENSE) (MIT)
- Infinity MCP Toolbox: [`mcp-tools/LICENSE`](mcp-tools/LICENSE) (MIT)

> This is a monorepo. Other tools (when they exist) may have their own license terms.
