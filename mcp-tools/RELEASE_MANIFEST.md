# Release Manifest — Infinity MCP Toolbox

## Package Identity

- **Name**: infinity-mcp-toolbox
- **Version**: 0.1.0
- **Author**: Infinity™
- **License**: MIT
- **Repository**: https://github.com/erfmollaey/infinite-toolbox
- **Repository directory**: mcp-tools
- **Homepage**: https://github.com/erfmollaey/infinite-toolbox/tree/main/mcp-tools
- **Bugs**: https://github.com/erfmollaey/infinite-toolbox/issues
- **Purpose**: Lightweight, secure, read-only MCP tools providing AI coding agents with structured insights into local development projects.
- **Distribution model**: CLI-only executable MCP server (stdio transport). Not a programmatic import library.

## Runtime

- **Supported Node.js**: >= 18.0.0
- **Module format**: ESM (`"type": "module"`)
- **Entry point**: `dist/index.js`
- **Executable name**: `infinity-mcp-toolbox` (via `bin` field)
- **Runtime dependencies**:
  - `@modelcontextprotocol/sdk` ^1.6.0
  - `zod` ^3.24.1
- **Type declarations**: `dist/index.d.ts` (present but no supported programmatic import API)

## Included Tools

| Tool name | Description |
|---|---|
| `infinity_project_doctor` | Analyzes project structure, detects project types, identifies missing recommended files |
| `infinity_git_context` | Provides structured Git working tree information (branch, status, diff stats) |
| `infinity_environment_inspector` | Inspects environment configuration templates without exposing values |
| `infinity_dependency_inspector` | Analyzes package dependencies across supported manifest formats |

### Security boundaries per tool
- **Project Doctor**: Read-only filesystem scan within workspace boundaries.
- **Git Context**: Read-only Git subprocess execution with env isolation; diff redaction and sensitive-file exclusion.
- **Environment Inspector**: Reads only approved template files (`.env.example`, etc.); never reads `.env` or `process.env`.
- **Dependency Inspector**: Parses `package.json` and `requirements.txt` only; enforces 10,000 processed / 1,000 returned limits.

## Security Properties (Verified)

- Read-only: All tools are strictly read-only. No file modifications or write operations.
- Workspace boundary enforcement: Centralized `resolveWorkspacePath` with `fs.realpathSync` containment checks.
- Path traversal protection: Relative containment check rejects `../` and absolute path escapes.
- Symlink escape protection: Realpath re-verification in all `safe*` filesystem functions.
- Sensitive-file filtering: `.env`, `*.pem`, `*.key`, `id_rsa`, `credentials.json`, etc. excluded from diff output.
- Environment template allowlisting: Only `.env.example`, `.env.sample`, `.env.template`, `.env.dist`, `.env.example.local` are read.
- Secret redaction: Regex-based `redactSecrets` applied to diff output (best-effort, not guaranteed).
- Git subprocess shell isolation: `spawn` with `shell: false`, fixed allowlisted arguments.
- Git timeout: 30,000ms default (configurable internally for tests).
- Git output limits: 1MB stdout/stderr cap; 10KB diff summary cap.
- Git environment isolation: Dangerous `GIT_*` variables removed; `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`.
- Dependency parsing limits: 10,000 processed / 1,000 returned declarations.
- Structured error handling: Errors caught and returned as JSON without stack traces.
- stdout reserved for MCP protocol: All diagnostics go to stderr (`logger.ts`).
- No arbitrary shell execution: No user-supplied command strings accepted.
- No filesystem write tools: All operations are read-only.

### Residual Limitations (Documented)
- **TOCTOU**: Filesystem realpath checks are not atomic. A concurrent local process could theoretically swap a file between validation and use. Documented in README.
- **Heuristic redaction**: Regex-based secret detection cannot guarantee 100% detection. Mitigated by excluding known sensitive files.
- **Incomplete manifest parsing**: Only `package.json` and `requirements.txt` are parsed. Other detected formats (pyproject.toml, pom.xml, etc.) are detected but not analyzed.
- **POSIX-only test commands**: Git lifecycle tests use `sleep`, `yes`, `sh -c` (macOS/Linux only).
- **No programmatic API**: Package is CLI-only; `dist/index.d.ts` does not expose a supported import API.

