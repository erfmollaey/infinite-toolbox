import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dependencyInspector } from '../src/tools/dependency-inspector/index.js';

function makeTmp() { return mkdtempSync(join(tmpdir(), 'depsec-')); }

describe('dependency inspector security', () => {
  it('handles malformed package.json', async () => {
    const root = makeTmp();
    writeFileSync(join(root, 'package.json'), '{bad json');
    const r = await dependencyInspector({ workspaceRoot: root });
    expect(r.manifests.length).toBe(0);
    rmSync(root, { recursive: true });
  });

  it('handles invalid dependency maps', async () => {
    const root = makeTmp();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: 'not an object' }));
    const r = await dependencyInspector({ workspaceRoot: root });
    expect(r.manifests[0]?.declaredDependencies).toEqual({});
    rmSync(root, { recursive: true });
  });

  it('empty manifest', async () => {
    const root = makeTmp();
    writeFileSync(join(root, 'package.json'), '{}');
    const r = await dependencyInspector({ workspaceRoot: root });
    expect(r.total_declared_dependencies).toBe(0);
    rmSync(root, { recursive: true });
  });

  it('requirements.txt parsing', async () => {
    const root = makeTmp();
    writeFileSync(join(root, 'requirements.txt'), 'requests==2.0\n# comment\n');
    const r = await dependencyInspector({ workspaceRoot: root });
    expect(Object.keys(r.manifests.find(m=>m.packageManager==='pip')?.declaredDependencies || {})).toContain('requests');
    rmSync(root, { recursive: true });
  });

  // package.json boundaries
  it('package.json exactly 1000 returned entries', async () => {
    const root = makeTmp();
    const deps: Record<string,string> = {};
    for (let i = 0; i < 1000; i++) deps[`pkg${i}`] = '1.0.0';
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: deps }));
    const r = await dependencyInspector({ workspaceRoot: root });
    const m = r.manifests.find(x=>x.packageManager==='npm')!;
    expect(Object.keys(m.declaredDependencies).length).toBe(1000);
    expect(r.truncated).toBe(false);
    rmSync(root, { recursive: true });
  });

  it('package.json more than 1000 returned entries truncates', async () => {
    const root = makeTmp();
    const deps: Record<string,string> = {};
    for (let i = 0; i < 1001; i++) deps[`pkg${i}`] = '1.0.0';
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: deps }));
    const r = await dependencyInspector({ workspaceRoot: root });
    const m = r.manifests.find(x=>x.packageManager==='npm')!;
    expect(Object.keys(m.declaredDependencies).length).toBe(1000);
    expect(r.truncated).toBe(true);
    expect(r.summary).toContain('truncated');
    rmSync(root, { recursive: true });
  });

  it('package.json exactly 10000 processed declarations', async () => {
    const root = makeTmp();
    const deps: Record<string,string> = {};
    for (let i = 0; i < 10000; i++) deps[`pkg${i}`] = '1.0.0';
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: deps }));
    const r = await dependencyInspector({ workspaceRoot: root });
    // 10,000 declarations exceed the 1,000 returned-entry limit, so truncation occurs.
    expect(r.truncated).toBe(true);
    rmSync(root, { recursive: true });
  });

  it('package.json more than 10000 declarations truncates processing', async () => {
    const root = makeTmp();
    const deps: Record<string,string> = {};
    for (let i = 0; i < 10001; i++) deps[`pkg${i}`] = '1.0.0';
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: deps }));
    const r = await dependencyInspector({ workspaceRoot: root });
    expect(r.truncated).toBe(true);
    rmSync(root, { recursive: true });
  });

  // requirements.txt boundaries
  it('requirements.txt ignores comments and blanks', async () => {
    const root = makeTmp();
    writeFileSync(join(root, 'requirements.txt'), '# comment\n\nrequests==2.0\n');
    const r = await dependencyInspector({ workspaceRoot: root });
    const m = r.manifests.find(x=>x.packageManager==='pip')!;
    expect(Object.keys(m.declaredDependencies).length).toBe(1);
    rmSync(root, { recursive: true });
  });

  it('requirements.txt exactly 1000 returned entries', async () => {
    const root = makeTmp();
    const lines = [];
    for (let i = 0; i < 1000; i++) lines.push(`pkg${i}==1.0.0`);
    writeFileSync(join(root, 'requirements.txt'), lines.join('\n'));
    const r = await dependencyInspector({ workspaceRoot: root });
    const m = r.manifests.find(x=>x.packageManager==='pip')!;
    expect(Object.keys(m.declaredDependencies).length).toBe(1000);
    expect(r.truncated).toBe(false);
    rmSync(root, { recursive: true });
  });

  it('requirements.txt more than 1000 returned entries truncates', async () => {
    const root = makeTmp();
    const lines = [];
    for (let i = 0; i < 1001; i++) lines.push(`pkg${i}==1.0.0`);
    writeFileSync(join(root, 'requirements.txt'), lines.join('\n'));
    const r = await dependencyInspector({ workspaceRoot: root });
    const m = r.manifests.find(x=>x.packageManager==='pip')!;
    expect(Object.keys(m.declaredDependencies).length).toBe(1000);
    expect(r.truncated).toBe(true);
    rmSync(root, { recursive: true });
  });

  it('requirements.txt exactly 10000 processed declarations', async () => {
    const root = makeTmp();
    const lines = [];
    for (let i = 0; i < 10000; i++) lines.push(`pkg${i}==1.0.0`);
    writeFileSync(join(root, 'requirements.txt'), lines.join('\n'));
    const r = await dependencyInspector({ workspaceRoot: root });
    // 10,000 declarations exceed the 1,000 returned-entry limit, so truncation occurs.
    expect(r.truncated).toBe(true);
    rmSync(root, { recursive: true });
  });

  it('requirements.txt more than 10000 declarations truncates', async () => {
    const root = makeTmp();
    const lines = [];
    for (let i = 0; i < 10001; i++) lines.push(`pkg${i}==1.0.0`);
    writeFileSync(join(root, 'requirements.txt'), lines.join('\n'));
    const r = await dependencyInspector({ workspaceRoot: root });
    expect(r.truncated).toBe(true);
    rmSync(root, { recursive: true });
  });
});