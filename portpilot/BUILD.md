# PortPilot Build Guide

## Overview

PortPilot is a CommonJS CLI written in TypeScript. `tsc` compiles `src/` to
`dist/`, and the published `cli.js` is a thin executable wrapper that loads
`dist/cli/app.js`. There are no runtime npm dependencies and no native modules.

## Prerequisites

- Node.js 18 or newer
- npm
- macOS, Linux, or Windows

## Setup

```bash
cd portpilot
npm ci
npm run build
node cli.js --help
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Run ESLint over source, tests, and config |
| `npm run lint:fix` | Apply ESLint fixes |
| `npm run format` | Format with Prettier |
| `npm run format:check` | Verify formatting |
| `npm test` | Build, then run all tests |
| `npm run test:unit` | Validation, parser, and prompt tests |
| `npm run test:integration` | Discovery and termination tests |
| `npm start` | Run the CLI |
| `npm pack --dry-run` | Inspect the publishable package |

`pretest` runs the build automatically, so tests always exercise the current
compiled output. `prepack` does the same before packaging.

## Project structure

```
portpilot/
├── cli.js                         # Executable wrapper for dist/cli/app.js
├── src/
│   ├── cli/
│   │   ├── app.ts                 # Argument dispatch, help, version
│   │   ├── commands.ts            # list/find/inspect/free/<port> handlers
│   │   └── prompt.ts              # TTY-only confirmation prompts
│   ├── discovery/
│   │   ├── index.ts               # Provider selection, normalization, sorting
│   │   ├── lsof.ts                # Shared lsof invocation and parser
│   │   ├── types.ts               # Provider contracts
│   │   └── platforms/
│   │       ├── macos.ts           # lsof + netstat fallback
│   │       ├── linux.ts           # lsof + /proc fallback
│   │       └── windows.ts         # netstat/tasklist + PowerShell fallback
│   ├── process/
│   │   ├── inspector.ts           # Read-only ps/CIM inspection and identity
│   │   └── terminator.ts          # Revalidation, confirmation, termination
│   ├── types/index.ts             # Shared domain types
│   └── utils/
│       ├── exec.ts                # Shell-free execFile wrapper with timeouts
│       ├── formatter.ts           # ANSI styling and table rendering
│       ├── platform.ts            # Platform detection
│       └── validator.ts           # Strict port/PID validation
├── tests/
│   ├── fixtures/server.js         # Controlled loopback listener
│   ├── validator.test.js
│   ├── parsers.test.js
│   ├── prompt.test.js
│   ├── discovery.test.js
│   ├── termination.test.js
│   └── cli.test.js
├── dist/                          # Generated, gitignored, shipped in npm package
├── eslint.config.mjs
├── tsconfig.json
└── package.json
```

## Build output and packaging

- `tsconfig.json` compiles `src/**/*.ts` to CommonJS in `dist/` with strict type
  checking.
- `package.json` includes `cli.js`, `dist`, `README.md`, and `LICENSE` in the
  published tarball.
- `cli.js` must remain executable (`chmod +x cli.js`) because it is the `bin`
  entry.
- `prepack` rebuilds `dist` so a stale build cannot be published.
- Do not publish yet; this repository has not been released to npm.

Verify the package without publishing:

```bash
npm run build
npm pack --dry-run
ls -l cli.js
```

## Test suite

Tests use Node's built-in test runner (`node --test`) and are CommonJS so they can
load the compiled output directly.

1. **Validation** (`validator.test.js`) — ranges, integers, malformed strings.
2. **Parsers** (`parsers.test.js`) — lsof, macOS netstat, Windows netstat,
   tasklist CSV, PowerShell JSON, `/proc/net/tcp{,6}`, and protected-process
   rules. These run on every platform from fixed fixtures.
3. **Prompting** (`prompt.test.js`) — non-TTY refusal, explicit yes/no parsing,
   and EOF handling.
4. **Discovery integration** (`discovery.test.js`) — real ephemeral loopback
   servers, PID lookup, free/occupied ports, two child processes on one port
   (dual-stack), read-only inspection, and missing processes. The Linux
   `/proc` fallback test runs only on Linux.
5. **Termination integration** (`termination.test.js`) — graceful termination of
   a controlled child, cancellation, declined force confirmation, forced
   termination after graceful failure, a refused graceful signal that still
   requires a second confirmation, permission errors, PID reuse, exited
   processes, and refusal to kill PID 1 or PortPilot itself.
6. **CLI smoke tests** (`cli.test.js`) — help/version, invalid input, free and
   occupied ports, `list`, and non-interactive `free` refusal.

The integration tests only signal child processes they started on ephemeral
loopback ports. They do not terminate unrelated system processes.

Without a TTY, confirmation prompts do not run at all; `free` prints the target
details and exits without changing anything. Interactive confirmation is covered
by prompt unit tests and the termination tests, which inject confirm decisions.

## Platform verification

| Platform | Discovery code | Verified in this repo |
| --- | --- | --- |
| macOS | lsof, netstat fallback | End-to-end (discovery, inspection, termination, CLI) |
| Linux | lsof, `/proc` fallback | End-to-end in a Node 24 Alpine container with `procps` + `lsof`: the full suite passed, including the `/proc` integration test |
| Windows | netstat/tasklist, PowerShell fallback | Parser tests only; cross-platform CI is configured but has not produced a Windows run in this repository yet |

Windows command-line inspection requires PowerShell (`Get-CimInstance`); without
it, names come from `tasklist` and command lines are omitted. Windows often
refuses a non-forced `taskkill` for console processes; PortPilot reports that
failure and asks for the second confirmation before using `taskkill /F`.

## Safety architecture

- All process inspection is read-only.
- Discovery and inspection never invoke a shell; `execFile` is used directly
  with argument arrays and timeouts.
- Every termination target is resolved to a PID and revalidated by start marker
  and name before confirmation and again before each signal.
- Protected PIDs and critical system process names are refused.
- Graceful termination is attempted first. If it times out or the graceful
  request is refused, the failure is explained and force termination requires a
  second explicit confirmation. Permission failures stop the workflow.
- Permission failures stop the workflow; privileges are never escalated.
- A non-TTY stdin means no prompt and no confirmation.

## Continuous integration

`.github/workflows/portpilot.yml` runs on changes under `portpilot/`:

- a quality job (type check, lint, format check) on Node 24;
- a test matrix for `ubuntu-latest`, `macos-latest`, and `windows-latest` with
  Node 18 and 24;
- a Linux job that packs the tarball, installs it into a clean directory, and
  exercises the installed `portpilot` binary.

## Troubleshooting

**`Cannot find module './dist/cli/app.js'`** — run `npm run build` first.

**`lsof` or `netstat` not found** — the platform falls back where possible. If
both are unavailable, the command reports incomplete discovery instead of
claiming the port is free.

**PID shown as `?`** — the socket is visible, but the OS did not allow mapping it
to a process. `free` refuses to terminate an unknown owner.

**Windows inspection lacks a command line** — PowerShell/CIM is unavailable or
Access Denied. Basic PID and image name still come from `tasklist`.

**Dual-stack integration test skipped** — the system did not allow binding both
`127.0.0.1` and `::1` on the same port.