## Verification Record

### Quality checks (authoritative)
- **Tests**: 54 passed, 0 failed, 0 skipped (5 test files)
  - `project-doctor.test.ts`: 10
  - `filesystem-security.test.ts`: 11
  - `git-security.test.ts`: 9
  - `environment-inspector-security.test.ts`: 11
  - `dependency-inspector-security.test.ts`: 13
- **Typecheck**: PASS (0 errors)
- **Lint**: PASS (0 errors, 0 warnings)
- **Build**: PASS (TypeScript compilation successful)

### Package verification
- **Tarball**: `infinity-mcp-toolbox-0.1.0.tgz`
- **File count**: 51
- **Compressed size**: 31,162 bytes (30.4 kB)
- **Unpacked size**: 129.3 kB
- **Included**: `dist/`, `README.md`, `LICENSE`, `package.json`
- **Excluded**: `src/`, `tests/`, `node_modules/`, `.env`, credentials, coverage, audit reports
- **Secret scan**: No credentials or `.env` files in package contents
- **Isolated installation**: Successful (npm install from tarball)
- **MCP protocol**: Client initialized, listed 4 tools, invoked each successfully
- **stdout/stderr separation**: Verified (diagnostics on stderr, protocol on stdout)

### Dependency audit
- **Production dependencies**: 0 vulnerabilities
- **Advisory inventory**: None

### Node/npm environment
- **Node version**: v24.22.0
- **npm version**: 11.19.1

## Historical Note

Earlier reports (Phase 2.8.4, Phase 3.0.1) claimed 63 passing tests. A subsequent Vitest JSON reporter run established the definitive count as **54**. The discrepancy was due to overcounting in earlier reports, not missing or removed tests. The exact historical cause cannot be conclusively determined from surviving evidence.

## Source Identity

- **Parent Git commit**: `12d0a9032ee554bb0ba6adac0379bfd7ae61820e`
- **Branch**: `main`
- **Git status**: `mcp-tools/` is untracked
- **Important**: The parent commit does **not** identify the exact package source, because `mcp-tools/` is untracked. The release source must be committed before a reproducible official release can be identified.

## Reproducible Release Procedure

For a future authorized release:

1. Install dependencies: `npm ci` (or `npm install`)
2. Run tests: `npm test`
3. Run typecheck: `npm run typecheck`
4. Run lint: `npm run lint`
5. Build: `npm run build`
6. Inspect package contents: `npm pack --dry-run`
7. Create tarball: `npm pack --pack-destination <temp-dir>`
8. Verify tarball installation in an isolated consumer project
9. Verify MCP stdio protocol (initialize, list tools, invoke tools)
10. Verify production dependencies: `npm audit --omit=dev`
11. Record Git commit hash and package SHA-256 checksum
12. Obtain explicit release authorization
13. Publish only after approval: `npm publish` (NOT authorized in this phase)

## Git and npm Boundaries

### Git
- `mcp-tools/` is currently untracked in the parent repository.
- Recommended: track `src/`, `tests/`, `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `README.md`, `LICENSE`, and `RELEASE_MANIFEST.md`.
- Recommended: do not track `node_modules/`, `dist/`, `coverage/`, temporary archives, logs, or credentials.
- `dist/` should be generated during release, not tracked (build output).

### npm Package
- `files` field: `["dist", "README.md", "LICENSE"]`
- Includes compiled runtime, declarations, documentation, and license.
- Excludes source, tests, node_modules, and development artifacts.

## Final Status

- **Release readiness**: Approved for release preparation.
- **Publishing authorization**: NOT granted. Awaiting explicit authorization.
- **No Git operations performed**: No commits, pushes, tags, or releases.
- **No npm publication performed**.