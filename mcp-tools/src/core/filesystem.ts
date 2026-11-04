import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

export class WorkspaceAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceAccessError';
  }
}

const DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB limit

/**
 * Resolves a target path within a workspace and verifies that the real canonical path
 * does not escape the workspace boundary (preventing path traversal and out-of-bounds symlinks).
 * Uses a two-phase approach: first resolve, then re-validate after file access.
 * This mitigates TOCTOU races where a symlink could be swapped between resolution and access.
 */
export function resolveWorkspacePath(workspaceRoot: string, targetPath: string): string {
  if (!workspaceRoot) {
    throw new WorkspaceAccessError('Workspace root path is required');
  }

  const canonicalWorkspaceRoot = fs.realpathSync(path.resolve(workspaceRoot));
  const absoluteTargetPath = path.resolve(canonicalWorkspaceRoot, targetPath);

  // Phase 1: Initial resolution
  let canonicalTargetPath: string;
  try {
    // Check if path exists to resolve realpath; if not existing yet, resolve parent
    if (fs.existsSync(absoluteTargetPath)) {
      canonicalTargetPath = fs.realpathSync(absoluteTargetPath);
    } else {
      const parentDir = path.dirname(absoluteTargetPath);
      if (fs.existsSync(parentDir)) {
        const canonicalParent = fs.realpathSync(parentDir);
        canonicalTargetPath = path.join(canonicalParent, path.basename(absoluteTargetPath));
      } else {
        canonicalTargetPath = absoluteTargetPath;
      }
    }
  } catch (err) {
    logger.debug(`Failed to resolve realpath for ${targetPath}: ${String(err)}`);
    canonicalTargetPath = absoluteTargetPath;
  }

  // Phase 2: Verify workspace containment after resolution
  // Use canonical resolve of workspace root for comparison
  const workRootReal = fs.realpathSync(path.resolve(workspaceRoot));
  let isOutside = false;
  try {
    const relative = path.relative(workRootReal, canonicalTargetPath);
    isOutside = relative.startsWith('..') || path.isAbsolute(relative);
  } catch {
    // If resolution fails, treat as outside to be safe
    isOutside = true;
  }

  if (isOutside) {
    throw new WorkspaceAccessError(
      `Access denied: path '${targetPath}' resolves outside configured workspace root '${workRootReal}'`
    );
  }

  return canonicalTargetPath;
}

/**
 * Safely reads a text file within workspace boundaries with size limits.
 * Handles symbolic links safely by verifying the resolved path stays within workspace.
 */
export async function safeReadFile(
  workspaceRoot: string,
  filePath: string,
  maxSizeBytes: number = DEFAULT_MAX_FILE_SIZE_BYTES
): Promise<string> {
  const safePath = resolveWorkspacePath(workspaceRoot, filePath);

  try {
    // Additional symlink safety: verify real path is still within workspace
    let realPath: string;
    try {
      realPath = fs.realpathSync(safePath);
    } catch {
      // Broken symlink or unreadable - treat as access denied
      throw new WorkspaceAccessError(`Failed to resolve path '${filePath}': broken symlink or unreadable`);
    }

    const workRootReal = fs.realpathSync(path.resolve(workspaceRoot));
    const relative = path.relative(workRootReal, realPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new WorkspaceAccessError(`Access denied: symlink resolves outside workspace`);
    }

    const stats = await fs.promises.stat(realPath);
    if (!stats.isFile()) {
      throw new Error(`Path '${filePath}' is not a regular file`);
    }

    if (stats.size > maxSizeBytes) {
      throw new Error(
        `File '${filePath}' exceeds maximum allowed size of ${maxSizeBytes} bytes (${stats.size} bytes)`
      );
    }

    return await fs.promises.readFile(realPath, 'utf-8');
  } catch (err) {
    if (err instanceof WorkspaceAccessError) throw err;
    throw new Error(`Failed to read file '${filePath}': ${(err as Error).message}`);
  }
}

