import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolve } from 'node:path';
import { detectProjectType, detectConfigurationFiles, detectAvailableScripts, detectGitPresence, getMissingRecommendedFiles } from '../mcp-tools/src/core/project-detection.js';
import { projectDoctor } from '../mcp-tools/src/tools/project-doctor/index.js';
import { gitContext } from '../mcp-tools/src/tools/git-context/index.js';

const TEST_DIR = resolve(import.meta.dirname, 'test-data');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Project Doctor', () => {
  it('should detect project type when package.json exists', async () => {
    const result = await projectDoctor({ workspaceRoot: `${TEST_DIR}/node-project` });
    expect(result.project_type).toContain('node');
    expect(result.summary).toBeDefined();
  });

  it('should detect missing recommended files', async () => {
    const result = await projectDoctor({ workspaceRoot: `${TEST_DIR}/node-project` });
    expect(result.missing_recommended_files).toBeDefined();
    expect(Array.isArray(result.missing_recommended_files)).toBe(true);
  });

  it('should detect available scripts', async () => {
    const result = await projectDoctor({ workspaceRoot: `${TEST_DIR}/node-project` });
    expect(result.available_scripts).toBeDefined();
    expect(typeof result.available_scripts).toBe('object');
  });

  it('should return structured result', async () => {
    const result = await projectDoctor({ workspaceRoot: `${TEST_DIR}/node-project` });
    expect(result).toHaveProperty('project_type');
    expect(result).toHaveProperty('detected_files');
    expect(result).toHaveProperty('available_scripts');
    expect(result).toHaveProperty('missing_recommended_files');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('summary');
  });
});

describe('Project Detection', () => {
  it('should detect node project type', async () => {
    const result = await detectProjectType({ workspaceRoot: `${TEST_DIR}/node-project` });
    expect(result).toContain('node');
  });

  it('should detect configuration files', async () => {
    const result = await detectConfigurationFiles({ workspaceRoot: `${TEST_DIR}/node-project` });
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it('should detect available scripts', async () => {
    const result = await detectAvailableScripts({ workspaceRoot: `${TEST_DIR}/node-project` });
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  it('should detect git presence', async () => {
    const result = await detectGitPresence({ workspaceRoot: `${TEST_DIR}/node-project` });
    expect(result).toBeDefined();
    expect(typeof result).toBe('boolean');
  });

  it('should find missing recommended files', async () => {
    const result = await getMissingRecommendedFiles({ workspaceRoot: `${TEST_DIR}/node-project` });
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('Git Context', () => {
  it('should handle non-git repository', async () => {
    const result = await gitContext({ workspaceRoot: `${TEST_DIR}/empty-dir` });
    expect(result.is_git_repo).toBe(false);
  });
});