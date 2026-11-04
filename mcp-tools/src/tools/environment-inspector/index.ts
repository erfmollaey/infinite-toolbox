import * as path from 'node:path';
import { WorkspaceOptions, EnvironmentInspectorResult } from '../../core/types.js';
import { safeScanDir, safeReadFile } from '../../core/filesystem.js';

const ENV_TEMPLATE_NAMES = ['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.example.local'];
const _MAX_KEY_LENGTH = 128;

/**
 * Inspects environment configuration for a workspace without exposing any values.
 * Only reads explicitly supported template files; never reads actual .env files.
 * Never returns variable values - only names and metadata.
 *
 * @param options Workspace options specifying the root directory
 * @returns Structured environment inspection results
 *
 * @note This tool NEVER returns secret values. It only extracts variable names
 *       from template files and clearly identifies the source of each comparison.
 */
export async function environmentInspector(options: WorkspaceOptions): Promise<EnvironmentInspectorResult> {
  const workspaceRoot = options.workspaceRoot;

  // Scan for env template files ONLY (never actual .env files)
  const allFiles = await safeScanDir(workspaceRoot, '.', 1, 200);
  const detectedTemplateFiles: string[] = [];
  const detectedEnvTemplateFiles: string[] = []; // Only template files
  const detectedActualEnvFiles: string[] = []; // Never included in results

  for (const file of allFiles) {
    const base = file.split('/').pop()?.toLowerCase() || '';
    if (ENV_TEMPLATE_NAMES.includes(base)) {
      detectedTemplateFiles.push(file);
      detectedEnvTemplateFiles.push(file);
    } else if (base === '.env') {
      // Detect actual .env files but never include their contents in results
      detectedActualEnvFiles.push(file);
    }
  }

  // Gather variable names from template files ONLY
  // Do NOT read actual .env files - only .env.example, .env.sample, .env.template
  const templateVariableNames: Set<string> = new Set();

  for (const templateFile of detectedEnvTemplateFiles) {
    try {
      const content = await safeReadFile(workspaceRoot, templateFile, 64 * 1024); // 64KB limit for templates
      if (content) {
        const lines = content.split('\n');
        for (const line of lines) {
          // Extract KEY= patterns from template files only
          const keyMatch = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/i);
          if (keyMatch && keyMatch[1]) {
            templateVariableNames.add(keyMatch[1]);
          }
        }
      }
    } catch {
      // Skip unreadable template files - don't crash
      continue;
    }
  }

  // Configured variables: Only from template files, NOT from process.env
  // Including process.env would leak the MCP server's own environment variables
  // Variable names are compared only against what's declared in templates
  const configuredVariableNames: Set<string> = new Set();

  // Compute missing variables: which template vars are absent from configured
  const missingVariables: string[] = [];
  const warnings: string[] = [];

  for (const templateVar of templateVariableNames) {
    const isConfigured = configuredVariableNames.has(templateVar);
    if (!isConfigured) {
      missingVariables.push(templateVar);
    }
  }

  if (missingVariables.length > 0) {
    warnings.push(`${missingVariables.length} required environment variables appear to be missing from template declaration`);
  }

  // Detect duplicates: same key appearing multiple times in template files
  const duplicateDeclarations: Record<string, number> = {};

  for (const templateFile of detectedEnvTemplateFiles) {
    try {
      const content = await safeReadFile(workspaceRoot, templateFile, 64 * 1024);
      if (content) {
        const keys: string[] = [];
        for (const line of content.split('\n')) {
          const keyMatch = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/i);
          if (keyMatch && keyMatch[1]) {
            keys.push(keyMatch[1]);
          }
        }

        const seen = new Set<string>();
        for (const key of keys) {
          if (seen.has(key)) {
            duplicateDeclarations[key] = (duplicateDeclarations[key] || 0) + 1;
          }
          seen.add(key);
        }
      }
    } catch {
      // Skip unreadable template files
      continue;
    }
  }

  const duplicateNames: string[] = Object.keys(duplicateDeclarations).filter(
    (k) => (duplicateDeclarations[k] ?? 0) > 0
  );

  // Source attribution: clearly state variables came from template files
  const sourceInfo = detectedEnvTemplateFiles.length > 0
    ? ` (sources: ${detectedEnvTemplateFiles.map(f => path.basename(f)).join(', ')})`
    : '(no template files found)';

  const summary = `Env template files: ${detectedTemplateFiles.length} | ` +
    `Template vars: ${templateVariableNames.size} | ` +
    `Missing vars: ${missingVariables.length} | ` +
    `Duplicates: ${duplicateNames.length}` + sourceInfo;

  return {
    detected_template_files: detectedTemplateFiles,
    detected_env_files: detectedEnvTemplateFiles, // Only template files in results
    template_variable_names: Array.from(templateVariableNames).sort(),
    configured_variable_names: Array.from(configuredVariableNames).sort(),
    missing_variables: missingVariables.sort(),
    duplicate_variable_declarations: duplicateDeclarations,
    warnings,
    summary
  };
}