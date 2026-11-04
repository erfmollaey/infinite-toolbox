import { WorkspaceOptions, DependencyInspectorResult } from '../../core/types.js';
import { safeScanDir } from '../../core/filesystem.js';
import * as path from 'node:path';

/**
 * Analyzes project dependencies and identifies potential maintenance issues.
 * Read-only: never installs or updates packages.
 */
export async function dependencyInspector(options: WorkspaceOptions): Promise<DependencyInspectorResult> {
  const workspaceRoot = options.workspaceRoot;
  const manifests: DependencyInspectorResult['manifests'] = [];
  const duplicateDeclarations: string[] = [];
  const versionConstraintWarnings: string[] = [];
  const potentiallyUnused: string[] = [];
  const MAX_PROCESSED_DEPS = 10000;
  const MAX_RETURNED_DEPS = 1000;
  let totalProcessed = 0;
  let truncated = false;

  // Scan for package manifests
  const allFiles = await safeScanDir(workspaceRoot, '.', 2, 200);
  const manifestFiles = allFiles.filter((f) => {
    const base = path.basename(f).toLowerCase();
    return (
      base === 'package.json' ||
      base === 'requirements.txt' ||
      base === 'pyproject.toml' ||
      base === 'pom.xml' ||
      base === 'build.gradle' ||
      base === 'build.gradle.kts' ||
      base === 'go.mod' ||
      base === 'cargo.toml' ||
      base === 'composer.json' ||
      base === 'gemfile'
    );
  });

  // Process npm package.json if present
  if (manifestFiles.some((f) => path.basename(f).toLowerCase() === 'package.json')) {
    try {
      const { safeReadFile } = await import('../../core/filesystem.js');
      const content = await safeReadFile(workspaceRoot, 'package.json', 1024 * 1024);
      const pkg = JSON.parse(content);
      if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('invalid manifest');
      const declaredDeps = (pkg.dependencies && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)) ? pkg.dependencies : {};
      const declaredDevDeps = (pkg.devDependencies && typeof pkg.devDependencies === 'object' && !Array.isArray(pkg.devDependencies)) ? pkg.devDependencies : {};


      // Check for duplicate declarations (same package in both deps and devDeps)
      for (const pkgName of Object.keys(declaredDeps)) {
        if (declaredDevDeps[pkgName]) {
          duplicateDeclarations.push(pkgName);
        }
      }

      // Check version constraints
      const depEntries = Object.entries(declaredDeps);
      for (const [pkgName, version] of depEntries) {
        if (totalProcessed >= MAX_PROCESSED_DEPS) { truncated = true; break; }
        totalProcessed++;
        if (typeof version === 'string') {
          if (version === '*') {
            versionConstraintWarnings.push(`Package ${pkgName} uses unconstrained version (*)`);
          } else if (version === '') {
            versionConstraintWarnings.push(`Package ${pkgName} has empty version constraint`);
          }
        }
      }
      // bound returned declaredDeps
      const boundedDeps: Record<string, unknown> = {};
      let count = 0;
      for (const [k, v] of Object.entries(declaredDeps)) {
        if (count >= MAX_RETURNED_DEPS) { truncated = true; break; }
        boundedDeps[k] = v;
        count++;
      }
      const packageManifest: DependencyInspectorResult['manifests'][number] = {
        manifestPath: 'package.json',
        packageManager: 'npm',
        declaredDependencies: boundedDeps as Record<string, string>,
        declaredDevDependencies: declaredDevDeps,
        duplicateDeclarations: duplicateDeclarations,
        versionConstraintWarnings: versionConstraintWarnings,
        potentiallyUnused: [] // Would require source code scanning - out of MVP scope
      };

      manifests.push(packageManifest);
    } catch {
      // Skip if unreadable
    }
  }

  // Process Python requirements.txt
  const reqFile = manifestFiles.find((f) => path.basename(f).toLowerCase() === 'requirements.txt');
  if (reqFile) {
    try {
      const { safeReadFile } = await import('../../core/filesystem.js');
      const content = await safeReadFile(workspaceRoot, reqFile, 1024 * 1024);
      const lines = content.split('\n');
      const declaredDeps: Record<string, string> = {};

      for (const line of lines) {
        if (totalProcessed >= MAX_PROCESSED_DEPS) { truncated = true; break; }
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        // Basic parsing: package==version
        const match = trimmed.match(/^([a-zA-Z0-9_.-]+)([=<>!~]+.+)?$/);
        if (match && match[1]) {
          if (totalProcessed >= MAX_PROCESSED_DEPS) { truncated = true; break; }
          totalProcessed++;
          declaredDeps[match[1]] = match[2] || '*';
        }
      }

      const boundedDeps: Record<string, string> = {};
      let count = 0;
      for (const [k, v] of Object.entries(declaredDeps)) {
        if (count >= MAX_RETURNED_DEPS) { truncated = true; break; }
        boundedDeps[k] = v;
        count++;
      }

      manifests.push({
        manifestPath: reqFile,
        packageManager: 'pip',
        declaredDependencies: boundedDeps,
        duplicateDeclarations: [],
        versionConstraintWarnings: [],
        potentiallyUnused: []
      });
    } catch {
      // Skip
    }
  }

  // Build summary
  const totalDeclared = manifests.reduce((sum, m) => sum + Object.keys(m.declaredDependencies).length, 0);
  const summary = `Manifests found: ${manifests.length} | ` +
    `Total declared dependencies: ${totalDeclared} | ` +
    `Duplicates: ${duplicateDeclarations.length} | ` +
    `Version warnings: ${versionConstraintWarnings.length}`;

  const truncationNote = truncated ? ' (results truncated due to configured limits)' : '';
  return {
    manifests,
    total_declared_dependencies: totalDeclared,
    duplicate_declarations: duplicateDeclarations,
    version_constraint_warnings: versionConstraintWarnings,
    potentially_unused: potentiallyUnused,
    truncated,
    summary: summary + truncationNote
  };
}