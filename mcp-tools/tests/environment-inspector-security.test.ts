import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { environmentInspector } from '../src/tools/environment-inspector/index.js';

function makeTmp() { return mkdtempSync(join(tmpdir(), 'envsec-')); }

describe('environment inspector security', () => {
  it('reads only templates, never .env values', async () => {
    const root = makeTmp();
    writeFileSync(join(root, '.env'), 'SECRET=supersecretvalue999');
    writeFileSync(join(root, '.env.example'), 'API_KEY=\nDB_URL=');
    const r = await environmentInspector({ workspaceRoot: root });
    const out = JSON.stringify(r);
    expect(out).not.toContain('supersecretvalue999');
    expect(r.template_variable_names).toContain('API_KEY');
    rmSync(root, { recursive: true });
  });

  it('handles malformed and oversized templates', async () => {
    const root = makeTmp();
    writeFileSync(join(root, '.env.example'), '===\n!!!\nA=');
    const r = await environmentInspector({ workspaceRoot: root });
    expect(r).toBeDefined();
    rmSync(root, { recursive: true });
  });

  it('does not expose process.env', async () => {
    const root = makeTmp();
    const r = await environmentInspector({ workspaceRoot: root });
    expect(r.configured_variable_names).toEqual([]);
    rmSync(root, { recursive: true });
  });

  it('handles empty template', async () => {
    const root = makeTmp();
    writeFileSync(join(root, '.env.example'), '');
    const r = await environmentInspector({ workspaceRoot: root });
    expect(r.template_variable_names).toEqual([]);
    rmSync(root, { recursive: true });
  });

  it('handles CRLF line endings', async () => {
    const root = makeTmp();
    writeFileSync(join(root, '.env.example'), 'FOO=bar\r\nBAZ=qux\r\n');
    const r = await environmentInspector({ workspaceRoot: root });
    expect(r.template_variable_names).toContain('FOO');
    expect(r.template_variable_names).toContain('BAZ');
    rmSync(root, { recursive: true });
  });

  it('handles duplicate variable names', async () => {
    const root = makeTmp();
    writeFileSync(join(root, '.env.example'), 'FOO=1\nFOO=2\n');
    const r = await environmentInspector({ workspaceRoot: root });
    expect(r.duplicate_variable_declarations['FOO']).toBeGreaterThan(0);
    rmSync(root, { recursive: true });
  });

  it('handles values with equals signs', async () => {
    const root = makeTmp();
    writeFileSync(join(root, '.env.example'), 'URL=http://x?a=1&b=2\n');
    const r = await environmentInspector({ workspaceRoot: root });
    expect(r.template_variable_names).toContain('URL');
    const out = JSON.stringify(r);
    expect(out).not.toContain('http://x');
    rmSync(root, { recursive: true });
  });

  it('handles quoted values without leaking', async () => {
    const root = makeTmp();
    writeFileSync(join(root, '.env.example'), 'SECRET="supersecretvalue777"\n');
    const r = await environmentInspector({ workspaceRoot: root });
    const out = JSON.stringify(r);
    expect(out).not.toContain('supersecretvalue777');
    rmSync(root, { recursive: true });
  });

  it('handles oversized template', async () => {
    const root = makeTmp();
    writeFileSync(join(root, '.env.example'), 'X=' + 'a'.repeat(70000));
    const r = await environmentInspector({ workspaceRoot: root });
    // safeReadFile enforces 64KB; should not crash
    expect(r).toBeDefined();
    rmSync(root, { recursive: true });
  });

  it('handles multiple approved templates', async () => {
    const root = makeTmp();
    writeFileSync(join(root, '.env.example'), 'A=1\n');
    writeFileSync(join(root, '.env.sample'), 'B=2\n');
    const r = await environmentInspector({ workspaceRoot: root });
    expect(r.detected_template_files.length).toBe(2);
    rmSync(root, { recursive: true });
  });

  it('never reads actual .env', async () => {
    const root = makeTmp();
    writeFileSync(join(root, '.env'), 'LEAK=shouldnotappear');
    writeFileSync(join(root, '.env.local'), 'LEAK2=shouldnotappear2');
    const r = await environmentInspector({ workspaceRoot: root });
    const out = JSON.stringify(r);
    expect(out).not.toContain('shouldnotappear');
    rmSync(root, { recursive: true });
  });
});