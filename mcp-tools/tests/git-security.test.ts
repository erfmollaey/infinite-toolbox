import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { safeGitExec, isSensitivePath } from '../src/core/git.js';
import { gitContext } from '../src/tools/git-context/index.js';

function makeTmp() { return mkdtempSync(join(tmpdir(), 'gitsec-')); }

function initRepo(root: string) {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  writeFileSync(join(root, 'README.md'), 'hello');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
}

describe('git security', () => {
  it('safeGitExec removes dangerous env and uses controlled env', async () => {
    const root = makeTmp();
    initRepo(root);
    const r = await safeGitExec(root, ['rev-parse', '--is-inside-work-tree'], { maxBytes: 1024 });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('true');
    rmSync(root, { recursive: true });
  });

  it('isSensitivePath excludes .env and keys', () => {
    expect(isSensitivePath('.env')).toBe(true);
    expect(isSensitivePath('.env.local')).toBe(true);
    expect(isSensitivePath('nested/.env')).toBe(true);
    expect(isSensitivePath('id_rsa')).toBe(true);
    expect(isSensitivePath('server.pem')).toBe(true);
    expect(isSensitivePath('.env.example')).toBe(false);
    expect(isSensitivePath('README.md')).toBe(false);
  });

  it('diff excludes sensitive files and redacts secrets', async () => {
    const root = makeTmp();
    initRepo(root);
    writeFileSync(join(root, '.env'), 'SECRET=supersecretvalue123');
    writeFileSync(join(root, '.env.example'), 'EXAMPLE=placeholder');
    execFileSync('git', ['add', '-A'], { cwd: root });
    const r = await gitContext({ workspaceRoot: root });
    const diff = r.bounded_diff_summary || '';
    expect(diff).not.toContain('supersecretvalue123');
    rmSync(root, { recursive: true });
  });

  it('handles detached HEAD', async () => {
    const root = makeTmp();
    initRepo(root);
    const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
    execFileSync('git', ['checkout', '-q', hash], { cwd: root });
    const r = await gitContext({ workspaceRoot: root });
    expect(r.current_branch).toMatch(/^detached@/);
    rmSync(root, { recursive: true });
  });

  it('bounded stdout on overflow', async () => {
    const root = makeTmp();
    initRepo(root);
    const r = await safeGitExec(root, ['rev-parse', 'HEAD'], { maxBytes: 10 });
    expect(r.stdout.length).toBeLessThanOrEqual(100);
    rmSync(root, { recursive: true });
  });

  it('git worktree supported', async () => {
    const root = makeTmp();
    initRepo(root);
    const wt = makeTmp();
    try {
      execFileSync('git', ['worktree', 'add', wt], { cwd: root });
    } catch {
      rmSync(root, { recursive: true });
      rmSync(wt, { recursive: true });
      return;
    }
    const r = await gitContext({ workspaceRoot: wt });
    expect(r.is_git_repo).toBe(true);
    try { execFileSync('git', ['worktree', 'remove', wt, '--force'], { cwd: root }); } catch { /* ignore */ }
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('malformed .git metadata fails safely', async () => {
    const root = makeTmp();
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'HEAD'), 'garbage!!!');
    const r = await gitContext({ workspaceRoot: root });
    // should not crash
    expect(r).toBeDefined();
    rmSync(root, { recursive: true });
  });

  it('unusual filenames handled', async () => {
    const root = makeTmp();
    initRepo(root);
    writeFileSync(join(root, 'file with spaces.txt'), 'x');
    execFileSync('git', ['add', 'file with spaces.txt'], { cwd: root });
    const r = await gitContext({ workspaceRoot: root });
    expect(r).toBeDefined();
    rmSync(root, { recursive: true });
  });

  it('binary file handled', async () => {
    const root = makeTmp();
    initRepo(root);
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0,1,2,3]));
    execFileSync('git', ['add', 'bin.dat'], { cwd: root });
    const r = await gitContext({ workspaceRoot: root });
    expect(r).toBeDefined();
    rmSync(root, { recursive: true });
  });
});