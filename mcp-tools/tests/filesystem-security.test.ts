import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeReadFile, safeExists, safeScanDir } from '../src/core/filesystem.js';

function makeTmp() { return mkdtempSync(join(tmpdir(), 'fssec-')); }

describe('filesystem security', () => {
  it('reads workspace-relative file', async () => {
    const root = makeTmp();
    writeFileSync(join(root, 'a.txt'), 'hello');
    expect(await safeReadFile(root, 'a.txt')).toBe('hello');
    rmSync(root, { recursive: true });
  });

  it('rejects parent traversal', async () => {
    const root = makeTmp();
    await expect(safeReadFile(root, '../secret.txt')).rejects.toThrow();
    rmSync(root, { recursive: true });
  });

  it('rejects absolute escape', async () => {
    const root = makeTmp();
    await expect(safeReadFile(root, '/etc/passwd')).rejects.toThrow();
    rmSync(root, { recursive: true });
  });

  it('rejects symlink escape', async () => {
    const root = makeTmp();
    const outside = makeTmp();
    writeFileSync(join(outside, 'secret.txt'), 'SECRET');
    try { symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt')); } catch { return; }
    await expect(safeReadFile(root, 'link.txt')).rejects.toThrow();
    rmSync(root, { recursive: true });
    rmSync(outside, { recursive: true });
  });

  it('handles broken symlink', async () => {
    const root = makeTmp();
    try { symlinkSync('/nonexistent/path', join(root, 'broken')); } catch { return; }
    expect(await safeExists(root, 'broken')).toBe(false);
    rmSync(root, { recursive: true });
  });

  it('enforces size limit', async () => {
    const root = makeTmp();
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(2000));
    await expect(safeReadFile(root, 'big.txt', 100)).rejects.toThrow(/exceeds/);
    rmSync(root, { recursive: true });
  });

  it('scan depth limits', async () => {
    const root = makeTmp();
    mkdirSync(join(root, 'a', 'b', 'c'), { recursive: true });
    writeFileSync(join(root, 'a', 'b', 'c', 'deep.txt'), 'x');
    const files = await safeScanDir(root, '.', 1, 500);
    expect(files.some(f => f.includes('deep.txt'))).toBe(false);
    rmSync(root, { recursive: true });
  });

  it('scan entry limit below', async () => {
    const root = makeTmp();
    for (let i = 0; i < 3; i++) writeFileSync(join(root, `f${i}.txt`), 'x');
    const files = await safeScanDir(root, '.', 3, 5);
    expect(files.length).toBeLessThanOrEqual(5);
    rmSync(root, { recursive: true });
  });

  it('scan entry limit above', async () => {
    const root = makeTmp();
    for (let i = 0; i < 600; i++) writeFileSync(join(root, `f${i}.txt`), 'x');
    const files = await safeScanDir(root, '.', 3, 500);
    expect(files.length).toBeLessThanOrEqual(500);
    rmSync(root, { recursive: true });
  });

  it('scan symlink escape excluded', async () => {
    const root = makeTmp();
    const outside = makeTmp();
    writeFileSync(join(outside, 'secret.txt'), 'SECRET');
    try { symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt')); } catch { return; }
    const files = await safeScanDir(root, '.', 3, 500);
    expect(files.some(f => f.includes('secret.txt'))).toBe(false);
    rmSync(root, { recursive: true });
    rmSync(outside, { recursive: true });
  });

  it('scan nested dirs respected', async () => {
    const root = makeTmp();
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    writeFileSync(join(root, 'a', 'b', 'x.txt'), 'x');
    const files = await safeScanDir(root, '.', 2, 500);
    expect(files.some(f => f.includes('x.txt'))).toBe(true);
    rmSync(root, { recursive: true });
  });
});