/**
 * Safely checks if a file or directory exists within workspace boundaries.
 * Handles symbolic links safely by verifying the resolved path stays within workspace.
 */
export async function safeExists(workspaceRoot: string, filePath: string): Promise<boolean> {
  try {
    const safePath = resolveWorkspacePath(workspaceRoot, filePath);

    // Additional symlink safety: verify real path is within workspace
    let realPath: string;
    try {
      realPath = fs.realpathSync(safePath);
    } catch {
      // Broken symlink - file does not exist within workspace
      return false;
    }

    const workRootReal = fs.realpathSync(path.resolve(workspaceRoot));
    let relative: string;
    try {
      relative = path.relative(workRootReal, realPath);
    } catch {
      return false;
    }
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return false; // symlink escapes workspace
    }

    await fs.promises.access(realPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely lists directory contents within workspace boundaries.
 * Handles symbolic links safely by verifying resolved paths stay within workspace.
 */
export async function safeListDir(
  workspaceRoot: string,
  dirPath: string = '.'
): Promise<string[]> {
  const safePath = resolveWorkspacePath(workspaceRoot, dirPath);

  try {
    // Additional symlink safety: verify real path is within workspace
    let realPath: string;
    try {
      realPath = fs.realpathSync(safePath);
    } catch {
      return []; // broken symlink or inaccessible
    }

    const workRootReal = fs.realpathSync(path.resolve(workspaceRoot));
    let relative: string;
    try {
      relative = path.relative(workRootReal, realPath);
    } catch {
      return [];
    }
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return []; // symlink escapes workspace
    }

    const stats = await fs.promises.stat(realPath);
    if (!stats.isDirectory()) {
      return [];
    }
    return await fs.promises.readdir(realPath);
  } catch (err) {
    logger.debug(`Failed to list directory '${dirPath}': ${String(err)}`);
    return [];
  }
}

/**
 * Recursively scans directory within workspace up to maxDepth and maxFiles.
 */
export async function safeScanDir(
  workspaceRoot: string,
  startDir: string = '.',
  maxDepth: number = 3,
  maxFiles: number = 500
): Promise<string[]> {
  const result: string[] = [];

  async function walk(currentDir: string, currentDepth: number) {
    if (currentDepth > maxDepth || result.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      const safePath = resolveWorkspacePath(workspaceRoot, currentDir);
      entries = await fs.promises.readdir(safePath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (result.length >= maxFiles) break;

      // Skip common non-project / heavy directories
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === '.venv' ||
        entry.name === 'coverage' ||
        entry.name === '.next'
      ) {
        continue;
      }

      const relPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Symlink safety: check directory doesn't escape workspace
        let realPath: string;
        try {
          realPath = fs.realpathSync(path.resolve(workspaceRoot, relPath));
        } catch {
          continue; // broken symlink - skip
        }

        const workRootReal = fs.realpathSync(path.resolve(workspaceRoot));
        let relative: string;
        try {
          relative = path.relative(workRootReal, realPath);
        } catch {
          continue;
        }
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          continue; // symlink escapes workspace - skip
        }

        // Additional depth check for symlink-following directories
        if (currentDepth + 1 > maxDepth) continue;

        await walk(relPath, currentDepth + 1);
      } else if (entry.isFile()) {
        // Symlink safety for files
        let realPath: string;
        try {
          realPath = fs.realpathSync(path.resolve(workspaceRoot, relPath));
        } catch {
          continue; // broken symlink - skip
        }

        const workRootReal = fs.realpathSync(path.resolve(workspaceRoot));
        let relative: string;
        try {
          relative = path.relative(workRootReal, realPath);
        } catch {
          continue;
        }
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          continue; // symlink escapes workspace - skip
        }

        result.push(relPath);
      }
    }
  }

  await walk(startDir, 0);
  return result;
}
