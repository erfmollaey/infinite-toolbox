import * as path from 'node:path';
import { safeExists, safeScanDir } from './filesystem.js';
import { ProjectType, WorkspaceOptions } from './types.js';

const _MAX_FILE_SIZE_BYTES = 1_048_576; // 1MB

/**
 * Configuration files that indicate specific project types.
 */
const PROJECT_TYPE_FILES: Record<ProjectType, string[]> = {
  node: ['package.json'],
  typescript: ['package.json', 'tsconfig.json', 'tsconfig*.json'],
  python: ['requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile', 'poetry.lock'],
  rust: ['Cargo.toml', 'Cargo.lock'],
  go: ['go.mod', 'go.sum'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'],
  php: ['composer.json', 'composer.lock'],
  ruby: ['Gemfile', 'Gemfile.lock', 'Rakefile'],
  docker: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'Containerfile'],
  unknown: []
};

/**
 * Recommended project files that indicate good project hygiene.
 * Optional files listed without making them mandatory.
 */
const RECOMMENDED_PROJECT_FILES = [
  'README.md',
  '.gitignore',
  'LICENSE',
  '.env.example',
  'package.json'
];

/**
 * Detects the project type(s) present in a workspace based on configuration files.
 */
export async function detectProjectType(options: WorkspaceOptions): Promise<ProjectType[]> {
  const detected: ProjectType[] = [];

  for (const projectType of Object.keys(PROJECT_TYPE_FILES) as ProjectType[]) {
    if (projectType === 'unknown') continue;

    const files = PROJECT_TYPE_FILES[projectType];
    for (const patternOrFile of files) {
      // Support glob-like patterns with wildcard
      if (patternOrFile.includes('*')) {
        const dir = path.dirname(patternOrFile.replace('*', '')) || '.';
        const basename = path.basename(patternOrFile);
        const allFiles = await safeScanDir(options.workspaceRoot, dir, 1, 200);
        const match = basename.includes('*')
          ? allFiles.some((f) => path.basename(f) === path.basename(patternOrFile.replace('*', '')))
          : allFiles.includes(patternOrFile);
        if (match) {
          detected.push(projectType);
          break;
        }
      } else {
        const exists = await safeExists(options.workspaceRoot, patternOrFile);
        if (exists) {
          detected.push(projectType);
          break;
        }
      }
    }
  }

  if (detected.length === 0) {
    detected.push('unknown');
  }

  return detected;
}

/**
 * Lists package/configuration files detected in the workspace root and shallow directories.
 */
export async function detectConfigurationFiles(options: WorkspaceOptions): Promise<string[]> {
  const allFiles = await safeScanDir(options.workspaceRoot, '.', 2, 300);

  const configFilePatterns = [
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'tsconfig.json',
    'jsconfig.json',
    '.eslintrc',
    '.eslintrc.json',
    '.eslintrc.js',
    '.eslintrc.yml',
    '.prettierrc',
    '.prettierrc.json',
    'prettier.config.js',
    '.gitignore',
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    '.env.example',
    '.env.sample',
    '.env',
    'pyproject.toml',
    'requirements.txt',
    'setup.py',
    'Cargo.toml',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'composer.json',
    'Gemfile'
  ];

  return allFiles.filter((f) => {
    const base = path.basename(f).toLowerCase();
    return configFilePatterns.some((p) => base === p.toLowerCase());
  });
}

/**
 * Detects available npm scripts from package.json.
 * Parses package.json to extract scripts without executing anything.
 */
export async function detectAvailableScripts(options: WorkspaceOptions): Promise<Record<string, string>> {
  const scripts: Record<string, string> = {};

  try {
    const content = await readPackageJson(options.workspaceRoot);
    const packageJson = JSON.parse(content);

    if (packageJson.scripts && typeof packageJson.scripts === 'object') {
      for (const [name, command] of Object.entries(packageJson.scripts)) {
        scripts[name] = String(command);
      }
    }
  } catch {
    // No package.json or unreadable - return empty
  }

  return scripts;
}

async function readPackageJson(workspaceRoot: string): Promise<string> {
  const fs = await import('node:fs');
  return fs.promises.readFile(path.resolve(workspaceRoot, 'package.json'), 'utf-8');
}

/**
 * Detects environment template files (.env.example, .env.sample, etc.)
 */
export async function detectEnvTemplateFiles(options: WorkspaceOptions): Promise<string[]> {
  const allFiles = await safeScanDir(options.workspaceRoot, '.', 1, 200);
  const templateNames = ['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.example.local'];

  return allFiles.filter((f) => templateNames.includes(path.basename(f).toLowerCase()));
}

/**
 * Checks for README and documentation files.
 */
export async function detectReadmeAndDocs(options: WorkspaceOptions): Promise<{ readme: string[]; docs: string[] }> {
  const allFiles = await safeScanDir(options.workspaceRoot, '.', 2, 300);

  const readme = allFiles.filter((f) => {
    const base = path.basename(f).toLowerCase();
    return base.startsWith('readme.') || base === 'readme.md' || base === 'readme.rst' || base === 'readme.txt';
  });

  const docs = allFiles.filter((f) => {
    const base = path.basename(f).toLowerCase();
    const dir = path.dirname(f).toLowerCase();
    return dir.includes('docs') || base.endsWith('.md') || base.endsWith('.rst');
  });

  return { readme, docs };
}

/**
 * Detects if a Git repository is present in the workspace.
 */
export async function detectGitPresence(options: WorkspaceOptions): Promise<boolean> {
  return await safeExists(options.workspaceRoot, '.git');
}

/**
 * Identifies missing recommended project files based on project type and context.
 * Files are listed as missing recommendations, not hard requirements.
 */
export async function getMissingRecommendedFiles(options: WorkspaceOptions): Promise<string[]> {
  const allFiles = await safeScanDir(options.workspaceRoot, '.', 2, 300);
  const existingBasenames = new Set(allFiles.map((f) => path.basename(f).toLowerCase()));

  const missing: string[] = [];

  for (const recommended of RECOMMENDED_PROJECT_FILES) {
    const lower = recommended.toLowerCase();
    if (!existingBasenames.has(lower)) {
      missing.push(recommended);
    }
  }

  return missing;
}
