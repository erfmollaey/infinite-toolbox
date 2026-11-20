# PortPilot

**PortPilot** is a local-first CLI for finding out which process is using a TCP port and, when explicitly confirmed, terminating it. It is built for the usual local development problem:

```
Error: listen EADDRINUSE: address already in use :::3000
```

PortPilot reports the real operating-system listener information (PID, process name, address, and — when permitted — command line and user), without using mock data.

> Status: implemented and tested end-to-end on macOS and Linux. Windows
> support is covered by fixture tests and CI. Not published to npm yet.

## Requirements

- Node.js 18 or newer
- macOS, Linux, or Windows
- No native npm dependencies

## Installation (from this repository)

```bash
cd portpilot
npm ci
npm run build
node cli.js --help
```

To put the `portpilot` command on your PATH without publishing:

```bash
npm link
portpilot list
```

## Commands

### `portpilot <port>`

Inspect a port. In an interactive terminal it offers actions; in a non-interactive
environment it prints the listeners and exits without prompting.

```console
$ portpilot 3000
! Port 3000 is occupied by 1 process:
  node (PID 1234)
    TCP 127.0.0.1:3000

What would you like to do?
  1) Inspect process details
  2) Free the port
  3) Cancel
>
```

If the port is free:

```console
$ portpilot 3000
✓ Port 3000 is available.
```

### `portpilot list`

Lists every TCP listening endpoint found through the platform provider.

```console
$ portpilot list

TCP listeners

PORT   PID    PROCESS   ADDRESS
─────  ─────  ────────  ───────────────
3000   1234   node      127.0.0.1:3000
5432   5678   postgres  [::1]:5432
```

### `portpilot find <port>`

Shows the process or processes listening on one port, without additional
inspection lookups.

```console
$ portpilot find 3000
! Port 3000 is occupied by 1 process:
  node (PID 1234)
    TCP 127.0.0.1:3000
```

### `portpilot inspect <port>`

Read-only detailed inspection. Includes user, parent PID, executable, state,
start time, and command line when the operating system exposes them.

```console
$ portpilot inspect 3000
! Port 3000 is occupied by 1 process:

  Process 1234 (TCP 127.0.0.1:3000)
  PID           1234
  Process       node
  Port          3000
  Protocol      TCP
  Local address 127.0.0.1:3000
  User          dev
  Parent PID    1200
  Status        S
  Started       Fri Nov 20 19:36:26 2026
  Command       node server.js
```

### `portpilot free <port>`

Runs the guarded termination workflow:

1. Discover the listener(s) and show PID, process name, and available details.
2. Revalidate that the PID still belongs to the same process.
3. Ask for explicit confirmation.
4. Send a graceful termination request (`SIGTERM`, or `taskkill /PID` on Windows).
5. Wait for the process to exit.
6. If it is still running — or the graceful request itself was refused, as
   Windows does for many console processes — explain the failure and ask a
   second time before force termination (`SIGKILL`, or `taskkill /PID /F`).
7. Re-discover the port and report whether it is now free.

If several distinct processes listen on the same port, each is displayed and
confirmed separately. Multiple sockets owned by one PID are treated as one
target.

## Platform discovery

All platform-specific code lives under `src/discovery/platforms/`. No single
system utility is assumed to exist on every platform.

| Platform | Primary method | Fallback | Notes |
| --- | --- | --- | --- |
| macOS | `lsof -nP -iTCP -sTCP:LISTEN` | `netstat -an -p tcp` | The netstat fallback lists endpoints but cannot reliably report PIDs. |
| Linux | `lsof -nP -iTCP -sTCP:LISTEN` | `/proc/net/tcp`, `/proc/net/tcp6`, and `/proc/<pid>/fd` | Processes owned by other users may be unreadable; their sockets are shown with PID unknown. |
| Windows | `netstat -ano` + `tasklist` | PowerShell `Get-NetTCPConnection -State Listen` | No protocol filter is used, so both IPv4 and IPv6 listeners are visible. Command lines are read with `Get-CimInstance Win32_Process` when PowerShell is available. |

Only **TCP listeners** are discovered. UDP ports are not listed.

## Termination safety

- Inspection commands (`inspect`, `find`, `list`, and the read-only part of
  `<port>`) never signal a process.
- Termination requires an interactive terminal and a literal `y`/`yes` answer.
  Piped input, closed stdin, and non-TTY environments are treated as “no” and
  no signal is sent.
- The target is revalidated immediately before each signal using its process
  start marker and name, so a recycled PID is refused.
- Force termination always requires a second confirmation after graceful
  termination fails or is refused. A graceful request that fails because of
  permissions stops the workflow instead; escalation is never attempted.
- PID 1, PortPilot's own PID, and a list of critical system process names
  (`launchd`, `systemd`, `init`, `csrss`, `lsass`, `svchost`, and others) are
  always refused.
- If the owning PID cannot be identified, `free` refuses to guess.
- PortPilot never escalates privileges (no `sudo`, no UAC re-launch). Permission
  errors are reported with an explanation.
- Process command-line strings are only displayed; they are never executed.
- Stale PIDs and processes that exit during inspection or termination are
  reported as already gone rather than retried blindly.

## Exit codes

- `0` — command completed and the requested state was reached (for example a
  free port, or a successful termination).
- `1` — invalid input, incomplete discovery, unknown owner, refused or failed
  termination, no confirmation possible, or the port is still occupied
  afterwards.

User cancellation sends no signal. `free` still exits `1` if the port remains
occupied after cancellation, so scripts can distinguish “freed” from “not
freed”.

## CI

`.github/workflows/portpilot.yml` runs the suite on macOS, Linux, and Windows
with Node.js 18 and 24, plus type checking, linting, formatting, and a
packaged-CLI installation check on Linux.

## Development

```bash
npm run build        # TypeScript -> dist/
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run format:check # Prettier
npm test             # builds, then runs the full node --test suite
npm run test:unit
npm run test:integration
```

The integration tests create ephemeral loopback TCP servers and controlled
child processes. They only terminate those child processes and never touch
unrelated system services. Platform-specific tests are skipped when the
required operating system feature is not available.

See [BUILD.md](BUILD.md) for the build, test, and packaging details.

## Limitations

- Cross-platform discovery is implemented for macOS, Linux, and Windows.
  macOS and Linux have been exercised end-to-end, including the Linux `/proc`
  fallback integration test. Windows has parser coverage and CI configuration
  but has not yet produced a green CI run in this repository.
- Only TCP listeners are supported.
- Processes owned by other users may not expose their PID or command line
  without elevated privileges. PortPilot reports the limitation instead of
  escalating.
- On macOS, `ps` may hide command-line arguments of processes owned by other
  users.
- On Windows, `taskkill /PID` (without `/F`) sends a close request that some
  console applications ignore; the force confirmation path then applies.
- Ports can change between discovery and termination. PortPilot revalidates the
  target, but cannot make the check and the signal atomic.
- The tool is not published to npm yet.

## License

MIT. See [LICENSE](LICENSE).

Copyright (c) 2026 Infinity™
