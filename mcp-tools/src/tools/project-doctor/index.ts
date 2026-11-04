import { WorkspaceOptions, ProjectType } from '../../core/types.js';
import { detectProjectType, detectConfigurationFiles, detectAvailableScripts, detectReadmeAndDocs, detectGitPresence, getMissingRecommendedFiles } from '../../core/project-detection.js';

/**
 * Analyzes a local development project to assess its structure and health.
 *
 * @param options Workspace options specifying the root directory to analyze
 * @returns Structured assessment of project type, detected files, available scripts, and recommendations
 */
export async function projectDoctor(options: WorkspaceOptions): Promise<{
  project_type: ProjectType[];
  detected_files: string[];
  available_scripts: Record<string, string>;
  missing_recommended_files: string[];
  warnings: string[];
  summary: string;
}> {
  // Detect project type(s)
  const projectTypes = await detectProjectType(options);

  // Detect configuration files
  const configurationFiles = await detectConfigurationFiles(options);

  // Detect available scripts
  const scripts = await detectAvailableScripts(options);

  // Detect README and documentation
  const { readme, docs } = await detectReadmeAndDocs(options);

  // Detect Git presence
  const hasGit = await detectGitPresence(options);

  // Find missing recommended files
  const missingRecommended = await getMissingRecommendedFiles(options);

  // Identify warnings
  const warnings: string[] = [];

  if (projectTypes.length === 0) {
    warnings.push('No project configuration files detected (package.json, tsconfig.json, etc.)');
  }

  if (hasGit && !scripts) {
    warnings.push('Git repository detected but no npm scripts found in package.json');
  }

  if (readme.length === 0 && docs.length === 0) {
    warnings.push('No README or documentation files detected');
  }

  // Create summary
  const summary = `Project type: ${projectTypes.join(', ')} | ` +
    `Configuration files: ${configurationFiles.length} | ` +
    `Scripts: ${Object.keys(scripts).length} | ` +
    `Missing recommended files: ${missingRecommended.length}`;

  return {
    project_type: projectTypes,
    detected_files: configurationFiles,
    available_scripts: scripts,
    missing_recommended_files: missingRecommended,
    warnings,
    summary
  };
}