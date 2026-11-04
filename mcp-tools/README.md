# Infinity MCP Toolbox

A collection of lightweight, secure, read-only MCP tools designed to provide AI coding agents with structured insights into local development projects.

## Overview

Infinity MCP Toolbox is part of the Infinite Toolbox monorepo ecosystem. It provides AI agents (OpenCode, Cursor, and other MCP-compatible clients) with tools to analyze local development projects without any write capabilities or security risks.

All tools are strictly read-only, operate within configured workspace boundaries, and never expose secrets or credentials.

## Features

- **Project Analysis**: Analyze project structure, detect project types, and identify missing recommended files
- **Git Context**: Get structured information about Git repositories including branches, working tree status, and diff statistics
- **Environment Inspection**: Inspect environment configuration templates without exposing any values
- **Dependency Analysis**: Analyze package dependencies across multiple package managers (npm, pip, Maven, Gradle, Cargo, Composer, Bundler)
- **Security First**: All tools are read-only with centralized workspace access control
- **MCP Compatible**: Works with OpenCode, Cursor, and other MCP clients via standard Model Context Protocol

## Installation

This package is part of the Infinite Toolbox monorepo. After cloning the main repository:

```bash
# Navigate to the package directory
cd mcp-tools

# Install dependencies
npm install

# Build TypeScript
npm run build
```

## Build Instructions

```bash
# TypeScript compilation
npm run build

# Type checking only
npm run typecheck

# Linting
npm run lint

# Format check
npm run format:check

# Run tests
npm run test
```

## Development Instructions

```bash
# Start the MCP server
node dist/index.js

# Start with watch
npm run build -- --watch

# Run tests in watch mode
npm run test:watch
```

## Testing Instructions

Run the full test suite:

```bash
npm test
```

The tests focus on meaningful behavior:

- Tool registration and discovery
- Input validation
- Project type detection
- Git status parsing
- Environment variable extraction (without values)
- Path traversal prevention
- Symlink handling
- Error handling
- Structured MCP response validation

Use temporary test directories; tests do not depend on the developer's actual environment.

## MCP Client Configuration

### OpenCode Configuration

OpenCode uses MCP client configuration. For the Infinity MCP Toolbox, add to your `.opencode` configuration:

```json
{
  "mcp": {
    "servers": {
      "infinity-mcp-toolbox": {
        "command": "npx",
        "args": ["infinity-mcp-toolbox"],
        "cwd": "path/to/your/project",
        "env": {}
      }
    }
  }
}
```

### Cursor Configuration

In Cursor, add the Infinity MCP Toolbox server to your MCP servers:

```json
{
  "servers": {
    "infinity-mcp-toolbox": {
      "command": "npx",
      "args": ["infinity-mcp-toolbox"],
      "cwd": "/path/to/workspace",
      "env": {}
    }
  }
}
```

### Generic MCP Client Configuration

```bash
# Start with a specific working directory
npx infinity-mcp-toolbox --workspace /path/to/project
```

## Available Tools

### 1. infinity_project_doctor

Analyzes the structure and basic health of a local development project.

**Input Parameters:**
- `workspace_root` (optional): Path to the project workspace. Defaults to current directory.

**Returns:**
- `project_type`: Detected project types (node, typescript, python, rust, go, java, php, ruby, docker, unknown)
- `detected_files`: List of configuration files found
- `available_scripts`: Available npm/Yarn scripts
- `missing_recommended_files`: Recommended files not found
- `warnings`: Any warnings about project health
- `summary`: Summary string with key metrics

### 2. infinity_git_context

Provides structured information about the current Git working tree.

**Input Parameters:**
- `workspace_root` (optional): Path to the Git repository. Defaults to current directory.

**Returns:**
- `is_git_repo`: Whether the directory is a Git repository
- `current_branch`: Current Git branch or "detached@..." if detached
- `working_tree_clean`: Whether working tree is clean
- `modified_files`, `added_files`, `deleted_files`: Categorized file changes
- `untracked_files`: Untracked files
- `staged_changes`, `unstaged_changes`: Lists of staged and unstaged changes
- `diff_stats`: Statistics about diff changes
- `bounded_diff_summary`: Limited diff summary (truncated)
- `summary`: Summary string

