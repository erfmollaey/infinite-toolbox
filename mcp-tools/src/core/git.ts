import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { resolveWorkspacePath } from './filesystem.js';
import { logger } from '../utils/logger.js';
import { redactSecrets } from '../utils/redaction.js';

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)id_rsa(\.|$)/i,
  /(^|\/)id_ed25519(\.|$)/i,
  /(^|\/)credentials\.json$/i,
  /(^|\/)\.aws\/credentials$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
];

const HARMLESS_ENV_TEMPLATES = ['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.example.local'];
export function isSensitivePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const base = normalized.split('/').pop() || '';
  if (HARMLESS_ENV_TEMPLATES.includes(base.toLowerCase())) return false;
  return SENSITIVE_FILE_PATTERNS.some((re) => re.test(normalized));
}

interface GitExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

const GIT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB cap

export async function safeGitExec(
  workspaceRoot: string,
  args: string[],
  options?: { maxBytes?: number; timeoutMs?: number }
): Promise<GitExecResult> {
  const canonicalRoot = resolveWorkspacePath(workspaceRoot, '.');
  // validate directory exists
  const maxBytes = options?.maxBytes ?? MAX_OUTPUT_BYTES;
  const timeoutMs = options?.timeoutMs ?? GIT_TIMEOUT_MS;

  const env: NodeJS.ProcessEnv = { ...process.env };
  // Remove dangerous inherited vars
  const dangerous = [
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT', 'GIT_EXTERNAL_DIFF', 'GIT_PAGER', 'GIT_SSH',
    'GIT_SSH_COMMAND', 'GIT_ASKPASS'
  ];
  for (const k of dangerous) delete env[k];
  env['GIT_CONFIG_NOSYSTEM'] = '1';
  env['GIT_CONFIG_GLOBAL'] = '/dev/null';
  env['GIT_TERMINAL_PROMPT'] = '0';
  env['GIT_OPTIONAL_LOCKS'] = '0';
  env['GIT_PAGER'] = 'cat';
  env['PAGER'] = 'cat';

  return new Promise<GitExecResult>((resolvePromise) => {
    const child = spawn('git', args, {
      cwd: canonicalRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let killed = false;

    const timer = setTimeout(() => {
      if (!settled) {
        killed = true;
        child.kill('SIGKILL');
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString('utf8');
      else if (!killed) { killed = true; child.kill('SIGKILL'); }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString('utf8');
      else if (!killed) { killed = true; child.kill('SIGKILL'); }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ stdout, stderr: stderr + String(err), code: -1 });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code });
    });
  });
}

export async function isGitRepository(workspaceRoot: string): Promise<boolean> {
  try {
    // First verify a .git entry exists within workspace (avoids walking up to parent repo)
    const gitPath = resolveWorkspacePath(workspaceRoot, '.git');
    try {
      await fs.promises.stat(gitPath);
    } catch {
      return false;
    }
    const r = await safeGitExec(workspaceRoot, ['rev-parse', '--is-inside-work-tree']);
    return r.code === 0 && r.stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function getCurrentBranch(workspaceRoot: string): Promise<string | null> {
  try {
    const r = await safeGitExec(workspaceRoot, ['symbolic-ref', '--short', 'HEAD']);
    if (r.code === 0) {
      const branch = r.stdout.trim();
      if (branch) return branch;
    }
    // detached
    const r2 = await safeGitExec(workspaceRoot, ['rev-parse', '--short', 'HEAD']);
    if (r2.code === 0) {
      const hash = r2.stdout.trim();
      if (/^[a-f0-9]{7,40}$/.test(hash)) return `detached@${hash.substring(0, 7)}`;
    }
    return null;
  } catch (err) {
    logger.debug(`Failed to read current branch: ${String(err)}`);
    return null;
  }
}

interface GitStatusEntry {
  staged: string;
  unstaged: string;
  path: string;
  origPath?: string;
}

export async function getGitStatus(workspaceRoot: string): Promise<{
  clean: boolean;
  entries: GitStatusEntry[];
}> {
  const entries: GitStatusEntry[] = [];
  try {
    const r = await safeGitExec(workspaceRoot, ['status', '--porcelain=v2', '-z']);
    if (r.code !== 0) return { clean: true, entries: [] };
    // parse NUL-separated
    const records = r.stdout.split('\0');
    for (const rec of records) {
      if (!rec) continue;
      // porcelain v2 with -z: header lines start with #? Actually -z uses NUL; status entries one per NUL
      const line = rec;
      if (line.startsWith('#')) continue;
      const parts = line.split(' ');
      if (parts.length < 2) continue;
      if (parts[0] === '1') {
        const xy = parts[1] || '  ';
        const staged = xy[0] || ' ';
        const unstaged = xy[1] || ' ';
        // path is after 8 fields? with -z, path may contain spaces; reconstruct: join from index 8
        const filePath = parts.slice(8).join(' ');
        entries.push({ staged, unstaged, path: filePath, origPath: '' });
      } else if (parts[0] === '2') {
        const xy = parts[1] || '  ';
        const staged = xy[0] || ' ';
        const unstaged = xy[1] || ' ';
        const filePath = parts[parts.length - 1] || '';
        const origPath = parts.length > 2 ? parts[parts.length - 2] : '';
        entries.push({ staged, unstaged, path: filePath, origPath });
      } else if (parts[0] === '?') {
        const filePath = parts.slice(1).join(' ');
        entries.push({ staged: '?', unstaged: '?', path: filePath, origPath: '' });
      } else if (parts[0] === '!') {
        continue;
      }
    }
    return { clean: entries.length === 0, entries };
  } catch (err) {
    logger.debug(`Failed to get git status: ${String(err)}`);
    return { clean: true, entries: [] };
  }
}

export async function getGitDiffStats(workspaceRoot: string): Promise<{
  filesChanged: number;
  insertions: number;
  deletions: number;
} | null> {
  try {
    const r = await safeGitExec(workspaceRoot, ['diff', '--stat', '--no-ext-diff']);
    if (r.code !== 0) return null;
    const match = r.stdout.match(
      /(\d+)\s+files? changed(?:,\s*(\d+)\s+insertions?\(\+\))?(?:,\s*(\d+)\s+deletions?\(-\))?/
    );
    if (match && match[1]) {
      return {
        filesChanged: parseInt(match[1], 10),
        insertions: parseInt(match[2] || '0', 10),
        deletions: parseInt(match[3] || '0', 10)
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getBoundedDiffSummary(
  workspaceRoot: string,
  maxBytes: number = 10240
): Promise<string | null> {
  try {
    const r = await safeGitExec(workspaceRoot, ['diff', '--no-ext-diff', '--no-textconv', '-U2', '--no-color'], { maxBytes: maxBytes + 1024 });
    if (r.code !== 0) return null;
    if (!r.stdout.trim()) return null;

    // Filter out sensitive files: parse diff headers
    const lines = r.stdout.split('\n');
    const kept: string[] = [];
    let skipCurrent = false;
    let currentFile = '';
    for (const line of lines) {
      const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (m) {
        currentFile = m[2] || m[1] || '';
        skipCurrent = isSensitivePath(currentFile);
        if (skipCurrent) continue;
      }
      if (skipCurrent) continue;
      kept.push(line);
    }
    let out = kept.join('\n');
    // redact secrets
    out = redactSecrets(out);
    if (out.length > maxBytes) {
      out = out.substring(0, maxBytes) + '\n... [diff truncated]';
    }
    return out.trim() ? out : null;
  } catch {
    return null;
  }
}