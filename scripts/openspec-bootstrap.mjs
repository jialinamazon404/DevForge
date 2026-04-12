#!/usr/bin/env node
/**
 * OpenSpec 形态 B：在项目下初始化（如需）并创建 change。
 * 用法: node scripts/openspec-bootstrap.mjs <projectPath> <changeName> <description>
 * 成功时 stdout 最后一行输出 JSON: { changeName, changeDir, projectPath }
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    shell: false
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} failed (exit ${r.status}): ${r.stderr || r.stdout || ''}`
    );
  }
  return r.stdout;
}

const projectPath = path.resolve(process.argv[2] || '');
const changeName = (process.argv[3] || '').trim();
const description = (process.argv[4] || 'DevForge sprint change').trim();

if (!projectPath || !changeName) {
  console.error(
    'Usage: node scripts/openspec-bootstrap.mjs <projectPath> <changeName> <description>'
  );
  process.exit(1);
}

const specJson = path.join(projectPath, 'openspec', 'spec.json');
if (!fs.existsSync(specJson)) {
  run('openspec', ['init', '--tools', 'opencode', '--no-color'], projectPath);
}

const changeDir = path.join(projectPath, 'openspec', 'changes', changeName);
// 幂等：如果 change 已存在则跳过创建（避免重复执行导致失败）
if (!fs.existsSync(changeDir)) {
  run('openspec', ['new', 'change', changeName, '--description', description], projectPath);
  if (!fs.existsSync(changeDir)) {
    throw new Error(`Change directory was not created: ${changeDir}`);
  }
}

const out = {
  changeName,
  changeDir: path.resolve(changeDir),
  projectPath: path.resolve(projectPath)
};
console.log(JSON.stringify(out));