### 3. infinity_environment_inspector

Inspects environment configuration without exposing secrets.

**Input Parameters:**
- `workspace_root` (optional): Path to the project workspace. Defaults to current directory.

**Returns:**
- `detected_template_files`: Template files found (.env.example, etc.)
- `detected_env_files`: .env files found
- `template_variable_names`: Environment variable names from templates
- `configured_variable_names`: Environment variable names detected from process.env
- `missing_variables`: Variables in templates not in configured variables
- `duplicate_variable_declarations`: Variables appearing multiple times
- `warnings`: Warnings about environment configuration
- `summary`: Summary string

### 4. infinity_dependency_inspector

Analyzes project dependencies and identifies potential maintenance issues.

**Input Parameters:**
- `workspace_root` (optional): Path to the project workspace. Defaults to current directory.

**Returns:**
- `manifests`: Array of detected dependency manifest files with details
- `total_declared_dependencies`: Total number of declared dependencies
- `duplicate_declarations`: Packages declared in both dependencies and devDependencies
- `version_constraint_warnings`: Packages with unconstrained versions
- `potentially_unused`: Packages that might be unused (basic heuristic)
- `summary`: Summary string

## Security Model

Infinity MCP Toolbox is built with security as a first-class requirement:

### Core Security Principles

1. **Read-Only Only**: All tools are strictly read-only. No file modifications are possible.

2. **Workspace Boundaries**: Filesystem access is restricted to a configurable workspace root. Path traversal is prevented.

3. **Path Resolution**: All paths are resolved and validated against the workspace root using canonical (realpath) resolution.

4. **No Command Execution**: Never executes arbitrary shell commands or Git operations with user-supplied parameters.

5. **Secret Redaction**: Environment variable values are never returned. Keys are validated to be non-sensitive.

6. **Output Size Limits**: File sizes, outputs, and diffs are bounded to prevent denial-of-service attacks.

7. **Symlink Safety**: Symbolic links are handled carefully without escaping workspace boundaries.

### Implementation Details

- **Safe Filesystem Access**: Centralized `resolveWorkspacePath` function ensures all reads stay within the workspace
- **Git Safety**: Uses `git status --porcelain=v2` for structured reading (no arbitrary command execution)
- **Environment Safety**: Only variable names are extracted, never values
- **Diff Limits**: Bounded diff summaries prevent excessive output (10KB default)
- **File Size Limits**: Files larger than 1MB are rejected

### Filesystem Security Limitations

The implementation uses path resolution and realpath containment checks to reduce traversal and symlink risks. These checks do not guarantee atomic filesystem access: a filesystem entry could theoretically change between validation and use. The current implementation does not provide a complete open-by-file-descriptor race-proof guarantee.

### MCP Transport Security

- All diagnostic logging goes to stderr
- stdout is reserved exclusively for MCP JSON-RPC protocol communication
- The stdio transport ensures proper protocol compliance

## Current Limitations

1. **Basic Dependency Analysis**: Limited to declaration parsing; no source code analysis for unused dependencies

2. **Limited Manifest Support**: Supports major package managers but newer or proprietary manifests may be missed

3. **Basic Version Constraints**: Limited validation of version ranges; only checks for unconstrained versions

4. **No Authentication**: Tools work on any Git repository without authentication

5. **No Network Access**: All tools operate offline; no cloud-based analysis

6. **Basic Project Detection**: Project type detection is based on file presence, not content analysis

## Testing

Run tests to verify functionality:

```bash
npm test
```

Tests validate:
- Tool registration and discovery via MCP protocol
- Input validation and error handling
- Project detection accuracy
- Git status parsing (excluding real repository data)
- Environment variable extraction (without values)
- Path traversal prevention
- Symlink handling
- Secret redaction

All tests use temporary directories to avoid depending on the developer's environment.

## Contributing

See the parent [Infinite Toolbox README](https://github.com/Infinite-Toolbox/infinite-toolbox) for contribution guidelines.

## License

MIT License. See LICENSE file in the package root.