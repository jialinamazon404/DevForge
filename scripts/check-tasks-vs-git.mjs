#!/usr/bin/env node
/**
 * 轻量检查：tasks.md 中的任务行（启发式）与 git 工作区变更对比，仅供人工核对。
 *
 * Usage:
 *   node scripts/check-tasks-vs-git.mjs <path-to-tasks.md> [project-root-for-git]
 *
 * project-root 默认为 DevForge 仓库根目录；若代码在 projects/<id>/src，可传 projects/<id>。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const tasksArg = process.argv[2];
const gitRoot = path.resolve(process.argv[3] || REPO_ROOT);

if (!tasksArg) {
  console.error('Usage: node scripts/check-tasks-vs-git.mjs <path-to-tasks.md> [project-root-for-git]');
  process.exit(1);
}

const absTasks = path.resolve(tasksArg);
let text = '';
try {
  text = fs.readFileSync(absTasks, 'utf-8');
} catch (e) {
  console.error('Cannot read tasks file:', e.message);
  process.exit(2);
}

const unchecked = (text.match(/^\s*-\s*\[\s\]/gm) || []).length;
const checked = (text.match(/^\s*-\s*\[[xX]\]/gm) || []).length;
const openCheckboxes = unchecked + checked;

console.log('--- tasks.md (heuristic, not proof of correctness) ---');
console.log('File:', absTasks);
console.log('Checkbox lines - [ ] / - [x]:', { unchecked, checked, total: openCheckboxes });
console.log('');

try {
  const stat = execSync(`git -C "${gitRoot}" diff --stat`, { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 });
  console.log(`--- git diff --stat (${gitRoot}) ---`);
  console.log(stat.trim() || '(no unstaged/uncommitted changes in working tree — try git status)');
} catch (e) {
  console.log('--- git ---');
  console.log('git diff failed (not a repo or no git):', e.message);
}
