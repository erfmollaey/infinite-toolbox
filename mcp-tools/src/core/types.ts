/**
 * Core type definitions for Infinity MCP Toolbox.
 */

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  summary: string;
}

export interface WorkspaceOptions {
  workspaceRoot: string;
  maxFileSizeBytes?: number;
}

export type ProjectType =
  | 'node'
  | 'typescript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'php'
  | 'ruby'
  | 'docker'
  | 'unknown';

export interface ProjectDoctorResult {
  project_type: ProjectType[];
  detected_files: string[];
  available_scripts: Record<string, string>;
  missing_recommended_files: string[];
  warnings: string[];
  summary: string;
}

export interface GitStatusFile {
  path: string;
  origPath?: string;
  stagedStatus: string;
  unstagedStatus: string;
}

export interface GitContextResult {
  is_git_repo: boolean;
  current_branch: string | null;
  working_tree_clean: boolean;
  modified_files: string[];
  added_files: string[];
  deleted_files: string[];
  untracked_files: string[];
  staged_changes: string[];
  unstaged_changes: string[];
  diff_stats?: {
    files_changed: number;
    insertions: number;
    deletions: number;
  };
  bounded_diff_summary?: string;
  summary: string;
}

export interface EnvVariableInfo {
  name: string;
  required: boolean;
  isSensitiveName: boolean;
  sources: string[]; // e.g. ['.env.example', 'src/config.ts']
}

export interface EnvironmentInspectorResult {
  detected_template_files: string[];
  detected_env_files: string[];
  template_variable_names: string[];
  configured_variable_names: string[];
  missing_variables: string[];
  duplicate_variable_declarations: Record<string, number>;
  warnings: string[];
  summary: string;
}

export interface DependencyManifestInfo {
  manifestPath: string;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'pip' | 'poetry' | 'cargo' | 'go' | 'unknown';
  declaredDependencies: Record<string, string>;
  declaredDevDependencies?: Record<string, string>;
  duplicateDeclarations: string[];
  versionConstraintWarnings: string[];
  potentiallyUnused: string[];
}

export interface DependencyInspectorResult {
  manifests: DependencyManifestInfo[];
  total_declared_dependencies: number;
  duplicate_declarations: string[];
  version_constraint_warnings: string[];
  potentially_unused: string[];
  truncated?: boolean;
  summary: string;
}
