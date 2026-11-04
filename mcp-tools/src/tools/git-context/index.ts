import { WorkspaceOptions } from '../../core/types.js';
import { isGitRepository, getCurrentBranch, getGitStatus, getGitDiffStats, getBoundedDiffSummary } from '../../core/git.js';

/**
 * Provides structured information about the current Git working tree.
 * All operations are read-only.
 *
 * @param options Workspace options specifying the root directory
 * @returns Structured Git context including branch, status, diff stats, and optional diff summary
 */
export async function gitContext(options: WorkspaceOptions): Promise<{
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
}> {
  const workspaceRoot = options.workspaceRoot;
  
  // Check if this is a Git repository
  const isRepo = await isGitRepository(workspaceRoot);
  
  if (!isRepo) {
    return {
      is_git_repo: false,
      current_branch: null,
      working_tree_clean: true,
      modified_files: [],
      added_files: [],
      deleted_files: [],
      untracked_files: [],
      staged_changes: [],
      unstaged_changes: [],
      summary: 'Not a Git repository'
    };
  }
  
  // Get current branch
  const currentBranch = await getCurrentBranch(workspaceRoot);
  
  // Get Git status
  const statusResult = await getGitStatus(workspaceRoot);
  
  // Categorize files by status
  const modifiedFiles: string[] = [];
  const addedFiles: string[] = [];
  const deletedFiles: string[] = [];
  const untrackedFiles: string[] = [];
  const stagedChanges: string[] = [];
  const unstagedChanges: string[] = [];
  
  for (const entry of statusResult.entries) {
    const { staged, unstaged, path: filePath, origPath } = entry;
    
    // Process staged status
    if (staged === 'M') {
      modifiedFiles.push(filePath);
      stagedChanges.push(filePath);
    } else if (staged === 'A') {
      addedFiles.push(filePath);
      stagedChanges.push(filePath);
    } else if (staged === 'D') {
      deletedFiles.push(filePath);
      stagedChanges.push(filePath);
    } else if (staged === 'R' || staged === 'C') {
      modifiedFiles.push(filePath);
      stagedChanges.push(`${origPath || filePath} -> ${filePath}`);
    }
    
    // Process unstaged status
    if (unstaged === 'M') {
      modifiedFiles.push(filePath);
      unstagedChanges.push(filePath);
    } else if (unstaged === 'D') {
      deletedFiles.push(filePath);
      unstagedChanges.push(filePath);
    } else if (unstaged === 'R' || unstaged === 'C') {
      modifiedFiles.push(filePath);
      unstagedChanges.push(`${origPath || filePath} -> ${filePath}`);
    }
    
    // Untracked files
    if (staged === '?' && unstaged === '?') {
      untrackedFiles.push(filePath);
    }
  }
  
  // Get diff statistics
  const diffStats = await getGitDiffStats(workspaceRoot);
  
  // Get bounded diff summary
  const boundedDiffSummary = await getBoundedDiffSummary(workspaceRoot);
  
  // Build summary
  const summary = `Branch: ${currentBranch || 'detached'} | ` +
    `Modified: ${modifiedFiles.length} | ` +
    `Added: ${addedFiles.length} | ` +
    `Deleted: ${deletedFiles.length} | ` +
    `Untracked: ${untrackedFiles.length} | ` +
    `Staged: ${stagedChanges.length} | ` +
    `Unstaged: ${unstagedChanges.length}`;
  
  return {
    is_git_repo: true,
    current_branch: currentBranch,
    working_tree_clean: statusResult.clean,
    modified_files: modifiedFiles,
    added_files: addedFiles,
    deleted_files: deletedFiles,
    untracked_files: untrackedFiles,
    staged_changes: stagedChanges,
    unstaged_changes: unstagedChanges,
    diff_stats: diffStats ? {
      files_changed: diffStats.filesChanged,
      insertions: diffStats.insertions,
      deletions: diffStats.deletions
    } : undefined,
    bounded_diff_summary: boundedDiffSummary || undefined,
    summary
  };
}