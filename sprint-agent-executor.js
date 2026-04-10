#!/usr/bin/env node
/**
 * AI Agent Executor - 基于 OpenCode Task + Superpowers Skills
 * 
 * 使用 OpenCode Task 工具派发 AI Agent，集成 Superpowers Skills：
 * - product: brainstorming (需求分析)
 * - architect: plan-eng-review (架构评审)
 * - developer: test-driven-development (TDD)
 * - tester: qa (QA测试)
 * - ops: ship (部署)
 * - ghost: cso (安全审计)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import axios from 'axios';
import { io } from 'socket.io-client';
import { readSkillWithFallback } from './config/skillPaths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const WORKSPACE = path.join(ROOT, 'workspace');
const PROJECTS = path.join(ROOT, 'projects');

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

/** 多步骤角色输出分节分隔符（显式 stepIndex 重跑时按节覆盖） */
const STEP_OUTPUT_SEPARATOR = '\n\n---\n\n';

/**
 * 合并多步输出：链式执行追加；显式单步重跑时仅覆盖对应节（0-based）。
 */
function mergeMultiStepOutput(existingOutput, newOutput, stepIndex, totalSteps, replaceMode) {
  const ex = (existingOutput || '').trim();
  if (!ex || ex === '正在执行...') {
    return newOutput;
  }
  if (!replaceMode) {
    return existingOutput + STEP_OUTPUT_SEPARATOR + newOutput;
  }
  const parts = existingOutput.split(STEP_OUTPUT_SEPARATOR);
  while (parts.length < totalSteps) {
    parts.push('');
  }
  if (parts.length > totalSteps) {
    parts.length = totalSteps;
  }
  if (stepIndex >= 0 && stepIndex < totalSteps) {
    parts[stepIndex] = newOutput;
  }
  return parts.join(STEP_OUTPUT_SEPARATOR);
}

/**
 * 从模型输出中提取文件写入块（opencode 后端无法直接写文件时使用）。
 *
 * 格式约定（必须严格匹配）：
 * ```file:relative/path/from/projectDir
 * <file content...>
 * ```
 */
function extractFileBlocks(text) {
  const s = String(text || '');
  const blocks = [];
  const re = /```file:([^\n\r]+)[\r\n]+([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(s))) {
    const relPath = (m[1] || '').trim();
    const content = m[2] ?? '';
    if (!relPath) continue;
    blocks.push({ relPath, content });
  }
  return blocks;
}

function parseBoolEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultValue;
}

function parseIntEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const parsed = parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const STRICT_FILE_BLOCK_GATE = parseBoolEnv('STRICT_FILE_BLOCK_GATE', true);
const HIGH_RISK_TEST_BLOCK_REQUIRED = parseBoolEnv('HIGH_RISK_TEST_BLOCK_REQUIRED', true);
const DEVELOPER_TASK_TIMEOUT_MS = parseIntEnv('DEVFORGE_DEVELOPER_TASK_TIMEOUT_MS', 600000);
const DEVELOPER_TASK_MAX_RETRIES = Math.max(0, parseIntEnv('DEVFORGE_DEVELOPER_TASK_MAX_RETRIES', 2));
const NO_FILE_BLOCKS_FAIL_HIGH_RISK = parseBoolEnv('DEVFORGE_NO_FILE_BLOCKS_FAIL_HIGH_RISK', true);
const DEVELOPER_MAX_CONSECUTIVE_NO_BLOCKS = Math.max(1, parseIntEnv('DEVFORGE_DEVELOPER_MAX_CONSECUTIVE_NO_BLOCKS', 3));
const DEVELOPER_DUMP_NO_BLOCKS_RAW = parseBoolEnv('DEVFORGE_DEVELOPER_DUMP_NO_BLOCKS_RAW', true);
// 默认跑“批处理”（严格按 tasks.md 推进）。如需单任务调试，可显式设置 DEVFORGE_DEVELOPER_SINGLE_TASK=1
const DEVELOPER_SINGLE_TASK = parseBoolEnv('DEVFORGE_DEVELOPER_SINGLE_TASK', false);
const DEVELOPER_SINGLE_TASK_INDEX = parseIntEnv('DEVFORGE_DEVELOPER_SINGLE_TASK_INDEX', 0);
/** 单 task 模式下是否仍链式跑完 developer 全部步骤（默认 false，与 Dashboard 单 task 预期一致） */
const DEVELOPER_SINGLE_TASK_CHAIN = parseBoolEnv('DEVFORGE_DEVELOPER_SINGLE_TASK_CHAIN', false);

function parseDeveloperTaskSkillEnv() {
  const raw = process.env.DEVFORGE_DEVELOPER_TASK_SKILL;
  if (raw === undefined || raw === null || raw === '') return 'test-driven-development';
  const v = String(raw).trim().toLowerCase();
  if (['none', '0', 'false', 'off', ''].includes(v)) return null;
  return String(raw).trim();
}
const DEVELOPER_TASK_SKILL = parseDeveloperTaskSkillEnv();

const VERIFY_ENABLED = parseBoolEnv('DEVFORGE_VERIFY_ENABLED', true);
const VERIFY_HEURISTICS = parseBoolEnv('DEVFORGE_VERIFY_HEURISTICS', false);
const VERIFY_STRICT = parseBoolEnv('DEVFORGE_VERIFY_STRICT', true);
const VERIFY_TIMEOUT_MS = parseIntEnv('DEVFORGE_VERIFY_TIMEOUT_MS', 300000);
const VERIFY_SKIP_NO_NODE_MODULES = parseBoolEnv('DEVFORGE_VERIFY_SKIP_NO_NODE_MODULES', true);

const TASK_ALIGN_OPENCODE = parseBoolEnv('DEVFORGE_TASK_ALIGN_OPENCODE', false);
const ALIGN_STRICT = parseBoolEnv('DEVFORGE_ALIGN_STRICT', false);

let _projectCodegenCache = null;
let _projectCodegenCacheRoot = null;

async function loadProjectCodegen(projectRoot) {
  if (_projectCodegenCache && _projectCodegenCacheRoot === projectRoot) {
    return _projectCodegenCache;
  }
  try {
    const raw = await fs.readFile(path.join(projectRoot, 'project.json'), 'utf-8');
    const j = JSON.parse(raw);
    const cg = j?.codegen && typeof j.codegen === 'object' ? j.codegen : {};
    _projectCodegenCache = cg;
    _projectCodegenCacheRoot = projectRoot;
    return cg;
  } catch {
    _projectCodegenCache = {};
    _projectCodegenCacheRoot = projectRoot;
    return {};
  }
}

function checkCodegenPathAllowed(relNorm, codegen) {
  const roots = codegen?.allowedRoots;
  if (Array.isArray(roots) && roots.length > 0) {
    const first = relNorm.split('/')[0];
    if (!roots.includes(first)) {
      throw new Error(`拒绝写入：路径不在 codegen.allowedRoots 内: ${relNorm}`);
    }
  }
  if (codegen?.allowBackend === false && /^backend\//.test(relNorm)) {
    throw new Error(`codegen.allowBackend=false，拒绝: ${relNorm}`);
  }
  if (codegen?.allowFrontend === false && /^frontend\//.test(relNorm)) {
    throw new Error(`codegen.allowFrontend=false，拒绝: ${relNorm}`);
  }
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function collectTouchedRootsFromBlocks(blocks) {
  const s = new Set();
  for (const b of blocks || []) {
    const rel = String(b?.relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (/^frontend\//.test(rel)) s.add('frontend');
    if (/^backend\//.test(rel)) s.add('backend');
  }
  return s;
}

async function runShellCommand(cwd, cmd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGTERM');
      } catch (_e) {}
      reject(new Error(`VERIFY_TIMEOUT: ${timeoutMs}ms cwd=${cwd} cmd=${cmd.slice(0, 80)}`));
    }, timeoutMs);
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * tasks.md 单条跑完后：按 project.json codegen.verify 或可选启发式执行 shell 验证。
 */
async function runPostTaskShellVerify({ projectDir, blocks }) {
  if (!VERIFY_ENABLED) {
    console.log('   ⏭️ DEVFORGE_VERIFY_ENABLED=false，跳过 shell 验证');
    return { ok: true, skipped: true };
  }
  const projectRoot = path.resolve(projectDir, '..');
  const codegen = await loadProjectCodegen(projectRoot);
  const touched = collectTouchedRootsFromBlocks(blocks);
  const commands = [];

  if (Array.isArray(codegen.verify) && codegen.verify.length > 0) {
    for (const entry of codegen.verify) {
      const cwdRel = String(entry.cwd || '.').replace(/\\/g, '/');
      const cmd = String(entry.cmd || '').trim();
      if (!cmd) continue;
      const cwd = path.resolve(projectDir, cwdRel);
      if (!isPathInside(projectDir, cwd)) {
        throw new Error(`codegen.verify cwd 越界: ${entry.cwd}`);
      }
      commands.push({ label: `verify:${cwdRel}`, cwd, cmd });
    }
  } else if (VERIFY_HEURISTICS) {
    if (touched.has('frontend')) {
      const fd = path.join(projectDir, 'frontend');
      const pkg = path.join(fd, 'package.json');
      if (await pathExists(pkg)) {
        const nm = path.join(fd, 'node_modules');
        if (!(await pathExists(nm)) && VERIFY_SKIP_NO_NODE_MODULES) {
          console.warn('   ⚠️ 启发式验证跳过 frontend：无 node_modules（DEVFORGE_VERIFY_SKIP_NO_NODE_MODULES）');
        } else if (await pathExists(nm)) {
          let testScript = false;
          try {
            const pj = JSON.parse(await fs.readFile(pkg, 'utf-8'));
            testScript = !!(pj.scripts && pj.scripts.test);
          } catch (_e) {}
          commands.push({
            label: 'heuristic:frontend npm test|build',
            cwd: fd,
            cmd: testScript ? 'npm test' : 'npm run build'
          });
        }
      }
    }
    if (touched.has('backend')) {
      const bd = path.join(projectDir, 'backend');
      if (await pathExists(path.join(bd, 'pom.xml'))) {
        commands.push({ label: 'heuristic:backend mvn test', cwd: bd, cmd: 'mvn -q test' });
      } else if (await pathExists(path.join(bd, 'package.json'))) {
        const nm = path.join(bd, 'node_modules');
        if (!(await pathExists(nm)) && VERIFY_SKIP_NO_NODE_MODULES) {
          console.warn('   ⚠️ 启发式验证跳过 backend/npm：无 node_modules');
        } else if (await pathExists(nm)) {
          let testScript = false;
          try {
            const pj = JSON.parse(await fs.readFile(path.join(bd, 'package.json'), 'utf-8'));
            testScript = !!(pj.scripts && pj.scripts.test);
          } catch (_e) {}
          commands.push({
            label: 'heuristic:backend npm',
            cwd: bd,
            cmd: testScript ? 'npm test' : 'npm run build'
          });
        }
      }
    }
  } else {
    console.log('   ⏭️ 无 codegen.verify 且 DEVFORGE_VERIFY_HEURISTICS=false，跳过 shell 验证');
    return { ok: true, skipped: true };
  }

  if (commands.length === 0) {
    return { ok: true, skipped: true, reason: 'NO_COMMANDS' };
  }

  for (const { label, cwd, cmd } of commands) {
    console.log(`   🔍 Shell 验证: ${label}\n      cwd=${cwd}`);
    try {
      const { code, stdout, stderr } = await runShellCommand(cwd, cmd, VERIFY_TIMEOUT_MS);
      if (code !== 0) {
        const msg = `Shell 验证失败 exit=${code} label=${label}\n--- stderr ---\n${stderr.slice(0, 4000)}\n--- stdout ---\n${stdout.slice(0, 2000)}`;
        if (VERIFY_STRICT) {
          throw new Error(msg);
        }
        console.warn(`   ⚠️ ${msg}`);
      } else {
        console.log(`   ✅ Shell 验证通过: ${label}`);
      }
    } catch (e) {
      if (VERIFY_STRICT) throw e;
      console.warn(`   ⚠️ Shell 验证异常（非 strict）: ${e?.message || e}`);
    }
  }
  return { ok: true };
}

async function runTaskAlignmentOpenCode({
  model,
  sprintId,
  workspacePath,
  taskText,
  title,
  written,
  blocks
}) {
  const paths = (written || []).map((w) => w.relPath).filter(Boolean);
  let snippet = '';
  try {
    for (const w of (written || []).slice(0, 5)) {
      const c = w.afterContent || '';
      snippet += `\n### ${w.relPath}\n${String(c).slice(0, 2500)}${c.length > 2500 ? '\n...' : ''}\n`;
    }
  } catch (_e) {}
  let prdHint = '';
  try {
    const prdPath = path.join(workspacePath, 'output', 'prd.md');
    if (await pathExists(prdPath)) {
      prdHint = (await fs.readFile(prdPath, 'utf-8')).slice(0, 1500);
    }
  } catch (_e) {}
  const alignPrompt = `You are a strict reviewer. Compare ONE development task against the files written.

## Task
${taskText}

## Written paths
${paths.join(', ') || '(none)'}

## File snippets
${snippet || '(empty)'}

## PRD excerpt (if any)
${prdHint || '(none)'}

Output exactly two lines:
TASK_ALIGNMENT: pass OR fail
GAPS: <short reason if fail, else none>
`;
  const raw = await runOpenCode(alignPrompt, {
    model,
    agentName: 'developer',
    skillName: null,
    usePure: true,
    timeoutMs: Math.min(DEVELOPER_TASK_TIMEOUT_MS, 120000)
  });
  const parsed = parseOpenCodeOutput(raw);
  const text = parsed.text || raw;
  const fail = /TASK_ALIGNMENT:\s*fail/i.test(text);
  if (fail && ALIGN_STRICT) {
    throw new Error(`TASK_ALIGNMENT_FAIL: ${title}\n${text.slice(0, 2000)}`);
  }
  if (fail) {
    console.warn(`   ⚠️ TASK_ALIGNMENT warn: ${title}`);
  } else {
    console.log(`   ✅ TASK_ALIGNMENT: ${title}`);
  }
}

function isPathInside(parentDir, candidatePath) {
  const parent = path.resolve(parentDir);
  const cand = path.resolve(candidatePath);
  return cand === parent || cand.startsWith(parent + path.sep);
}

async function writeFileBlocks({ projectDir, blocks }) {
  const written = [];
  const projectRoot = path.resolve(projectDir, '..');
  const codegen = await loadProjectCodegen(projectRoot);
  console.log(`   📝 准备落盘 file blocks: count=${blocks.length}, projectDir=${projectDir}`);
  let backendDirExists = false;
  try {
    const st = await fs.stat(path.join(projectDir, 'backend'));
    backendDirExists = st.isDirectory();
  } catch (_e) {
    backendDirExists = false;
  }
  for (const b of blocks) {
    const rel = b.relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const abs = path.resolve(projectDir, rel);
    if (!isPathInside(projectDir, abs)) {
      throw new Error(`拒绝写入越界路径: ${b.relPath}`);
    }
    const relNorm = rel.replace(/\\/g, '/');
    if (!/^backend\//.test(relNorm) && !/^frontend\//.test(relNorm)) {
      throw new Error(`拒绝写入非 backend/frontend 路径: ${b.relPath}`);
    }
    checkCodegenPathAllowed(relNorm, codegen);
    if (/^backend\//.test(relNorm) && !backendDirExists) {
      const allowFirstBackendWrite =
        codegen.allowBackend === true ||
        (Array.isArray(codegen.allowedRoots) && codegen.allowedRoots.includes('backend'));
      if (!allowFirstBackendWrite) {
        throw new Error(`拒绝创建 backend/：当前项目未检测到 backend 目录: ${b.relPath}`);
      }
    }
    let beforeContent = null;
    let existedBefore = false;
    try {
      beforeContent = await fs.readFile(abs, 'utf-8');
      existedBefore = true;
    } catch (_e) {
      beforeContent = null;
      existedBefore = false;
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, b.content, 'utf-8');
    written.push({
      path: abs,
      relPath: relNorm,
      bytes: Buffer.byteLength(b.content || '', 'utf-8'),
      existedBefore,
      beforeContent,
      afterContent: b.content || ''
    });
    console.log(`   ✅ 已写入: ${relNorm} (${written[written.length - 1].bytes} bytes)`);
  }
  console.log(`   ✅ 落盘完成: written=${written.length}, projectDir=${projectDir}`);
  return written;
}

async function writeDeveloperDocsFromBlocks({ sprintId, workspacePath, outputText }) {
  const blocks = extractFileBlocks(outputText);
  if (blocks.length === 0) return { written: [], reason: 'NO_FILE_BLOCKS' };

  const allowed = new Set(['developer/README.md', 'developer/API.md', 'developer/dev-summary.md']);
  const docDir = path.join(workspacePath, 'developer');
  await fs.mkdir(docDir, { recursive: true });

  const written = [];
  for (const b of blocks) {
    const rel = String(b.relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!allowed.has(rel)) continue;
    const abs = path.resolve(workspacePath, rel);
    if (!isPathInside(workspacePath, abs)) {
      throw new Error(`拒绝写入越界路径: ${b.relPath}`);
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, b.content ?? '', 'utf-8');
    written.push({ relPath: rel, bytes: Buffer.byteLength(b.content ?? '', 'utf-8') });
    console.log(`   ✅ 已写入开发文档: workspace/${sprintId}/${rel} (${written[written.length - 1].bytes} bytes)`);
  }

  if (written.length === 0) return { written: [], reason: 'NO_ALLOWED_DOC_BLOCKS' };
  return { written, reason: 'OK' };
}

async function appendDeveloperTaskRun({
  sprintId,
  roleIndex,
  globalIdx,
  totalTasks,
  title,
  task,
  status,
  riskLevel,
  codeTask,
  gateCode,
  gateMessage,
  noChangeReason,
  fileBlocks,
  written,
  rawText
}) {
  try {
    const dir = path.join(WORKSPACE, sprintId, 'developer-task-runs');
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${String(globalIdx).padStart(3, '0')}.json`);
    const payload = {
      sprintId,
      roleIndex,
      taskIndex: globalIdx,
      totalTasks,
      title,
      taskText: task?.text || '',
      h2: task?.h2 || '',
      h3: task?.h3 || '',
      status,
      riskLevel,
      codeTask: !!codeTask,
      errorCode: gateCode || '',
      message: gateMessage || '',
      noChangeReason: noChangeReason || '',
      fileBlocks,
      writtenCount: written.length,
      files: (written || []).map((w) => ({
        relPath: w.relPath,
        absPath: w.path,
        existedBefore: !!w.existedBefore,
        beforeContent: w.beforeContent ?? '',
        afterContent: w.afterContent ?? '',
        bytes: w.bytes
      })),
      rawPreview: String(rawText || '').slice(0, 2000),
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (e) {
    console.warn(`   ⚠️ 记录 developer task run 失败: ${e?.message || e}`);
  }
}

function parseTasksFromMarkdown(md) {
  const lines = String(md || '').split(/\r?\n/);
  const tasks = [];
  let h2 = '';
  let h3 = '';
  for (const raw of lines) {
    const line = raw.trim();
    const m2 = line.match(/^##\s+(.*)$/);
    if (m2) {
      h2 = m2[1].trim();
      h3 = '';
      continue;
    }
    const m3 = line.match(/^###\s+(.*)$/);
    if (m3) {
      h3 = m3[1].trim();
      continue;
    }
    const mt = line.match(/^- \[\s*\]\s+(.*)$/);
    if (mt) {
      const text = mt[1].trim();
      if (!text) continue;
      tasks.push({
        text,
        h2,
        h3
      });
    }
  }
  return tasks;
}

function inferTaskRiskLevel(task) {
  const text = `${task?.h2 || ''} ${task?.h3 || ''} ${task?.text || ''}`.toLowerCase();
  if (/\bcore\b|核心|关键路径|关键功能|p0|critical|高风险|high[-\s]?risk/.test(text)) return 'core';
  if (/\bhigh\b|p1/.test(text)) return 'high';
  if (/\blow\b|p2/.test(text)) return 'low';
  return 'medium';
}

function isLikelyDocumentationTask(task) {
  const text = `${task?.h2 || ''} ${task?.h3 || ''} ${task?.text || ''}`.toLowerCase();
  const docHint = /\b(readme|api\.md|changelog|docs?)\b|文档|说明|总结|汇总|注释|注解|手册|指南/.test(text);
  const codeHint = /\b(implement|feature|service|endpoint|controller|schema|db|database|ui|component|test|fix|refactor|bug)\b|实现|接口|数据库|前端|后端|代码|测试|修复|重构/.test(text);
  return docHint && !codeHint;
}

function hasTestFileBlocks(blocks) {
  return (blocks || []).some((b) => {
    const rel = String(b?.relPath || '').replace(/\\/g, '/').toLowerCase();
    return (
      rel.includes('/test/') ||
      rel.includes('/tests/') ||
      rel.includes('__tests__/') ||
      rel.endsWith('.test.js') ||
      rel.endsWith('.test.ts') ||
      rel.endsWith('.test.tsx') ||
      rel.endsWith('.spec.js') ||
      rel.endsWith('.spec.ts') ||
      rel.endsWith('.spec.tsx')
    );
  });
}

function getDeveloperBatchRange(stepIdx) {
  // developer tasks steps: 1..5
  // 1 -> 1-10, 2 -> 11-20, 3 -> 21-30, 4 -> 31-40, 5 -> 41-末尾
  if (stepIdx >= 1 && stepIdx <= 4) {
    const start = (stepIdx - 1) * 10;
    return { start, endExclusive: stepIdx * 10 };
  }
  if (stepIdx === 5) {
    return { start: 40, endExclusive: Infinity };
  }
  return { start: 0, endExclusive: Infinity };
}

async function runDeveloperPerTaskBatch({
  sprintId,
  roleIndex,
  model,
  promptBase,
  projectDir,
  tasksPath,
  workspacePath
}) {
  const tasksMd = await fs.readFile(tasksPath, 'utf-8');
  const all = parseTasksFromMarkdown(tasksMd);
  let start = 0;
  let safeEnd = all.length;
  let slice = all;
  if (DEVELOPER_SINGLE_TASK) {
    const idx1 = DEVELOPER_SINGLE_TASK_INDEX;
    if (idx1 < 1 || idx1 > all.length) {
      return `单任务执行索引无效：index=${idx1}, total=${all.length}`;
    }
    start = idx1 - 1;
    safeEnd = idx1;
    slice = all.slice(start, safeEnd);
  } else {
    const range = getDeveloperBatchRange(promptBase.stepIdx);
    start = range.start;
    safeEnd = Number.isFinite(range.endExclusive) ? range.endExclusive : all.length;
    slice = all.slice(start, safeEnd);
  }
  if (slice.length === 0) {
    const rangeLabel = DEVELOPER_SINGLE_TASK
      ? `${DEVELOPER_SINGLE_TASK_INDEX}`
      : Number.isFinite(safeEnd)
        ? `${start + 1}-${safeEnd}`
        : `${start + 1}-末尾`;
    return `未找到可执行任务：tasks.md 解析为 ${all.length} 条 checkbox；本批次范围 ${rangeLabel}。`;
  }

  const outputs = [];
  let consecutiveNoBlocks = 0;
  for (let i = 0; i < slice.length; i++) {
    const globalIdx = start + i + 1;
    const t = slice[i];
    const title = `[${globalIdx}/${all.length}] ${t.h2}${t.h3 ? ' > ' + t.h3 : ''} :: ${t.text}`;
    console.log(`[TASK_START] ${title}`);
    sendProgress(`TASK_START ${globalIdx}: ${t.text}`);

    const riskLevel = inferTaskRiskLevel(t);

    const testBlockRule =
      riskLevel === 'core' || riskLevel === 'high'
        ? `- 本任务为高风险：**必须**同时输出至少 1 个测试文件块（frontend/ 下，路径需满足 __tests__/ 或 /tests/ 或 *.spec.*/*.test.*）\n` +
          `- 不得只写 README/文档来“交差”，必须包含实现代码 + 测试代码\n`
        : '';

    const integrationHint = `## Integration checklist (brief)\n- 只完成本条 task；\`file:frontend/...\` 或 \`file:backend/...\` 须为完整文件内容。\n- 若改 frontend：父/子组件事件（如 emit）与 store 状态需接好。\n- 若改 backend：路由、服务、测试目录与现有工程一致。\n\n`;

    const onePrompt = `${promptBase.fileWriteProtocol}\n\n` +
      `${integrationHint}` +
      `# Developer single task execution\n` +
      `- Sprint: ${sprintId}\n` +
      `- TaskIndex: ${globalIdx}\n` +
      `- Task: ${t.text}\n` +
      `- Section: ${t.h2}${t.h3 ? ' / ' + t.h3 : ''}\n\n` +
      `## Constraints\n` +
      `- 只实现这一条 task，不要顺带实现其它任务\n` +
      `- 仅输出需要新增/更新的文件块（\`\`\`file:...\`\`\`），不要输出大段解释\n` +
      `- 若该任务确认无需改动任何文件，输出单行: NO_CHANGE: <reason>\n` +
      `- 确保文件路径都在 backend/ 或 frontend/ 下（若 project.json 中 codegen 限制栈，须遵守）\n` +
      `- 若项目当前不存在 backend/ 目录，则**禁止**创建/写入 backend/，除非项目配置允许（见 codegen.allowedRoots / allowBackend）\n\n` +
      `${testBlockRule}` +
      `## Task\n${t.text}\n`;

    console.log(
      `[TASK_META] idx=${globalIdx}, model=${model}, timeoutMs=${DEVELOPER_TASK_TIMEOUT_MS}, retries=${DEVELOPER_TASK_MAX_RETRIES}, promptChars=${onePrompt.length}`
    );

    let raw = null;
    let attempt = 0;
    while (attempt <= DEVELOPER_TASK_MAX_RETRIES) {
      const attemptStart = Date.now();
      try {
        raw = await runOpenCode(onePrompt, {
          model,
          agentName: 'developer',
          skillName: DEVELOPER_TASK_SKILL,
          usePure: true,
          timeoutMs: DEVELOPER_TASK_TIMEOUT_MS
        });
        const elapsed = Date.now() - attemptStart;
        console.log(
          `[TASK_TRY_OK] idx=${globalIdx}, attempt=${attempt + 1}/${DEVELOPER_TASK_MAX_RETRIES + 1}, elapsedMs=${elapsed}`
        );
        break;
      } catch (error) {
        const elapsed = Date.now() - attemptStart;
        const isRetryableTimeout = error?.message === 'TIMEOUT_RETRY';
        const hasNextAttempt = attempt < DEVELOPER_TASK_MAX_RETRIES;
        console.warn(
          `[TASK_TRY_FAIL] idx=${globalIdx}, attempt=${attempt + 1}/${DEVELOPER_TASK_MAX_RETRIES + 1}, elapsedMs=${elapsed}, retryable=${isRetryableTimeout ? 1 : 0}, message=${error?.message || 'unknown'}`
        );
        if (!isRetryableTimeout || !hasNextAttempt) {
          throw error;
        }
        attempt++;
        const backoffMs = Math.min(4000, 1000 * Math.pow(2, attempt - 1));
        console.log(`[TASK_TRY_RETRY] idx=${globalIdx}, nextAttempt=${attempt + 1}, backoffMs=${backoffMs}`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    const parsed = parseOpenCodeOutput(raw);
    const text = parsed.text || raw;
    const blocks = extractFileBlocks(text);
    const noChangeReasonMatch = text.match(/(^|\n)\s*NO_CHANGE\s*:\s*([^\n]+)/i);
    const noChangeReason = noChangeReasonMatch ? noChangeReasonMatch[2].trim() : '';
    const isCodeTask = !isLikelyDocumentationTask(t);
    let written = [];
    if (blocks.length > 0) {
      written = await writeFileBlocks({ projectDir, blocks });
    }

    let gateErrorCode = null;
    let gateErrorMessage = null;
    let gateWarnCode = null;
    let gateWarnMessage = null;
    if (STRICT_FILE_BLOCK_GATE && isCodeTask && blocks.length === 0) {
      const highRisk = riskLevel === 'core' || riskLevel === 'high';
      if (highRisk && NO_FILE_BLOCKS_FAIL_HIGH_RISK) {
        gateErrorCode = 'NO_FILE_BLOCKS';
        gateErrorMessage = '高风险代码任务未输出任何 file blocks';
      } else if (noChangeReason) {
        gateWarnCode = 'NO_FILE_BLOCKS_NO_CHANGE';
        gateWarnMessage = `无代码变更: ${noChangeReason}`;
      } else {
        gateWarnCode = 'NO_FILE_BLOCKS';
        gateWarnMessage = '代码任务未输出任何 file blocks（按 warning 继续）';
      }
    } else if (STRICT_FILE_BLOCK_GATE && isCodeTask && blocks.length > 0 && written.length === 0) {
      gateErrorCode = 'WRITE_ZERO';
      gateErrorMessage = '解析到 file blocks 但未写入任何文件';
    } else if (
      HIGH_RISK_TEST_BLOCK_REQUIRED &&
      isCodeTask &&
      (riskLevel === 'core' || riskLevel === 'high') &&
      !hasTestFileBlocks(blocks)
    ) {
      gateErrorCode = 'MISSING_TEST_FILE_BLOCKS';
      gateErrorMessage = '高风险任务缺少测试文件块';
    }

    const wsAlign = workspacePath || path.join(WORKSPACE, sprintId);
    if (!gateErrorCode && written.length > 0) {
      try {
        await runPostTaskShellVerify({ projectDir, blocks });
      } catch (ve) {
        gateErrorCode = 'VERIFY_FAILED';
        gateErrorMessage = ve?.message || String(ve);
      }
      if (!gateErrorCode && TASK_ALIGN_OPENCODE) {
        try {
          await runTaskAlignmentOpenCode({
            model,
            sprintId,
            workspacePath: wsAlign,
            taskText: t.text,
            title,
            written,
            blocks
          });
        } catch (ae) {
          gateErrorCode = 'TASK_ALIGNMENT_FAIL';
          gateErrorMessage = ae?.message || String(ae);
        }
      }
    }

    if (isCodeTask && blocks.length === 0 && !noChangeReason) {
      consecutiveNoBlocks += 1;
    } else {
      consecutiveNoBlocks = 0;
    }

    if (
      isCodeTask &&
      blocks.length === 0 &&
      DEVELOPER_DUMP_NO_BLOCKS_RAW
    ) {
      try {
        const debugDir = path.join(WORKSPACE, sprintId, 'debug', 'developer-no-blocks');
        await fs.mkdir(debugDir, { recursive: true });
        const safeTitle = title
          .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120);
        const dumpPath = path.join(debugDir, `${String(globalIdx).padStart(3, '0')}-${Date.now()}-${safeTitle || 'task'}.log`);
        await fs.writeFile(
          dumpPath,
          [
            `task=${globalIdx}`,
            `title=${title}`,
            `risk=${riskLevel}`,
            `noChangeReason=${noChangeReason || ''}`,
            '--- RAW ---',
            String(raw || ''),
            '--- PARSED_TEXT ---',
            String(text || '')
          ].join('\n'),
          'utf-8'
        );
        console.log(`   🪵 已写入 NO_FILE_BLOCKS 调试日志: ${dumpPath}`);
      } catch (dumpErr) {
        console.warn(`   ⚠️ 写入 NO_FILE_BLOCKS 调试日志失败: ${dumpErr?.message || dumpErr}`);
      }
    }

    if (
      !gateErrorCode &&
      isCodeTask &&
      consecutiveNoBlocks >= DEVELOPER_MAX_CONSECUTIVE_NO_BLOCKS
    ) {
      gateErrorCode = 'CONSECUTIVE_NO_FILE_BLOCKS';
      gateErrorMessage = `连续 ${consecutiveNoBlocks} 个代码任务未输出 file blocks，已触发保护性中断`;
    }

    const metrics = `risk=${riskLevel}, codeTask=${isCodeTask ? 1 : 0}, fileBlocks=${blocks.length}, written=${written.length}`;
    const endTag = gateErrorCode ? 'TASK_FAIL' : gateWarnCode ? 'TASK_WARN' : 'TASK_END';
    const endLine = gateErrorCode
      ? `[TASK_FAIL] ${title} (${metrics}, errorCode=${gateErrorCode}, message=${gateErrorMessage})`
      : gateWarnCode
        ? `[TASK_WARN] ${title} (${metrics}, errorCode=${gateWarnCode}, message=${gateWarnMessage})`
      : `[TASK_END] ${title} (${metrics})`;
    await appendDeveloperTaskRun({
      sprintId,
      roleIndex,
      globalIdx,
      totalTasks: all.length,
      title,
      task: t,
      status: endTag,
      riskLevel,
      codeTask: isCodeTask,
      gateCode: gateErrorCode || gateWarnCode,
      gateMessage: gateErrorMessage || gateWarnMessage,
      noChangeReason,
      fileBlocks: blocks.length,
      written,
      rawText: text
    });
    console.log(endLine);
    sendProgress(`${endTag} ${globalIdx}: ${metrics}${gateErrorCode || gateWarnCode ? `, errorCode=${gateErrorCode || gateWarnCode}` : ''}`);
    outputs.push(endLine);

    // 每条 task 执行后，把 endLine 追加到 iteration output（便于 Dashboard 实时看到）
    try {
      const { data: sprintData } = await axios.get(`${API_BASE}/api/sprints/${sprintId}`);
      const existingOutput = sprintData?.iterations?.[roleIndex]?.output || '';
      const combined = existingOutput
        ? existingOutput + STEP_OUTPUT_SEPARATOR + endLine
        : endLine;
      await axios.put(`${API_BASE}/api/sprints/${sprintId}/iterations/${roleIndex}/output`, {
        output: combined,
        status: 'running'
      });
    } catch {}

    if (gateErrorCode) {
      throw new Error(`${gateErrorCode}: ${gateErrorMessage}. task=${globalIdx} (${title})`);
    }
  }
  return outputs.join('\n');
}

// Socket.IO 客户端连接
let socket = null;

function initSocket() {
  if (!socket) {
    socket = io(API_BASE.replace('http://', 'ws://'), {
      path: '/socket.io',
      transports: ['websocket']
    });
    socket.on('connect', () => {
      console.log('   🔌 WebSocket 已连接');
    });
  }
  return socket;
}

function sendProgress(message) {
  if (socket && socket.connected) {
    socket.emit('agent:progress', { message });
  }
}

// Skill 路径见 config/skillPaths.js（环境变量可覆盖，支持 skills/vendor 回退）

// 角色与 Skill 映射（角色级默认 skill，用于 executeAgent 等非步骤级调用）
const ROLE_SKILLS = {
  ba: 'brainstorming',
  product: 'brainstorming',
  architect: 'plan-eng-review',
  tech_coach: 'office-hours',
  developer: 'test-driven-development',
  tester: 'qa',
  ops: 'docker-helper',
  evolver: 'retro',
  ghost: 'cso',
  creative: 'design-review'
};

// 大 skill 阈值（超过此大小不注入 prompt，避免上下文膨胀）
const MAX_SKILL_INJECT_SIZE = 30000; // 30KB

// 轻量级 QA 指令（替代 45.6KB 的 gstack qa skill）
const QA_INSTRUCTION = `## QA 测试指南

你有能力使用浏览器工具来测试 Web 应用。当用户要求测试一个 URL 时：

### 测试流程
1. 使用 Bash 工具打开浏览器：open "<url>" 或使用浏览工具
2. 检查页面是否正确加载
3. 测试核心功能（登录、表单提交、按钮点击等）
4. 检查响应式布局（移动端适配）
5. 检查控制台错误
6. 记录所有发现的问题

### 记录格式
对每个发现的问题记录：
- 问题描述
- 复现步骤
- 严重程度（Critical/High/Medium/Low）
- 截图（如有）

### 输出
将测试结果保存到指定的测试报告文件中。`;

// 角色 × 步骤 → Skill 精确映射（只加载当前步骤需要的 skill）
// 格式: { role: [step0_skill, step1_skill, ...] }
// null 表示该步骤不需要加载 skill
// 注意：plan-eng-review (56KB) 和 ship (80KB) 太大，不注入 prompt
const ROLE_STEP_SKILLS = {
  product: [
    'brainstorming',          // 步骤 1/5: 用户画像与核心需求 (10KB)
    'user-story',             // 步骤 2/5: 用户故事拆解 (10KB)
    'product-spec-kit',       // 步骤 3/5: 功能清单与验收标准 (3.8KB)
    'tailwind-design-system', // 步骤 4/5: 界面布局与交互流程（磁盘目录名；逻辑别名 ui-ux-designer 见 config/skillPaths.js）
    null                      // 步骤 5/5: 汇总生成PRD（不需要 skill）
  ],
  architect: [
    'system-design',          // 步骤 1/5: 系统设计 (1.3KB)
    'api-design',             // 步骤 2/5: API 接口设计 (13KB)
    'database-design',        // 步骤 3/5: 数据库模型设计 (1.6KB)
    null,                     // 步骤 4/5: 业务数据流转图
    null                      // 步骤 5/5: OpenSpec CLI 生成 change proposal
  ],
  developer: [
    null,                     // 步骤 1: 读取 OpenSpec change + 现有代码 → 确认范围
    null,                     // 步骤 2: 按 tasks.md 自上而下第 1～10 条任务
    null,                     // 步骤 3: 第 11～20 条
    null,                     // 步骤 4: 第 21～30 条
    null,                     // 步骤 5: 第 31～40 条
    null,                     // 步骤 6: 第 41 条起直至全部完成
    'test-driven-development' // 步骤 7: 生成开发文档+测试 (9.8KB)
  ],
  tester: [
    null,                     // 步骤 1/4: 功能测试用例设计
    null,                     // 步骤 2/4: 执行功能测试（使用 gstack /qa 命令）
    null,                     // 步骤 3/4: 安全漏洞扫描（使用 gstack /qa 命令）
    null                      // 步骤 4/4: 生成测试报告
  ],
  ops: [
    'docker-helper',          // 步骤 1/4: 环境分析 (1KB)
    'docker-helper',          // 步骤 2/4: Dockerfile 设计 (1KB)
    'azure-deploy',           // 步骤 3/4: CI/CD 配置 (6KB)
    'docker-helper'           // 步骤 4/4: 部署脚本 (1KB)
  ],
  tech_coach: [
    null,                     // 步骤 1/2: 信息收集 — 读取产品所有输出
    null                      // 步骤 2/2: 技术实现 — 基于 product/ 输出技术实现文档
  ]
};

// Agent 模型配置 - 使用实际可用的模型名称
const AGENT_MODELS = {
  ba: 'opencode/big-pickle',
  product: 'opencode/qwen3.6-plus-free',
  architect: 'opencode/qwen3.6-plus-free',
  tech_coach: 'opencode/qwen3.6-plus-free',
  developer: 'opencode/gpt-5-nano',
  tester: 'opencode/qwen3.6-plus-free',
  ops: 'opencode/gpt-5-nano',
  evolver: 'opencode/gpt-5-nano',
  ghost: 'opencode/big-pickle',
  creative: 'opencode/big-pickle'
};

// 模型降级配置 - 速率限制时自动切换
const MODEL_FALLBACKS = {
  'opencode/qwen3.6-plus-free': 'opencode/big-pickle',
  'opencode/gpt-5-nano': 'opencode/big-pickle',
  'opencode/big-pickle': null  // 最终降级点，不再切换
};

function getFallbackModel(model, role) {
  // 开发者链路禁止回落到 big-pickle，避免偏离显式配置
  if (role === 'developer') return null;
  return MODEL_FALLBACKS[model] || null;
}

// 超时配置 (毫秒)
const TIMEOUT_CONFIG = {
  ba: 300000,         // 5分钟
  product: 300000,    // 5分钟
  architect: 300000,  // 5分钟
  tech_coach: 300000, // 5分钟
  developer: 1800000,  // 30分钟 (7步拆分后每步)
  tester: 300000,     // 5分钟
  ops: 300000,        // 5分钟
  evolver: 300000     // 5分钟
};

/** OpenSpec 形态 B：每段 LLM 默认超时（runOpenCode 的 timeoutMs 可覆盖） */
const DEFAULT_ARCHITECT_OPENSPEC_PHASE_MS = parseInt(
  process.env.ARCHITECT_OPENSPEC_PHASE_TIMEOUT_MS ||
    process.env.ARCHITECT_OPENSPEC_TIMEOUT_MS ||
    '480000',
  10
);

/** 设为 legacy 时架构师第 5 步使用单次大 prompt；默认走形态 B（分阶段） */
function useArchitectOpenSpecPipelineB() {
  return process.env.DEVFORGE_OPENSPEC_PIPELINE !== 'legacy';
}

// 最大重试次数
const MAX_RETRIES = 2;

// 角色图标和名称
const ROLE_INFO = {
  ba: { icon: '📊', name: 'BA', name_en: 'Business Analyst' },
  product: { icon: '📋', name: '产品经理', name_en: 'Product BA' },
  architect: { icon: '🏗️', name: '架构师', name_en: 'Architect' },
  tech_coach: { icon: '🔍', name: '开发教练', name_en: 'Tech Coach' },
  developer: { icon: '💻', name: '开发者', name_en: 'Developer' },
  tester: { icon: '🧪', name: '测试工程师', name_en: 'QA Engineer' },
  ops: { icon: '⚙️', name: '运维工程师', name_en: 'DevOps' },
  evolver: { icon: '🔄', name: '进化顾问', name_en: 'Evolver' },
  ghost: { icon: '👻', name: '幽灵', name_en: 'Security Ghost' },
  creative: { icon: '🎨', name: '创意', name_en: 'Creative Director' }
};

/**
 * 加载 Skill 内容（主路径 + 仓库 vendor 回退）
 */
async function loadSkill(skillName) {
  const result = await readSkillWithFallback(skillName);
  if ('error' in result) {
    if (result.error === 'unconfigured') {
      console.log(`   ⚠️ 未配置 Skill: ${skillName}`);
    } else {
      console.log(
        `   ⚠️ Skill 文件不存在: ${skillName}\n      主路径: ${result.primary}\n      可设置 DEVFORGE_SUPERPOWERS_SKILLS 或复制到: ${result.fallback}`
      );
    }
    return null;
  }
  if (result.usedFallback) {
    console.log(`   📎 使用仓库内技能副本: ${result.path}`);
  }
  return result.content;
}

/**
 * 保存思考过程
 */
async function saveThinking(pipelineId, role, thinking) {
  const dir = path.join(WORKSPACE, pipelineId, 'thinking');
  await fs.mkdir(dir, { recursive: true });
  
  const fileName = `${String(getStageIndex(role) + 1).padStart(2, '0')}-${role}.json`;
  const filePath = path.join(dir, fileName);
  
  const thinkingData = {
    agent: role,
    startedAt: thinking.startedAt || new Date().toISOString(),
    completedAt: new Date().toISOString(),
    steps: thinking.steps || []
  };
  
  await fs.writeFile(filePath, JSON.stringify(thinkingData, null, 2));
  console.log(`   📝 思考已保存: ${fileName}`);
  return filePath;
}

/**
 * 作用：Tech Coach 2步工作流
  * 步骤1: 读取 product/ 下所有文件
  * 步骤2: 基于 product/ 输出技术实现文档
 */
function generateTechCoachPrompt(context) {
  const { pipelineId, rawInput, workspacePath, prdOutput, stepIndex } = context;
  
  // product/ 目录下的文件列表
  const productFiles = [
    'product/prd.md',
    'product/user-stories.md',
    'product/functional-requirements.md',
    'product/user-journey.md',
    'product/ui-layout.md',
    'product/user-personas.md'
  ];
  const wsPath = workspacePath || `workspace/${pipelineId}`;
  
  if (stepIndex === 0) {
    // 步骤 1: 读取 product/ 文件
    return `# 角色：开发教练 (Tech Coach) - 步骤 1/2

## 原始需求
${rawInput}

## 你的任务
读取 product/ 目录下所有产品输出文件，为下一步生成技术能力需求做准备。

### 读取文件
请读取以下文件：
${productFiles.map(f => `- ${wsPath}/${f}`).join('\n')}

### ⚠️ 重要
- 本步骤只需要读取文件，不需要生成任何输出
- 将读取的内容（特别是 prd.md）作为下一步的输入

## 输出
无需生成文件，只需读取并理解产品需求
`;
  } else {
    // 步骤 2: 技术能力需求（不是技术选型！）
    return `# 角色：开发教练 (Tech Coach) - 步骤 2/2

## 原始需求
${rawInput}

## ⚠️ 核心原则
**你只描述"需要什么技术能力"，不决策"用什么具体技术"。**
技术选型是架构师的职责！

### 输出句式规则
- ✅ 正确：需要（P0）：关系型数据库能力
- ✅ 正确：需要（P1）：JWT 认证能力
- ❌ 错误：推荐：使用 PostgreSQL + Prisma
- ❌ 错误：选择：Express + React 技术栈

## 读取文件
请先读取：
- ${wsPath}/product/prd.md - PRD 文档
- ${wsPath}/product/user-stories.md - 用户故事（带优先级）
- ${wsPath}/product/functional-requirements.md - 功能需求（带优先级）
- ${wsPath}/product/ui-layout.md - 界面布局（如有）

## 你的任务
基于产品文档，分析并输出技术能力需求。

### 优先级说明
- **P0**：核心功能，必须实现，影响技术选型
- **P1**：重要功能，影响架构设计
- **P2**：扩展功能，可以后期添加

### 输出格式
\`\`\`markdown
# 技术能力需求

## P0 核心能力需求（直接影响技术选型）
列出实现 P0 功能必须的技术能力。

## P1 重要能力需求（影响架构设计）
列出实现 P1 功能需要的技术能力。

## P2 扩展能力需求（可以后期添加）
列出实现 P2 功能需要的技术能力（如有）。

## 技术风险点（按优先级标记）
| 优先级 | 风险描述 | 建议 |
|--------|----------|------|
| P0 | 描述 | 建议 |

## 实现难点评估（按优先级标记）
| 优先级 | 难点描述 | 评估 |
|--------|----------|------|
| P0 | 描述 | 高/中/低 |
\`\`\`

## ⚠️ 强制要求
- 必须使用 Write 工具将内容写入文件
- 只写"需要什么能力"，不写"用什么技术"
- 能力需求必须带优先级（P0/P1/P2）
- 风险点和难点也必须带优先级

## 输出文件（本阶段第 2 步必须全部落地）
1. **${wsPath}/tech-coach/tech-implementation.md** — 技术能力需求（主交接物，架构师步骤 1 必读）
2. **${wsPath}/output/tech-feasibility.md** — 可行性结论、关键假设、与 PRD 的差异说明
3. （可选）**${wsPath}/output/user-stories.md** — 若需把产品故事转为工程可估算条目，可在此做节选或补充

## 与架构师的协作边界
- 本步骤结束后，**架构师**将基于上述文件 + PRD + tech-priority 做**技术选型**与架构/OpenSpec。
- 你**不要**在本文档中锁定具体框架版本；架构师负责选型并与本《能力需求》中的 P0/P1/P2 对齐。
`;
  }
}

/**
 * 保存输出
 */
async function saveOutput(pipelineId, role, output) {
  const dir = path.join(WORKSPACE, pipelineId, 'output');
  await fs.mkdir(dir, { recursive: true });
  
  let fileName;
  switch (role) {
    case 'ba': fileName = 'ba-analysis.md'; break;
    case 'product': fileName = 'prd.md'; break;
    case 'architect': fileName = 'openspec.md'; break;
    case 'developer': fileName = 'dev-summary.md'; break;
    case 'tester': fileName = 'test-report.md'; break;
    case 'ops': fileName = 'ops-config.md'; break;
    case 'evolver': fileName = 'evolver-report.md'; break;
    case 'ghost': fileName = 'security-report.md'; break;
    case 'creative': fileName = 'design-review.md'; break;
    default: fileName = `${role}-output.md`;
  }
  
  const filePath = path.join(dir, fileName);
  const content = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  await fs.writeFile(filePath, content, 'utf-8');
  console.log(`   📄 输出已保存: ${fileName}`);
  sendProgress(`输出已保存到: ${fileName}`);
  return filePath;
}

/**
 * 保存角色执行记录到 execution-log 目录
 */
async function saveExecutionLog(pipelineId, role, context) {
  const logDir = path.join(WORKSPACE, pipelineId, 'execution-log');
  await fs.mkdir(logDir, { recursive: true });
  
  const roleIndex = context.roleIndex || 0;
  const paddedIndex = String(roleIndex + 1).padStart(2, '0');
  const logFile = path.join(logDir, `${paddedIndex}-${role}.json`);
  
  // 获取角色定义中的 skill 名称
  const roleSkillMap = {
    'product': 'brainstorming (需求分析)',
    'architect': 'plan-eng-review (架构评审)',
    'developer': 'test-driven-development (TDD)',
    'tester': 'qa (QA测试)',
    'tech_coach': 'office-hours (可行性分析)',
    'ops': 'ship (部署)',
    'evolver': 'refactoring (重构优化)',
    'ghost': 'cso (安全审计)',
    'creative': 'design-review (设计评审)'
  };
  
  // 获取步骤定义
  const steps = context.steps || [];
  
  // 计算耗时
  const startedAt = context.startedAt || new Date().toISOString();
  const completedAt = new Date().toISOString();
  const durationMs = new Date(completedAt) - new Date(startedAt);
  const durationSeconds = Math.floor(durationMs / 1000);
  const durationText = durationSeconds >= 60 
    ? `${Math.floor(durationSeconds / 60)}分${durationSeconds % 60}秒`
    : `${durationSeconds}秒`;
  
  // 扫描产出文件
  const roleDir = path.join(WORKSPACE, pipelineId, role);
  let outputFiles = [];
  try {
    const files = await fs.readdir(roleDir);
    for (const file of files) {
      const filePath = path.join(roleDir, file);
      const stat = await fs.stat(filePath);
      if (stat.isFile() && !file.startsWith('.')) {
        outputFiles.push({
          name: file,
          path: `${role}/${file}`
        });
      }
    }
  } catch (e) {
    // 目录不存在
  }
  
  // 同时扫描 output 目录
  const outputDir = path.join(WORKSPACE, pipelineId, 'output');
  try {
    const files = await fs.readdir(outputDir);
    for (const file of files) {
      const filePath = path.join(outputDir, file);
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        outputFiles.push({
          name: file,
          path: `output/${file}`
        });
      }
    }
  } catch (e) {
    // 目录不存在
  }
  
  const logData = {
    role,
    roleIndex,
    skill: roleSkillMap[role] || 'unknown',
    startedAt,
    completedAt,
    duration: durationText,
    durationMs,
    steps: steps.map((s, i) => ({
      id: i + 1,
      name: s.name || `步骤 ${i + 1}`,
      prompt: s.prompt || ''
    })),
    outputFiles,
    outputPreview: (context.output || '').slice(0, 500),
    summary: context.summary || '',
    rawInput: context.rawInput?.slice(0, 200) || '',
    testEnvironmentUrl: context.testEnvironmentUrl || null
  };
  
  await fs.writeFile(logFile, JSON.stringify(logData, null, 2), 'utf-8');
  console.log(`   📋 执行记录已保存: ${paddedIndex}-${role}.json`);
  
  return logFile;
}

/**
 * 清理僵尸 opencode 进程（状态为 T 的已停止进程）
 * 防止之前超时被 kill 的进程影响新任务
 */
function cleanupZombieProcesses() {
  try {
    // 只清理状态为 T (stopped) 的进程，避免误杀 Harness 进程池中正在运行的 opencode worker。
    // 旧实现使用 `pkill -f "opencode run"` 会直接把所有 worker SIGTERM 掉，导致流程卡死。
    const ps = spawnSync('ps', ['-axo', 'pid=,state=,command='], {
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024
    });
    const out = (ps.stdout || '').trim();
    if (!out) return;
    const lines = out.split('\n');
    for (const line of lines) {
      // 格式："<pid> <state> <command...>"
      const m = line.trim().match(/^(\d+)\s+([A-Za-z+]+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const state = String(m[2] || '');
      const cmd = String(m[3] || '');

      // 只处理 stopped(T) 的 opencode run
      if (!state.includes('T')) continue;
      if (!cmd.includes('opencode')) continue;
      if (!cmd.includes('run')) continue;
      if (!Number.isFinite(pid) || pid <= 1) continue;

      try {
        process.kill(pid, 'SIGTERM');
      } catch (_e) {}
    }
  } catch (e) {
    // 忽略错误（可能没有僵尸进程）
  }
}

/**
 * 执行 OpenCode 并获取输出（带超时和重试）
 */
async function runOpenCode(prompt, options = {}) {
  const {
    model = 'opencode/big-pickle',
    agentName = 'developer',
    retryCount = 0,
    skillName = null,
    usePure = true,
    qaInstruction = null,
    timeoutMs: timeoutMsOpt = null
  } = options;

  // 清理僵尸进程
  cleanupZombieProcesses();

  // 获取对应角色的超时配置（可显式覆盖）
  const timeout = timeoutMsOpt ?? TIMEOUT_CONFIG[agentName] ?? 180000;
  
  // 如果指定了 qaInstruction（轻量级 QA 指令），注入到 prompt
  let finalPrompt = prompt;
  if (qaInstruction) {
    finalPrompt = `${qaInstruction}\n\n---\n\n${prompt}`;
    console.log(`   📦 注入 QA 指令 (${(qaInstruction.length / 1024).toFixed(1)}KB)`);
  } else if (skillName) {
    // 如果指定了 skillName，加载其内容并注入到 prompt 中
    // 超过阈值的 skill 不注入（避免上下文膨胀），交给 opencode 按需加载
    const skillContent = await loadSkill(skillName);
    if (skillContent) {
      if (skillContent.length > MAX_SKILL_INJECT_SIZE) {
        console.log(`   ⏭️ Skill ${skillName} 过大 (${(skillContent.length / 1024).toFixed(1)}KB)，跳过注入`);
      } else {
        finalPrompt = `## Skill 参考: ${skillName}\n\n${skillContent}\n\n---\n\n${prompt}`;
        console.log(`   📦 注入 Skill: ${skillName} (${(skillContent.length / 1024).toFixed(1)}KB)`);
      }
    }
  }
  
  return new Promise((resolve, reject) => {
    // 创建临时文件存储 prompt
    const tmpFile = `/tmp/opencode-prompt-${Date.now()}.txt`;
    
    fs.writeFile(tmpFile, finalPrompt, 'utf-8').then(() => {
      // Tester 角色需要 gstack 插件，不使用 --pure
      const pureFlag = usePure ? '--pure' : '';
      
      console.log(`   🚀 启动 OpenCode: ${model}`);
      sendProgress(`正在调用 AI 模型: ${model}...`);
      
      // 直接启动 opencode 进程，不通过 bash 包装
      const args = ['run', '--format', 'json'];
      if (usePure) args.push('--pure');
      const attachUrl =
        (process.env.DEVFORGE_OPENCODE_ATTACH_URL || process.env.OPENCODE_ATTACH_URL || '').trim();
      if (attachUrl) {
        args.push('--attach', attachUrl);
        console.log(`   🔗 使用 attach 后端: ${attachUrl}`);
      }
      args.push('--model', model, '--dir', ROOT);
      
      const proc = spawn('opencode', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        cwd: ROOT
      });
      
      let stdout = '';
      let stderr = '';
      let closed = false;
      
      const cleanup = async () => {
        try {
          await fs.unlink(tmpFile);
        } catch (e) {}
      };
      
      // 写入 prompt 到 stdin
      proc.stdin.write(finalPrompt);
      proc.stdin.end();
      
      proc.stdout.on('data', d => {
        stdout += d.toString();
      });
      
      proc.stderr.on('data', d => {
        stderr += d.toString();
      });
      
      const handleClose = async (code) => {
        if (closed) return;
        closed = true;
        await cleanup();
        
        console.log(`   📊 OpenCode 退出码: ${code}`);
        
        if (code !== 0 && !stdout) {
          reject(new Error(`OpenCode 失败: ${stderr || '未知错误'}`));
        } else {
          resolve(stdout || stderr);
        }
      };
      
      const handleError = async (e) => {
        if (closed) return;
        closed = true;
        await cleanup();
        reject(e);
      };
      
      proc.on('close', handleClose);
      proc.on('error', handleError);
      
      // 超时处理 - 支持重试
      setTimeout(() => {
        if (!closed) {
          closed = true;
          console.log(`   ⏰ OpenCode 超时 (${timeout}ms), 尝试次数: ${retryCount + 1}/${MAX_RETRIES}`);
          proc.kill('SIGKILL');
          cleanup();
          
          // 如果还有重试次数，抛出错误以便重试
          if (retryCount < MAX_RETRIES) {
            reject(new Error(`TIMEOUT_RETRY`));
          } else {
            reject(new Error(`OpenCode 超时 (${timeout}ms)`));
          }
        }
      }, timeout);
      
    }).catch(reject);
  });
}

/**
 * 在项目中写入 Cursor / Agent 可读约定（与 OpenSpec 路径一致）
 */
async function ensureDevForgeCursorProjectFiles({ projectPath, openspecChangeDir, sprintId }) {
  const rulesDir = path.join(projectPath, '.cursor', 'rules');
  await fs.mkdir(rulesDir, { recursive: true });
  console.log(`   🧩 写入 Cursor 项目约定文件: projectPath=${projectPath}`);
  const relTasks = openspecChangeDir
    ? path.relative(projectPath, path.join(openspecChangeDir, 'tasks.md')).replace(/\\/g, '/')
    : 'openspec/changes/<change-name>/tasks.md';
  const relDesign = openspecChangeDir
    ? path.relative(projectPath, path.join(openspecChangeDir, 'design.md')).replace(/\\/g, '/')
    : 'openspec/changes/<change-name>/design.md';
  const ruleBody = `---
description: DevForge 冲刺开发 — OpenSpec 与代码目录约定
globs: "**/*"
---
# DevForge 与 OpenSpec

- **权威任务清单**：\`${relTasks}\`（相对项目根）
- **设计**：\`${relDesign}\`
- **代码**：在 \`src/\` 下实现；不要擅自删除 OpenSpec 文件
- 冲刺 ID：${sprintId || 'n/a'}
`;
  await fs.writeFile(path.join(rulesDir, 'devforge-openspec.mdc'), ruleBody, 'utf-8');

  const agentsBody = `# DevForge Agent 说明

本目录由 DevForge 自动生成/更新。

- **tasks.md**：${relTasks}
- **design.md**：${relDesign}
- **代码根目录**：\`src/\`

按 tasks.md 自上而下顺序实现；完成后在 DevForge Dashboard 中确认迭代状态。
`;
  await fs.writeFile(path.join(projectPath, 'AGENTS.md'), agentsBody, 'utf-8');
  console.log(`   ✅ Cursor 项目约定文件已写入: ${path.join(rulesDir, 'devforge-openspec.mdc')}, ${path.join(projectPath, 'AGENTS.md')}`);
}

/**
 * Cursor CLI：非交互 Agent（需本机安装 Cursor CLI，参见 https://cursor.com/cli ）
 * 参数可通过 CURSOR_CLI、CURSOR_CLI_ARGS 覆盖（空格分隔）。
 */
async function runCursorAgent(prompt, options = {}) {
  const { cwd, timeoutMs: timeoutMsOpt, agentName = 'developer' } = options;
  const exe = process.env.CURSOR_CLI || 'cursor';
  const extraArgs = process.env.CURSOR_CLI_ARGS
    ? process.env.CURSOR_CLI_ARGS.split(/\s+/).filter(Boolean)
    : ['agent', 'chat', '--print', '--force'];

  const timeout = timeoutMsOpt ?? TIMEOUT_CONFIG[agentName] ?? 1800000;

  return new Promise((resolve, reject) => {
    console.log(`   🚀 启动 Cursor CLI: ${exe} ${extraArgs.join(' ')} (cwd=${cwd || ROOT})`);
    sendProgress('正在调用 Cursor Agent…');

    const proc = spawn(exe, extraArgs, {
      cwd: cwd || ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    proc.stdin.write(prompt);
    proc.stdin.end();

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill('SIGKILL');
      } catch (e) {}
      reject(new Error(`Cursor CLI 超时 (${timeout}ms)`));
    }, timeout);

    const finish = (code, err) => {
      if (settled) return;
      clearTimeout(timeoutId);
      settled = true;
      console.log(`   📊 Cursor CLI 退出码: ${code ?? 'n/a'}`);
      if (err && (err.code === 'ENOENT' || err.errno === 'ENOENT')) {
        reject(
          new Error(
            `未找到 Cursor CLI（${exe}）。请安装 https://cursor.com/cli 并确保 PATH 可执行，或设置环境变量 CURSOR_CLI 为可执行文件路径。`
          )
        );
        return;
      }
      if (err) {
        reject(err);
        return;
      }
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Cursor CLI 失败: ${stderr || '未知错误'}`));
      } else {
        resolve(stdout || stderr);
      }
    };

    proc.on('close', (code) => finish(code, null));
    proc.on('error', (e) => finish(null, e));
  });
}

/**
 * 解析 OpenCode 输出
 * 只提取纯文本内容，过滤掉 JSON 事件结构
 */
function parseOpenCodeOutput(rawOutput) {
  const lines = rawOutput.split('\n').filter(l => l.trim());
  const events = [];
  const texts = [];

  const pushContentText = (content) => {
    if (content === undefined || content === null) return;
    if (typeof content === 'string') {
      texts.push(content);
      return;
    }
    if (Array.isArray(content)) {
      for (const item of content) {
        pushContentText(item);
      }
      return;
    }
    if (typeof content === 'object') {
      if (typeof content.text === 'string') {
        texts.push(content.text);
        return;
      }
      if (typeof content.content === 'string' || Array.isArray(content.content) || typeof content.content === 'object') {
        pushContentText(content.content);
        return;
      }
      return;
    }
    texts.push(String(content));
  };
  
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      events.push(event);
      
      // 提取文本内容 - 从多种可能的字段位置获取
      if (event.part?.text !== undefined) pushContentText(event.part.text);
      else if (event.part?.content !== undefined) pushContentText(event.part.content);
      else if (event.message?.content !== undefined) pushContentText(event.message.content);
      else if (event.content !== undefined) pushContentText(event.content);
      else if (event.text !== undefined) pushContentText(event.text);
    } catch (e) {
      // 非 JSON 行当作文本处理
      if (line.trim()) {
        texts.push(line);
      }
    }
  }
  
  return {
    events,
    text: texts.join('\n\n')
  };
}

/**
 * 从开发者输出中提取 README 和 API 文档
 */
function extractDeveloperDocs(text) {
  const result = {};
  
  // 提取 README (从 markdown 代码块)
  const readmeMatch = text.match(/```markdown\n([\s\S]*?)```/i) || 
                     text.match(/```md\n([\s\S]*?)```/i) ||
                     text.match(/# .+\n+## 📋 项目概述[\s\S]*?(?=```|$)/i);
  if (readmeMatch) {
    result.readme = readmeMatch[1] || readmeMatch[0];
  }
  
  // 提取 API 文档表格并解析为 JSON
  const apiTableMatch = text.match(/\|.*方法.*\|.*路径.*\|/i);
  if (apiTableMatch) {
    const lines = text.split('\n').filter(l => l.includes('|') && l.trim() && !l.includes('---'));
    const apiDocs = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 跳过表头
      if (line.includes('方法') && line.includes('路径')) continue;
      if (line.includes('---')) continue;
      
      const cols = line.split('|').filter(c => c.trim());
      if (cols.length >= 4) {
        apiDocs.push({
          method: cols[1]?.trim() || '',
          path: cols[2]?.trim() || '',
          description: cols[3]?.trim() || '',
          request: cols[4]?.trim() || '',
          response: cols[5]?.trim() || ''
        });
      }
    }
    
    if (apiDocs.length > 0) {
      result.apiDocs = apiDocs;
    }
  }
  
  return result;
}

/**
 * 生成 Product Agent 的提示词 - 直接生成 PRD，不提问
 */
function generateProductPrompt(context) {
  const { pipelineId, rawInput, workspacePath, stepIndex } = context;
  
  const stepPrompts = [
    `# 角色：产品经理 - 步骤 1/5: 用户画像与核心需求

## 用户需求
${rawInput}

## 工作目录
${workspacePath}

## 你的任务
分析目标用户群体，识别核心需求和痛点。

## 输出要求
生成用户画像文档，包含：
- 目标用户群体描述
- 用户痛点
- 核心需求
- 用户场景

## 输出文件
保存到: ${workspacePath}/product/user-personas.md
`,
    `# 角色：产品经理 - 步骤 2/5: 用户故事拆解

## 用户需求
${rawInput}

## 工作目录
${workspacePath}

## 你的任务
基于用户画像拆解用户故事。

## 输出要求
生成用户故事文档，包含：
- 用户故事（As a, I want, so that）
- 优先级（HIGH/MEDIUM/LOW）
- 验收标准（Given-When-Then 格式）

## 输出文件
保存到: ${workspacePath}/product/user-stories.md
`,
    `# 角色：产品经理 - 步骤 3/5: 功能清单与验收标准

## 用户需求
${rawInput}

## 工作目录
${workspacePath}

## 你的任务
定义功能清单和验收标准。

## 输出要求
生成功能需求文档，包含：
- 功能清单（功能名称、描述、优先级）
- 功能依赖关系
- 验收标准

## 输出文件
保存到: ${workspacePath}/product/functional-requirements.md
`,
    `# 角色：产品经理 - 步骤 4/5: 界面布局与交互流程

## 用户需求
${rawInput}

## 工作目录
${workspacePath}

## 你的任务
设计页面布局和用户交互流程。

## 输出要求
生成界面设计文档，包含：
- 页面结构
- 导航结构
- 核心页面布局
- 用户交互流程

## 输出文件
保存到: ${workspacePath}/product/ui-layout.md
和: ${workspacePath}/product/user-journey.md
`,
    `# 角色：产品经理 - 步骤 5/5: 汇总生成PRD

## 用户需求
${rawInput}

## 工作目录
${workspacePath}

## 你的任务
整合所有产出，生成完整的PRD文档。

## 输出要求
生成 JSON 格式的 PRD，必须包含以下结构：

json
{
  "productOverview": {
    "name": "产品名称",
    "oneSentenceValue": "一句话描述产品价值",
    "productType": "web-app|web-api|cli|工具类",
    "targetPlatform": "目标平台描述"
  },
  "userPersonas": [],
  "userStories": [],
  "functionalRequirements": [],
  "nonFunctionalRequirements": [],
  "milestones": []
}


## 输出文件
保存为 JSON 到: ${workspacePath}/product/prd.json
同时生成 Markdown 版本到: ${workspacePath}/product/prd.md
`
  ];

  // 如果指定了 stepIndex，返回对应步骤的 prompt
  if (stepIndex !== null && stepIndex >= 0 && stepIndex < stepPrompts.length) {
    return stepPrompts[stepIndex];
  }

  // 默认返回完整 prompt（第5步，即生成完整 PRD）
  return stepPrompts[4];
}

/**
 * 获取步骤指导
 */
function getStepGuidance(role, stepIndex) {
  const steps = {
    product: [
      '## 步骤 1/5: 用户画像与核心需求\n分析目标用户群体，识别核心需求和痛点。输出到 product/user-personas.md',
      '## 步骤 2/5: 用户故事拆解\n基于用户画像拆解用户故事。输出到 product/user-stories.md',
      '## 步骤 3/5: 功能清单与验收标准\n定义功能清单和验收标准。输出到 product/functional-requirements.md',
      '## 步骤 4/5: 界面布局与交互流程\n设计页面布局和用户交互流程。输出到 product/ui-layout.md, product/user-journey.md',
      '## 步骤 5/5: 汇总生成PRD\n整合所有产出，生成完整的PRD文档。输出到 product/prd.json, product/prd.md'
    ],
    architect: [
      '## 步骤 1/5: 系统架构设计\n读取 tech-priority.md，根据能力需求优先级选择技术。输出到 architect/architecture.md',
      '## 步骤 2/5: API 接口设计\n基于架构设计 RESTful API 规范。输出到 architect/api-design.md',
      '## 步骤 3/5: 数据库模型设计\n设计数据库表结构和关系。输出到 architect/database.md',
      '## 步骤 4/5: 业务数据流转图\n绘制 Mermaid 业务数据流转图。输出到 architect/data-flow.md',
      '## 步骤 5/5: OpenSpec Change Proposal\n使用 OpenSpec CLI 创建规范的 change proposal'
    ],
    developer: [
      '## 步骤 1/7: 范围确认\n读取 OpenSpec change (proposal.md, design.md, tasks.md) + 现有代码，确认实现范围和任务列表',
      '## 步骤 2/7: 按 tasks.md 执行（第 1 批: 自上而下第 1～10 条任务）\n读取 tasks.md，执行文件中第 1～10 条可执行任务。每完成一条输出进度。',
      '## 步骤 3/7: 按 tasks.md 执行（第 2 批: 第 11～20 条）\n继续执行第 11～20 条。每完成一条输出进度。',
      '## 步骤 4/7: 按 tasks.md 执行（第 3 批: 第 21～30 条）\n继续执行第 21～30 条。每完成一条输出进度。',
      '## 步骤 5/7: 按 tasks.md 执行（第 4 批: 第 31～40 条）\n继续执行第 31～40 条。每完成一条输出进度。',
      '## 步骤 6/7: 按 tasks.md 执行（第 5 批: 第 41 条起至全部完成）\n执行剩余全部任务。每完成一条输出进度。',
      '## 步骤 7/7: 开发文档\n生成 README.md、API.md、dev-summary.md。输出到 developer/'
    ],
    tester: [
      '## 步骤 1/4: 功能测试用例设计\n基于 PRD 和 OpenSpec 设计功能测试用例。输出到 tester/test-cases.md',
      '## 步骤 2/4: 执行功能测试\n执行功能测试并记录测试结果。输出到 tester/test-results.md',
      '## 步骤 3/4: 安全漏洞扫描\n进行安全漏洞扫描，检查接口安全。输出到 tester/security-scan.md',
      '## 步骤 4/4: 生成测试报告\n汇总所有测试结果，生成最终测试报告。输出到 tester/test-report.md, tester/security-report.md'
    ],
    tech_coach: [
      '## 步骤 1/2: 信息收集\n读取 product/ 下 PRD 与用户故事，为步骤 2 的《技术能力需求》做准备（本步不写选型）',
      '## 步骤 2/2: 能力需求与可行性\n产出 tech-coach/tech-implementation.md（P0/P1/P2 能力需求）+ output/tech-feasibility.md；**不做技术栈决策**。下一步由架构师读取上述文件做选型与 OpenSpec'
    ],
    ghost: [
      '## 步骤 1/2: 威胁建模与资产梳理\n识别信任边界与敏感数据流。输出到 output/security-report.md',
      '## 步骤 2/2: 漏洞与整改建议\n列出发现与修复优先级。追加到 output/security-report.md'
    ],
    creative: [
      '## 步骤 1/2: 体验与视觉评审\n对照需求评审信息架构与关键流程。输出到 output/design-review.md',
      '## 步骤 2/2: 改进清单\n列出可执行的设计改进项。追加到 output/design-review.md'
    ],
    evolver: [
      '## 步骤 1/2: 技术债务与风险\n扫描代码与架构债务。输出到 output/evolver-report.md',
      '## 步骤 2/2: 优化路线图\n给出可落地的重构与演进建议。追加到 output/evolver-report.md'
    ]
  };
  
  return steps[role]?.[stepIndex] || '';
}

/**
 * 生成 Architect Agent 的提示词 - 直接选择方案并生成架构，不提问
 */
async function generateArchitectPrompt(context) {
  const { pipelineId, rawInput, workspacePath, prd, stepIndex, projectPath, codePath, techCoachOutput } =
    context;

  const techCoachBridge =
    techCoachOutput && String(techCoachOutput).trim().length > 80
      ? `### 开发教练迭代输出（摘要；完整内容以文件为准）\n\n${String(techCoachOutput).slice(0, 12000)}`
      : '_（请读取 workspace 下 tech-coach/tech-implementation.md 与 output/tech-feasibility.md）_';

  // 步骤 5 (stepIndex=4) 或默认执行 (stepIndex=null) 需要前几步架构产出
  const isLastStep = stepIndex === null || stepIndex === 4;
  const legacyFullContext = process.env.DEVFORGE_LEGACY_FULL_OPENSPEC_CONTEXT === '1';

  let step1Output = '',
    step2Output = '',
    step3Output = '',
    step4Output = '';
  if (isLastStep && legacyFullContext) {
    try {
      step1Output = await fs.readFile(path.join(workspacePath, 'architect/architecture.md'), 'utf-8');
    } catch (e) {
      step1Output = '未找到（步骤 1 可能未执行或未保存）';
    }
    try {
      step2Output = await fs.readFile(path.join(workspacePath, 'architect/api-design.md'), 'utf-8');
    } catch (e) {
      step2Output = '未找到（步骤 2 可能未执行或未保存）';
    }
    try {
      step3Output = await fs.readFile(path.join(workspacePath, 'architect/database.md'), 'utf-8');
    } catch (e) {
      step3Output = '未找到（步骤 3 可能未执行或未保存）';
    }
    try {
      step4Output = await fs.readFile(path.join(workspacePath, 'architect/data-flow.md'), 'utf-8');
    } catch (e) {
      step4Output = '未找到（步骤 4 可能未执行或未保存）';
    }
  }

  const previousStepsContext = isLastStep
    ? legacyFullContext
      ? `
## 前三步架构设计产出（必须读取并整合到 OpenSpec artifacts 中）

### 步骤 1：系统架构设计

${step1Output}


### 步骤 2：API 接口设计

${step2Output}


### 步骤 3：数据库模型设计

${step3Output}


**重要**: 以上是你之前生成的架构设计产出，创建 OpenSpec artifacts 时必须基于这些实际内容：
- design.md 必须整合步骤 1 的系统架构 + 步骤 2 的 API 设计 + 步骤 3 的数据库设计
- tasks.md 的任务必须覆盖以上所有设计内容
- 不要凭空编造，要忠实反映前三步的实际设计决策
`
      : `
## 前置架构产出（请用 Read 工具读取以下磁盘文件，禁止臆造）
- ${workspacePath}/architect/architecture.md
- ${workspacePath}/architect/api-design.md
- ${workspacePath}/architect/database.md
- ${workspacePath}/architect/data-flow.md

**重要**: design.md 须整合上述文件；tasks.md 须覆盖 design。若设 \`DEVFORGE_LEGACY_FULL_OPENSPEC_CONTEXT=1\` 可恢复旧版全文嵌入（不推荐，易超长超时）。
`
    : '';

  const prdBlock = String(prd || '无').slice(0, 12000);
  
  const openSpecInit = isLastStep ? `
### 1. 初始化 OpenSpec 环境（如果项目还没有 OpenSpec）

**重要：必须先切换到项目目录再执行命令**

首先执行 Bash 命令切换目录：
\`\`\`bash
cd ${projectPath}
pwd
\`\`\`

然后检查是否存在 openspec/spec.json 或 openspec/ 目录：
- 如果不存在: 执行 \`openspec init --tools opencode --no-color\`
- 如果已存在: 跳过此步骤
` : '';

  const openSpecCreate = isLastStep ? `
### 2. 创建 change proposal

**重要：必须先切换到项目目录再执行命令**

首先执行 Bash 命令切换目录：
\`\`\`bash
cd ${projectPath}
\`\`\`

基于 PRD 和前 3 步的架构设计，创建 change：
\`\`\`bash
openspec new change "<feature-name>" --description "<一句话描述>"
\`\`\`

feature-name 格式: sprint-N-short-desc（如 "sprint-1-user-auth", "sprint-2-payment"）；description 为一句话描述。
` : '';

  const openSpecStatus = isLastStep ? `
### 3. 获取 artifact 构建顺序
bash
openspec status --change "<feature-name>" --json

从 JSON 中获取 applyRequires（需要哪些 artifacts 才能开始实现）。
` : '';

  const openSpecArtifacts = isLastStep ? `
### 4. 按依赖顺序创建 artifacts
对每个 artifact：
bash
openspec instructions <artifact-id> --change "<feature-name>" --json

从 instructions JSON 获取 template 和 rules，创建对应文件：
- **proposal.md** — 变更描述、需求、影响范围（需求来源: PRD）
- **design.md** — 技术设计决策（整合步骤 1 的系统架构 + 步骤 2 的 API 设计 + 步骤 3 的数据库设计）
- **tasks.md** — 实现任务清单（基于 design.md，细化为可执行的开发任务，供开发者按顺序执行）
` : '';

  const openSpecValidate = isLastStep ? `
### 5. 验证 change proposal
bash
openspec validate "<feature-name>"
openspec status --change "<feature-name>"

确保所有 applyRequires artifacts 状态为 done。
` : '';

  const openSpecOutput = isLastStep ? `
## 输出要求
- OpenSpec change 目录: projects/<pipelineId>/openspec/changes/<feature-name>/
- 包含 proposal.md, design.md, tasks.md 等标准 artifacts
- 确保 openspec status 显示所有 applyRequires artifacts 为 done 状态

## 项目代码目录（按需）
在 \`projects/<pipelineId>/src/\` 下按需创建前后端目录即可，不必展开冗长脚手架。
` : '';

  const openSpecFallback = isLastStep ? `
- 如果 openspec CLI 不可用，降级为手动创建目录结构:
  
  projects/<pipelineId>/openspec/changes/<feature-name>/
  ├── proposal.md
  ├── design.md
  └── tasks.md
  
` : '';
  
  const stepPrompts = [
    `# 角色：架构师 - 步骤 1/5：系统设计

## 与开发教练的协作（BUILD 技术设计阶段）
- **教练已完成**：将 PRD 译为「技术能力需求」与可行性（见下方文件）；**不定具体框架**。
- **你的职责**：在 tech-priority 约束下做出**技术选型**、组件划分与数据流，并与教练的 P0/P1/P2 能力需求对齐。
- 若下列「API 同步摘要」与 workspace 文件不一致，**以磁盘文件为准**。

${techCoachBridge}

## 原始需求
${rawInput}

## 工作目录
${workspacePath}

## 输入
请先读取以下文件：
1. ${workspacePath}/tech-coach/tech-implementation.md - 技术能力需求（带 P0/P1/P2 优先级）
2. ${workspacePath}/output/tech-feasibility.md - 开发教练可行性结论（若存在）
3. ${workspacePath}/../agents/tech-priority.md - 技术选型优先级参考文档

## ⚠️ 重要：技术选型必须遵循 tech-priority.md

**这是架构师的核心职责：根据能力需求的优先级，按照技术优先级文档选择最合适的技术。**

### 技术优先级原则
- **P0 能力** → 选择 tech-priority.md 中 P0 优先级的技术（最稳定、最成熟）
- **P1 能力** → 选择 tech-priority.md 中 P1 优先级的技术（功能完善）
- **P2 能力** → 选择 tech-priority.md 中 P2 优先级的技术（轻量、简单）

### 典型选型参考
| 能力优先级 | 后端框架 | 数据库 | 认证 |
|-----------|----------|--------|------|
| P0 | Java + Spring Boot | MySQL | JWT + Spring Security |
| P1 | Node.js + Express | PostgreSQL | Passport.js |
| P2 | Python + FastAPI | SQLite | 简单 Token |

## 你的任务
基于 tech-implementation.md 的能力需求 + tech-priority.md 的优先级指导，设计系统架构。

## 输出要求
1. 系统架构图（使用 Mermaid）
2. **技术选型决策**（必须基于 tech-priority.md）
3. 选型理由（引用 tech-priority.md 中的优先级说明）
4. 组件列表和职责
5. 数据流设计

## ⚠️ 强制要求
- 必须使用 Write 工具将架构设计写入文件
- 技术选型必须说明理由，引用 tech-priority.md
- **不要凭空选择技术，必须遵循 tech-priority.md 的优先级**

保存到: ${workspacePath}/architect/architecture.md
`,
    `# 角色：架构师 - 步骤 2/5：API 设计

## 原始需求
${rawInput}

## 工作目录
${workspacePath}

## 输入
请先读取：
- ${workspacePath}/tech-coach/tech-implementation.md - 技术能力需求（与教练对齐）
- ${workspacePath}/output/tech-feasibility.md - 可行性（若存在）
- ${workspacePath}/architect/architecture.md - 系统架构（包含技术选型）
- ${workspacePath}/product/functional-requirements.md - 功能需求（包含优先级）
- ${workspacePath}/product/user-stories.md - 用户故事

## 你的任务
基于架构设计和技术选型，设计 API 接口规范。

## ⚠️ 核心原则
**根据功能需求自主识别需要哪些 API 模块**，不要预设固定的模块列表。

## 输出要求
基于读取的功能需求，设计 API 接口：
- 从功能需求中识别需要的业务模块
- 每个 API 包含：方法、路径、说明、请求参数、响应格式
- 标注 API 对应的功能优先级（P0/P1/P2）

## ⚠️ 强制要求
**必须使用 Write 工具将 API 设计写入文件**：
${workspacePath}/architect/api-design.md

文件内容必须包含完整的 API 接口定义，不要只输出到控制台。
`,
    `# 角色：架构师 - 步骤 3/5：数据存储与模型设计（按需求裁剪）

## 原始需求
${rawInput}

## 工作目录
${workspacePath}

## 你的任务
基于 tech-implementation.md + 系统设计，设计数据存储方案与数据模型（不强制必须有后端数据库）。

## 输入
请先读取：
- ${workspacePath}/tech-coach/tech-implementation.md（能力需求 P0/P1/P2）
- ${workspacePath}/output/tech-feasibility.md（若存在）
- ${workspacePath}/architect/architecture.md
- ${workspacePath}/product/functional-requirements.md

## 输出要求
你必须先判断本项目是否为纯前端（例如“计算器”等无需服务端持久化）。然后按下面两种模式之一输出：

### 模式 A：纯前端/无需后端数据库
- 明确写出结论：**无需后端 API、无需关系型数据库**
- 给出本地持久化（如 localStorage/IndexedDB）的数据结构（如需要），包含 key、字段、版本升级策略
- 给出状态模型（state shape）与数据流（读写时机、错误恢复）

### 模式 B：存在后端/需要数据库
- 从功能需求中识别核心业务实体并建模（不要预设固定业务域）
- 输出 ER 图（Mermaid）+ 表结构（字段/主键/外键/索引）+ 关键约束（唯一性、幂等、软删等）

## ⚠️ 强制要求
**必须使用 Write 工具将本步产出写入文件**（即使为“无需 DB”，也要写明理由与替代方案）：
${workspacePath}/architect/database.md

不要只输出到控制台。
`,
    `# 角色：架构师 - 步骤 4/5：业务数据流转图

## 原始需求
${rawInput}

## 工作目录
${workspacePath}

## 你的任务
基于步骤 1-3 的产出，绘制 Mermaid 业务数据流转图。

## 输入
请先读取：
- ${workspacePath}/architect/architecture.md
- ${workspacePath}/architect/api-design.md
- ${workspacePath}/architect/database.md

## 输出要求
Mermaid 流程图展示：
- 业务数据流向
- 模块交互关系

保存到: ${workspacePath}/architect/data-flow.md
`,
    `# 角色：架构师 - 步骤 5/5：OpenSpec Change Proposal

## 用户原始需求
${rawInput}

## 整合需求文档
${prdBlock}
${previousStepsContext}

## 工作目录
${workspacePath}

## 你的任务
使用 OpenSpec CLI 工具创建规范的 change proposal。

## 执行步骤
${openSpecInit}
${openSpecCreate}
${openSpecStatus}
${openSpecArtifacts}
${openSpecValidate}
${openSpecOutput}

## 注意
- proposal.md 的需求来源: tech-implementation.md + output/tech-feasibility.md + product/prd.md
- design.md 的技术设计来源: 步骤 1-4 产出（须与开发教练的 P0/P1/P2 能力需求一致）
- tasks.md 的任务拆解: 基于 design.md${openSpecFallback}
`
  ];

  // 如果指定了 stepIndex，返回对应步骤的 prompt
  if (stepIndex !== null && stepIndex >= 0 && stepIndex < stepPrompts.length) {
    let prompt = stepPrompts[stepIndex];
    // 替换占位符
    if (codePath) {
      prompt = prompt.replace(/CODE_DIR_PLACEHOLDER/g, codePath + '/');
    }
    return prompt;
  }
  
  // 默认返回最后一步（第5步 - OpenSpec）- 因为这是最重要的产出
  let defaultPrompt = stepPrompts[stepPrompts.length - 1];
  if (codePath) {
    defaultPrompt = defaultPrompt.replace(/CODE_DIR_PLACEHOLDER/g, codePath + '/');
  }
  return defaultPrompt;
}

/**
 * 生成 Developer Agent 的提示词 - 根据 tech_coach 产出动态生成步骤
 */
function generateDeveloperPrompt(context) {
  const {
    pipelineId,
    sprintId,
    rawInput,
    workspacePath,
    openspec,
    openspecChangeDir,
    techCoachOutput,
    stepIndex,
    projectPath,
    codePath
  } = context;

  const pid = pipelineId || sprintId;
  const proj = projectPath || path.join(ROOT, 'projects', pid);
  const art = resolveOpenSpecArtifactPaths(proj, openspecChangeDir);
  const tasksPathLine = art.tasksPath
    ? art.tasksPath
    : `${art.changesBaseDir}/<change-name>/tasks.md（请先用 Read 列出 ${art.changesBaseDir}，在子目录中定位本次 change 的 tasks.md）`;
  const designPathLine = art.designPath
    ? art.designPath
    : `${art.changesBaseDir}/<change-name>/design.md（与 tasks.md 同目录）`;
  const proposalPathLine = art.proposalPath
    ? art.proposalPath
    : `${art.changesBaseDir}/<change-name>/proposal.md（与 tasks.md 同目录）`;
  const openSpecDirLine = art.changeDir || art.changesBaseDir;

  const batchExplain = `**批次说明**：tasks.md 中的任务可能以 \`1.1\`、\`- [ ]\`、\`##\` 小节等形式出现。以下「第 N～M 条」均指**文件自上而下**的第 N～M 个**可执行任务**（与具体编号形式无关；以你在步骤 1 中列出的顺序为准）。`;

  let specContext = '';
  if (openspecChangeDir) {
    specContext = `
## OpenSpec Change Proposal
Change 目录: ${openspecChangeDir}
请读取以下文件作为开发的权威依据:
- ${path.join(openspecChangeDir, 'tasks.md')}（实现任务清单 — 按顺序执行）
- ${path.join(openspecChangeDir, 'design.md')}（技术设计决策）
- ${path.join(openspecChangeDir, 'proposal.md')}（需求背景）
`;
  } else if (openspec) {
    specContext = `
## OpenSpec（架构师产出）
${typeof openspec === 'string' ? openspec.slice(0, 5000) : JSON.stringify(openspec, null, 2).slice(0, 5000)}
`;
  }

  let techContext = '';
  if (techCoachOutput) {
    techContext = `
## 技术实现文档（开发教练产出）
${typeof techCoachOutput === 'string' ? techCoachOutput.slice(0, 5000) : JSON.stringify(techCoachOutput, null, 2).slice(0, 5000)}
`;
  }

  const projectDir = codePath || path.join(projectPath || `projects/${pid}`, 'src');
  const wsPath = workspacePath || `workspace/${pid}`;
  const fileWriteProtocol = `
## ⚠️ 文件落盘协议（必须严格遵守）
你当前运行在一种**不能直接使用 Write 工具写文件**的执行环境中。
为了让执行器把代码写入磁盘，你必须在输出中包含一个或多个“文件块”，格式如下（必须严格一致）：

\`\`\`file:backend/pom.xml
<文件内容>
\`\`\`

\`\`\`file:frontend/package.json
<文件内容>
\`\`\`

规则：
- 路径必须是相对于代码目录（${projectDir}）的相对路径，**不要**写绝对路径
- 只允许写入 backend/ 或 frontend/ 下的文件
- 每个文件块都必须是完整文件内容（不是 diff）
- 你可以在文件块之外输出进度说明，但最终必须包含文件块，否则不会生成任何代码文件
`;

  const stepPrompts = [
    `# 角色：开发者 - 步骤 1/7：范围确认

## 用户需求
${rawInput}
${specContext}
${techContext}

## 工作目录
- 执行记录: ${wsPath}
- 代码目录: ${projectDir}
- OpenSpec: ${openSpecDirLine}

## 你的任务
### 执行前准备
首先创建目录结构（如果不存在）：
\`\`\`
${projectDir}/
├── backend/
│   └── src/
│       ├── routes/
│       ├── models/
│       ├── middleware/
│       ├── utils/
│       └── data/
└── frontend/
    └── src/
        ├── pages/
        ├── components/
        ├── api/
        └── store/
\`\`\`

### 然后确认实现范围
**首先必须读取任务清单文件**，这是开发的核心依据：

1. 读取 tasks.md（任务清单 - **必须首先读取**）:
   ${tasksPathLine}
   读取后列出所有任务项（自上而下编号或引用原文标题）。

2. 读取 design.md（技术设计）:
   ${designPathLine}

3. 读取 proposal.md（需求背景）:
   ${proposalPathLine}

4. 检查现有代码（如有）:
   - ${projectDir}/

5. 确认本次实现范围，列出需要实现的任务列表

## ⚠️ 强制要求
- 直接确认范围并列出任务，不要询问是否可以继续
- 如果代码已存在，分析完成度并列出剩余任务
- 不要等待用户确认，直接输出任务列表并准备执行

## 输出
确认范围后直接输出任务列表到控制台，然后开始执行 Step 2
`,
    // 步骤 2: 第 1～10 条
    `# 角色：开发者 - 步骤 2/7：按 tasks.md 执行（第 1 批：自上而下第 1～10 条）

## 任务清单位置（必须读取）
${tasksPathLine}

${batchExplain}

## 用户需求
${rawInput}

## 工作目录
- 执行记录: ${wsPath}
- 代码目录: ${projectDir}

## 你的任务
1. 首先读取 tasks.md 文件
2. 执行**第 1～10 条**可执行任务；若总数不足 10 条则全部做完后进入步骤 3
3. 每完成一条就把代码写入: ${projectDir}/（使用下方“文件落盘协议”输出文件块）

### ⚠️ 强制要求（必须遵守）
- **必须输出文件块（见下方协议），否则不会生成任何代码文件**
- 进度输出与 tasks.md 中的标记一致即可，例如 \`[任务 第2条] 完成: …\` 或 \`[任务1.2] 完成: …\`
- 直接执行任务，不要询问是否可以继续

${fileWriteProtocol}

## 输出
每完成一条输出一行进度；全部完成后继续执行步骤 3
`,
    // 步骤 3: 第 11～20 条
    `# 角色：开发者 - 步骤 3/7：按 tasks.md 执行（第 2 批：第 11～20 条）

## 任务清单位置
${tasksPathLine}

${batchExplain}

## 用户需求
${rawInput}

## 工作目录
- 执行记录: ${wsPath}
- 代码目录: ${projectDir}

## 你的任务
继续执行 tasks.md 中**第 11～20 条**可执行任务。

### ⚠️ 强制要求（必须遵守）
- **必须输出文件块（见下方协议），否则不会生成任何代码文件**
- 代码保存路径: ${projectDir}/

${fileWriteProtocol}

## 输出
每完成一条输出一行进度；完成后继续执行步骤 4
`,
    // 步骤 4: 第 21～30 条
    `# 角色：开发者 - 步骤 4/7：按 tasks.md 执行（第 3 批：第 21～30 条）

## 任务清单位置
${tasksPathLine}

${batchExplain}

## 用户需求
${rawInput}

## 工作目录
- 执行记录: ${wsPath}
- 代码目录: ${projectDir}

## 你的任务
继续执行 tasks.md 中**第 21～30 条**可执行任务。

### ⚠️ 强制要求（必须遵守）
- **必须输出文件块（见下方协议），否则不会生成任何代码文件**
- 代码保存路径: ${projectDir}/

${fileWriteProtocol}

## 输出
每完成一条输出一行进度；完成后继续执行步骤 5
`,
    // 步骤 5: 第 31～40 条
    `# 角色：开发者 - 步骤 5/7：按 tasks.md 执行（第 4 批：第 31～40 条）

## 任务清单位置
${tasksPathLine}

${batchExplain}

## 用户需求
${rawInput}

## 工作目录
- 执行记录: ${wsPath}
- 代码目录: ${projectDir}

## 你的任务
继续执行 tasks.md 中**第 31～40 条**可执行任务。

### ⚠️ 强制要求（必须遵守）
- **必须输出文件块（见下方协议），否则不会生成任何代码文件**
- 代码保存路径: ${projectDir}/

${fileWriteProtocol}

## 输出
每完成一条输出一行进度；完成后继续执行步骤 6
`,
    // 步骤 6: 第 41 条起至全部完成
    `# 角色：开发者 - 步骤 6/7：按 tasks.md 执行（第 5 批：第 41 条起直至全部完成）

## 任务清单位置
${tasksPathLine}

${batchExplain}

## 用户需求
${rawInput}

## 工作目录
- 执行记录: ${wsPath}
- 代码目录: ${projectDir}

## 你的任务
继续执行 tasks.md 中**第 41 条及之后**的全部剩余任务，直到没有未完成任务。

### ⚠️ 强制要求（必须遵守）
- **必须输出文件块（见下方协议），否则不会生成任何代码文件**
- 代码保存路径: ${projectDir}/

${fileWriteProtocol}

## 输出
每完成一条输出一行进度；全部完成后继续执行步骤 7（生成文档）
`,
    // 步骤 7: 开发文档
    `# 角色：开发者 - 步骤 7/7：开发文档

## 用户需求
${rawInput}

## 工作目录
- 执行记录: ${wsPath}
- 代码目录: ${projectDir}

## 你的任务
生成开发文档（使用下方“文件落盘协议”输出文件块）：

1. developer/README.md - 项目运行说明（写入 workspace）
2. developer/API.md - 接口文档（写入 workspace；供 Dashboard 预览）
3. developer/dev-summary.md - 开发摘要（写入 workspace）

## ⚠️ 强制要求
- **必须输出文件块（见下方协议），否则不会生成任何文档文件**
- 仅允许输出以上 3 个文件；不要写入 backend/ 或 frontend/，避免与代码落盘混淆

${fileWriteProtocol}

## 输出
完成后列出所有生成的文件
`
  ];

  // 如果指定了 stepIndex，返回对应步骤的 prompt
  if (stepIndex !== null && stepIndex >= 0 && stepIndex < stepPrompts.length) {
    return stepPrompts[stepIndex];
  }

  // 默认返回完整 prompt（步骤 2: 执行任务）
  return stepPrompts[1];
}

/**
 * 生成 Tester Agent 的提示词
 */
function generateTesterPrompt(context) {
  const { rawInput, workspacePath, projectPath, projectId, stepIndex, testEnvironmentUrl } = context;
  const hasEnvironment = !!testEnvironmentUrl;
  const resolvedProjectRoot = projectPath || path.join(PROJECTS, projectId || '');
  const codeDir = path.join(resolvedProjectRoot, 'src');
  
  const stepPrompts = [
    `# 角色：测试工程师 - 步骤 1/4：功能测试用例设计

## 用户需求
${rawInput}

## 代码位置
${codeDir}

## 你的任务
基于 PRD、OpenSpec（tasks.md / design.md）与**已落盘代码**设计功能测试用例。

### 需求一致性（必须）
1. 列出 PRD / 用户故事中的**验收点**（或从 workspace 内产品输出推断）。
2. 对照 \`${codeDir}\` 下**已存在的**实现文件（路径与职责），说明每条验收点是否**已有对应实现线索**；若明显缺失或偏离，记入「一致性缺口」小节。
3. 再设计可执行的测试用例覆盖上述验收点。

## 输出要求
1. **需求与实现一致性摘要**（验收点 ↔ 代码位置/模块）
2. **一致性缺口**（若有）
3. 测试用例列表
4. 测试覆盖范围与测试数据准备

保存到: ${workspacePath}/tester/test-cases.md
`,
    `# 角色：测试工程师 - 步骤 2/4：${hasEnvironment ? '执行功能测试' : '静态代码审查'}

## 用户需求
${rawInput}

## 代码位置
${codeDir}

## 你的任务
${hasEnvironment 
  ? `在测试环境 ${testEnvironmentUrl} 中执行功能测试。

### 执行步骤
1. 使用浏览器工具打开 ${testEnvironmentUrl}
2. 检查页面是否正确加载
3. 测试核心功能（登录、表单提交、按钮点击、导航等）
4. 检查响应式布局
5. 检查控制台错误
6. 记录所有发现的问题

### 要求
- 对每个问题记录：问题描述、复现步骤、严重程度、截图
- 测试所有用户故事中的功能点`
  : `由于无测试环境，进行静态代码审查：
1. 审查代码结构和逻辑
2. 识别潜在的 bug 和代码异味
3. 检查边界条件处理
4. 评估代码可维护性`
}

## 环境状态
${hasEnvironment ? '✅ 测试环境已提供: ' + testEnvironmentUrl : '⚠️ 无测试环境，执行静态代码审查'}

## 输出要求
${hasEnvironment 
  ? '1. 测试执行结果\n2. 通过/失败用例列表\n3. 失败用例的详细描述\n4. 测试截图路径'
  : '1. 代码审查发现的问题列表\n2. 问题严重程度（高/中/低）\n3. 具体代码位置和修复建议'
}

保存到: ${workspacePath}/tester/test-results.md
`,
    `# 角色：测试工程师 - 步骤 3/4：安全漏洞扫描

## 用户需求
${rawInput}

## 代码位置
${codeDir}

## 你的任务
${hasEnvironment 
  ? `在测试环境 ${testEnvironmentUrl} 中执行安全测试。

### 执行步骤
1. 使用浏览器工具打开 ${testEnvironmentUrl}
2. 重点关注：认证、授权、输入验证、XSS、CSRF、SQL注入等安全问题
3. 尝试常见的安全攻击向量（如注入特殊字符、越权访问等）
4. 检查敏感信息泄露
5. 记录所有安全发现

### 要求
- 对每个安全问题记录：问题描述、复现步骤、风险等级`
  : `进行静态安全代码审查：
1. 检查认证和授权实现
2. 检查输入验证和输出编码
3. 检查敏感信息泄露风险
4. 检查依赖安全问题`
}

## 环境状态
${hasEnvironment ? '✅ 测试环境已提供: ' + testEnvironmentUrl : '⚠️ 无测试环境，执行静态安全审查'}

## 输出要求
1. 安全检查项
2. 发现的安全问题
3. 风险等级评估

保存到: ${workspacePath}/tester/security-scan.md
`,
    `# 角色：测试工程师 - 步骤 4/4：生成测试报告

## 用户需求
${rawInput}

## 代码位置
${codeDir}

## 测试环境
${hasEnvironment ? '✅ 已提供: ' + testEnvironmentUrl : '⚠️ 未提供（静态审查模式）'}

## 你的任务
${hasEnvironment 
  ? `执行最终回归验证，然后汇总所有测试结果生成最终测试报告。

### 执行步骤
1. 使用浏览器工具对 ${testEnvironmentUrl} 执行最终回归测试
2. 验证之前发现的问题是否已修复
3. 收集健康评分、截图证据、Bug 列表
4. 整合步骤 1-3 的测试用例、测试结果、安全扫描结果
5. 生成标准化的测试报告`
  : `汇总步骤 1-3 的静态审查结果，生成最终测试报告。`
}

## 输出要求
生成测试报告，包含：
1. 测试摘要（总用例数、通过数、失败数、跳过数）
2. Bug 列表（Bug ID、标题、严重程度、复现步骤）
3. 性能数据（LCP、FID、CLS、加载时间）
4. 安全扫描结果
5. 环境测试状态（运行时测试/静态审查）
6. gstack 健康评分和 ship-readiness 总结（如有）

**摘要口径（必读）**：无浏览器/无真实执行环境时，「失败」指**需求与实现对比下功能未实现或不可验证**，不是自动化脚本执行报错。勿与「全部 E2E 绿灯」混淆；若仅为静态审查，须在摘要中明确标注。

保存到: ${workspacePath}/output/test-report.md
和: ${workspacePath}/output/security-report.md
`
  ];

  // 如果指定了 stepIndex，返回对应步骤的 prompt
  if (stepIndex !== null && stepIndex >= 0 && stepIndex < stepPrompts.length) {
    return stepPrompts[stepIndex];
  }

  // 默认返回完整 prompt（第4步）
  return stepPrompts[3];
}

/**
 * 生成 Ops Agent 的提示词
 */
function generateOpsPrompt(context) {
  const { pipelineId, rawInput, workspacePath, developerOutput, stepIndex, projectPath } = context;
  const codeDir = path.join(projectPath || `projects/${pipelineId}`, 'src');
  
  const stepPrompts = [
    `# 角色：运维工程师 - 步骤 1/4：环境分析

## 用户需求
${rawInput}

## 开发者产出位置
${codeDir}

## 你的任务
1. 理解部署环境需求
2. 阅读开发者产出目录，了解项目结构
3. 确认需要部署的组件（前端、后端、数据库等）
4. 分析环境依赖

## 输出要求
生成环境分析报告，包含：
- 部署组件清单
- 环境依赖列表
- 建议的部署架构

保存到: ${workspacePath}/ops/env-analysis.md
`,
    `# 角色：运维工程师 - 步骤 2/4：Dockerfile 设计

## 用户需求
${rawInput}

## 开发者产出位置
${codeDir}

## 你的任务
1. 为前端项目生成 Dockerfile
2. 为后端项目生成 Dockerfile
3. 优化构建层数和缓存策略
4. 确保多阶段构建减少镜像体积

## 输出要求
生成以下文件：
- Dockerfile (前端，基于 nginx)
- Dockerfile (后端，基于 node:18)
- docker-compose.yml (开发环境)

保存到: ${workspacePath}/ops/
`,
    `# 角色：运维工程师 - 步骤 3/4：CI/CD 配置

## 用户需求
${rawInput}

## 开发者产出位置
${codeDir}

## 你的任务
1. 创建 GitHub Actions 工作流
2. 配置测试、构建、部署流水线
3. 设置环境变量和 secrets 配置
4. 添加自动回滚机制

## 输出要求
生成以下文件：
- .github/workflows/ci.yml (持续集成)
- .github/workflows/deploy.yml (部署流水线)
- .github/workflows/docker.yml (Docker 构建)

保存到: ${workspacePath}/ops/.github/workflows/
`,
    `# 角色：运维工程师 - 步骤 4/4：部署脚本

## 用户需求
${rawInput}

## 开发者产出位置
${codeDir}

## 你的任务
1. 编写部署脚本 (deploy.sh)
2. 准备环境变量模板 (.env.example)
3. 编写部署说明文档
4. 提供健康检查和回滚命令

## 输出要求
生成以下文件：
- deploy.sh (部署脚本，可执行)
- .env.example (环境变量模板)
- DEPLOY.md (部署说明文档)
- ops-config.md (运维配置汇总)

保存到: ${workspacePath}/ops/
`
  ];

  // 如果指定了 stepIndex，返回对应步骤的 prompt
  if (stepIndex !== null && stepIndex >= 0 && stepIndex < stepPrompts.length) {
    return stepPrompts[stepIndex];
  }

  // 默认返回完整 prompt（第4步）
  return stepPrompts[3];
}

/**
 * 执行单个 Agent
 */
async function executeAgent(pipelineId, agentName, context = {}) {
  const startTime = Date.now();
  const info = ROLE_INFO[agentName] || { icon: '🤖', name: agentName };
  const skill = ROLE_SKILLS[agentName];
  
  // 初始化 Socket 连接
  initSocket();
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${info.icon} ${info.name} (${info.name_en})`);
  console.log(`${'='.repeat(60)}`);
  sendProgress(`开始执行 ${info.name}...`);
  
  // 更新阶段状态为运行中
  sendProgress('正在初始化...');
  await axios.put(`${API_BASE}/api/pipelines/${pipelineId}/stage/${agentName}`, {
    status: 'running',
    startedAt: new Date().toISOString()
  }).catch(() => {});
  
  try {
    sendProgress('正在生成任务提示...');
    // 生成提示词
    let prompt;
    switch (agentName) {
      case 'ba':
      case 'product':
        prompt = generateProductPrompt({
          pipelineId,
          rawInput: context.rawInput || context.request?.rawInput || '',
          workspacePath: `workspace/${pipelineId}`
        });
        break;
      case 'architect':
        prompt = await generateArchitectPrompt({
          pipelineId,
          rawInput: context.rawInput || context.request?.rawInput || '',
          workspacePath: `workspace/${pipelineId}`,
          prd: context.prd,
          stepIndex: null
        });
        break;
      case 'developer':
        prompt = generateDeveloperPrompt({
          pipelineId,
          rawInput: context.rawInput || context.request?.rawInput || '',
          workspacePath: `workspace/${pipelineId}`,
          projectPath: context.projectPath,
          codePath: context.codePath,
          openspec: context.openspec,
          openspecChangeDir: context.openspecChangeDir,
          techCoachOutput: context.techCoachOutput
        });
        break;
      case 'tester':
        prompt = generateTesterPrompt({
          pipelineId,
          rawInput: context.rawInput || context.request?.rawInput || '',
          workspacePath: `workspace/${pipelineId}`
        });
        break;
      default:
        prompt = `执行 ${agentName} 任务\n\n用户需求: ${context.rawInput || context.request?.rawInput || ''}`;
    }
    
    console.log(`   📋 Prompt 长度: ${prompt.length} 字符`);
    
    // 执行 OpenCode（带重试机制和模型降级）
    let rawOutput;
    let retryCount = 0;
    let currentModel = AGENT_MODELS[agentName] || 'opencode/big-pickle';
    
    while (retryCount <= MAX_RETRIES) {
      try {
        rawOutput = await runOpenCode(prompt, {
          model: currentModel,
          agentName,
          skillName: skill
        });
        
        // 检查是否包含速率限制错误
        if (rawOutput && (rawOutput.includes('rate increased too quickly') || 
            rawOutput.includes('rate limit') || 
            rawOutput.includes('Request rate increased'))) {
          const fallbackModel = getFallbackModel(currentModel, agentName);
          if (fallbackModel) {
            console.log(`   ⚠️ 检测到速率限制，切换模型: ${currentModel} → ${fallbackModel}`);
            currentModel = fallbackModel;
            continue; // 使用新模型重试
          } else {
            console.log(`   ⚠️ 速率限制，无法降级，继续使用当前输出`);
          }
        }
        break; // 成功，跳出重试循环
      } catch (error) {
        retryCount++;
        if (error.message === 'TIMEOUT_RETRY' && retryCount <= MAX_RETRIES) {
          console.log(`   🔄 超时重试 ${retryCount}/${MAX_RETRIES}...`);
          await new Promise(r => setTimeout(r, 1000)); // 等待1秒后重试
        } else if (retryCount <= MAX_RETRIES) {
          // 尝试模型降级
          const fallbackModel = getFallbackModel(currentModel, agentName);
          if (fallbackModel) {
            console.log(`   ⚠️ 执行失败，切换模型: ${currentModel} → ${fallbackModel}`);
            currentModel = fallbackModel;
          } else {
            throw error; // 无法降级或超出重试次数
          }
        } else {
          throw error; // 其他错误或超出重试次数
        }
      }
    }
    
    const parsed = parseOpenCodeOutput(rawOutput);
    console.log(`   📊 输出长度: ${parsed.text.length} 字符`);
    sendProgress(`AI 响应已接收，正在处理输出...`);
    
    // 保存思考过程
    const thinking = {
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      steps: [
        { prompt: '理解任务', thought: `开始分析 ${info.name} 的任务` },
        { prompt: '生成输出', thought: `已完成 ${info.name} 的输出生成` }
      ]
    };
    
    await saveThinking(pipelineId, agentName, thinking);
    
    // 保存输出
    const outputPath = await saveOutput(pipelineId, agentName, parsed.text);
    
    // 提取开发者输出中的 README 和 API 文档
    let extraOutput = {};
    if (agentName === 'developer') {
      extraOutput = extractDeveloperDocs(parsed.text);
    }
    
    const duration = Date.now() - startTime;
    
    // 更新阶段状态为完成
    await axios.put(`${API_BASE}/api/pipelines/${pipelineId}/stage/${agentName}`, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      duration,
      thinking,
      output: { 
        text: parsed.text.slice(0, 5000), 
        fullText: parsed.text,
        ...extraOutput
      }
    }).catch(() => {});
    
    console.log(`\n✅ ${info.name} 完成 (${(duration / 1000).toFixed(1)}s)`);
    
    return {
      success: true,
      thinking,
      output: parsed.text,
      outputPath,
      duration
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`\n❌ ${info.name} 失败: ${error.message}`);
    
    // 更新阶段状态为失败
    await axios.put(`${API_BASE}/api/pipelines/${pipelineId}/stage/${agentName}`, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      duration,
      error: error.message
    }).catch(() => {});
    
    return {
      success: false,
      error: error.message,
      duration
    };
  }
}

/**
 * 查找 OpenSpec change 目录（供 Developer 读取 tasks.md）
 * 1) 优先 workspace/.devforge/openspec-b.json（OpenSpec 形态 B 写入的 changeDir）
 * 2) 否则 openspec/changes 下子目录按名字排序后取第一个（确定性）
 */
async function findOpenSpecChangeDir(projectPath, workspacePath) {
  if (workspacePath) {
    try {
      const metaPath = path.join(workspacePath, '.devforge', 'openspec-b.json');
      const raw = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(raw);
      if (meta.changeDir && typeof meta.changeDir === 'string') {
        const dir = path.resolve(meta.changeDir);
        try {
          // 仅当 meta.changeDir 真的像一个 OpenSpec change 目录才使用
          // 避免 meta 指向存在但不包含 tasks.md 的路径，导致 Developer 无法定位任务清单
          await fs.access(dir);
          await fs.access(path.join(dir, 'tasks.md'));
          return dir;
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      /* no meta */
    }
  }
  const changesDir = path.join(projectPath, 'openspec', 'changes');
  try {
    // 排除 archive 等非 change 目录；优先选择“像一个完整 change”的目录
    // 规则：
    // - 强优先：名字以 sprint- 开头（更符合用户手工创建的 change）
    // - 必须存在 tasks/design/proposal（至少 tasks + design，且 tasks 非空）
    // - 次优先：mtime 更新（更符合最近生成）
    const names = (await fs.readdir(changesDir)).filter((n) => !n.startsWith('.') && n !== 'archive');
    const candidates = [];
    for (const name of names) {
      const p = path.join(changesDir, name);
      try {
        const st = await fs.stat(p);
        if (!st.isDirectory()) continue;
        const tasksPath = path.join(p, 'tasks.md');
        const designPath = path.join(p, 'design.md');
        const proposalPath = path.join(p, 'proposal.md');
        let score = 0;
        if (name.startsWith('sprint-')) score += 10;
        let tasksOk = false;
        try {
          const ts = await fs.stat(tasksPath);
          if (ts.isFile() && ts.size > 200) {
            tasksOk = true;
            score += 5;
          }
        } catch {}
        try {
          const ds = await fs.stat(designPath);
          if (ds.isFile() && ds.size > 200) score += 2;
        } catch {}
        try {
          const ps = await fs.stat(proposalPath);
          if (ps.isFile() && ps.size > 200) score += 1;
        } catch {}

        // 没有 tasks 的直接淘汰：Developer 无法推进
        if (!tasksOk) continue;

        candidates.push({ name, path: p, score, mtimeMs: st.mtimeMs });
      } catch {
        /* ignore */
      }
    }
    candidates.sort((a, b) => (b.score - a.score) || (b.mtimeMs - a.mtimeMs));
    if (candidates.length > 0) return candidates[0].path;
  } catch (e) {}
  return null;
}

async function resolveOpenSpecChangeDirStrict({ projectPath, workspacePath, preferredChangeDir }) {
  if (preferredChangeDir) {
    const dir = path.resolve(preferredChangeDir);
    try {
      await fs.access(path.join(dir, 'tasks.md'));
      return dir;
    } catch {}
  }
  const dir = await findOpenSpecChangeDir(projectPath, workspacePath);
  if (!dir) return null;
  // Double-check tasks.md exists; if not, treat as unresolved
  try {
    await fs.access(path.join(dir, 'tasks.md'));
    return dir;
  } catch {
    return null;
  }
}

/** 解析 OpenSpec 下 tasks/design/proposal 的绝对路径 */
function resolveOpenSpecArtifactPaths(projectPath, openspecChangeDir) {
  const changesBaseDir = path.join(projectPath, 'openspec', 'changes');
  if (openspecChangeDir) {
    return {
      changeDir: openspecChangeDir,
      changesBaseDir,
      tasksPath: path.join(openspecChangeDir, 'tasks.md'),
      designPath: path.join(openspecChangeDir, 'design.md'),
      proposalPath: path.join(openspecChangeDir, 'proposal.md')
    };
  }
  return {
    changeDir: null,
    changesBaseDir,
    tasksPath: null,
    designPath: null,
    proposalPath: null
  };
}

/** OpenSpec change 目录名（仅字母数字与连字符） */
function sanitizeOpenSpecChangeName(sprintId) {
  return `df-${String(sprintId).replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 48)}`.slice(0, 64);
}

/**
 * 架构师第 5 步 — OpenSpec 形态 B：脚本 bootstrap + 三段短 LLM + openspec validate
 */
async function runArchitectOpenSpecPipelineB(ctx) {
  const {
    sprintId,
    workspacePath,
    projectPath,
    rawInput,
    prd,
    model,
    phaseTimeoutMs = DEFAULT_ARCHITECT_OPENSPEC_PHASE_MS
  } = ctx;

  const changeName = sanitizeOpenSpecChangeName(sprintId);
  const description = String(rawInput || 'sprint').slice(0, 240).replace(/\s+/g, ' ').trim() || 'DevForge sprint';
  const bootstrapScript = path.join(ROOT, 'scripts', 'openspec-bootstrap.mjs');

  console.log(`   🔧 OpenSpec 形态 B: bootstrap change "${changeName}"`);
  const boot = spawnSync(process.execPath, [bootstrapScript, projectPath, changeName, description], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    cwd: ROOT
  });
  if (boot.status !== 0) {
    throw new Error(`openspec-bootstrap 失败: ${boot.stderr || boot.stdout || boot.status}`);
  }
  const bootLines = (boot.stdout || '').trim().split('\n').filter(Boolean);
  const meta = JSON.parse(bootLines[bootLines.length - 1]);
  const changeDir = meta.changeDir;

  const stateDir = path.join(workspacePath, '.devforge');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(stateDir, 'openspec-b.json'),
    JSON.stringify(
      {
        phase: 'bootstrapped',
        changeName,
        changeDir,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf-8'
  );

  const prdBrief = String(prd || '').slice(0, 4000);
  const proposalPath = path.join(changeDir, 'proposal.md');
  const designPath = path.join(changeDir, 'design.md');
  const tasksPath = path.join(changeDir, 'tasks.md');

  // 幂等：如果 change 已存在且关键 artifacts 已生成，则跳过 LLM 生成与 validate（用于“重跑改为成功/跳过重复创建”）
  async function fileNonEmpty(p) {
    try {
      const st = await fs.stat(p);
      return st.isFile() && st.size > 32;
    } catch (_e) {
      return false;
    }
  }
  const hasProposal = await fileNonEmpty(proposalPath);
  const hasDesign = await fileNonEmpty(designPath);
  const hasTasks = await fileNonEmpty(tasksPath);
  if (hasProposal && hasDesign && hasTasks) {
    await fs.writeFile(
      path.join(stateDir, 'openspec-b.json'),
      JSON.stringify(
        {
          phase: 'skipped_existing',
          changeName,
          changeDir,
          skipped: true,
          updatedAt: new Date().toISOString()
        },
        null,
        2
      ),
      'utf-8'
    );
    return `# OpenSpec 形态 B 执行摘要（跳过）\n\n检测到 change 已存在且 artifacts 已生成，跳过重复生成与 validate。\n\n- proposal.md: ${proposalPath}\n- design.md: ${designPath}\n- tasks.md: ${tasksPath}\n\nChange 目录: ${changeDir}\n`;
  }

  const archList = [
    path.join(workspacePath, 'architect/architecture.md'),
    path.join(workspacePath, 'architect/api-design.md'),
    path.join(workspacePath, 'architect/database.md'),
    path.join(workspacePath, 'architect/data-flow.md')
  ];

  const promptProposal = `# 架构师 — OpenSpec 阶段 1/3：proposal.md

Change 目录: ${changeDir}
**必须**使用 Write 将 **proposal.md** 写入完整路径:
${proposalPath}

## 需求来源（请用 Read 读取磁盘文件）
- ${workspacePath}/product/prd.md（或 product 目录下 PRD 相关文件）
- ${workspacePath}/tech-coach/tech-implementation.md
- ${workspacePath}/output/tech-feasibility.md（若存在）
- ${workspacePath}/architect/architecture.md

## 原始需求摘要
${String(rawInput || '').slice(0, 4000)}

## 产品迭代输出摘要（截断）
${prdBrief}

只写 proposal.md，不要写 design.md / tasks.md，不要执行 openspec init 或 openspec new（目录已创建）。
`;

  const promptDesign = `# 架构师 — OpenSpec 阶段 2/3：design.md

**必须**将 **design.md** 写入: ${designPath}

请先 Read: ${proposalPath}
再 Read 以下架构文件（路径）:
${archList.map((p) => `- ${p}`).join('\n')}

整合系统架构、API、数据库与数据流，产出 design.md。不要跳过 Read。
`;

  const promptTasks = `# 架构师 — OpenSpec 阶段 3/3：tasks.md

**必须**将 **tasks.md** 写入: ${tasksPath}

请先 Read: ${designPath}
将实现拆为可执行任务清单，供 Developer 按顺序执行。
`;

  async function runPhasePrompt(phaseLabel, promptText) {
    let timeoutMs = phaseTimeoutMs;
    for (let attempt = 0; attempt < 2; attempt++) {
      let currentModel = model;
      let lastErr;
      for (let m = 0; m < 3; m++) {
        try {
          console.log(`   🔷 OpenSpec B: ${phaseLabel} (${timeoutMs}ms, ${currentModel})`);
          sendProgress(`OpenSpec ${phaseLabel}…`);
          const raw = await runOpenCode(promptText, {
            model: currentModel,
            agentName: 'architect',
            skillName: null,
            usePure: true,
            timeoutMs,
            retryCount: 2
          });
          const parsed = parseOpenCodeOutput(raw);
          return parsed.text || raw;
        } catch (e) {
          lastErr = e;
          const fb = MODEL_FALLBACKS[currentModel];
          if (fb && m < 2) {
            console.log(`   ⚠️ ${phaseLabel} 切换模型: ${currentModel} → ${fb}`);
            currentModel = fb;
            continue;
          }
          break;
        }
      }
      if (lastErr && attempt === 0 && String(lastErr.message || '').includes('超时')) {
        timeoutMs *= 2;
        console.log(`   ⏱ ${phaseLabel} 超时，加倍至 ${timeoutMs}ms 重试`);
        continue;
      }
      throw lastErr;
    }
    throw new Error(`${phaseLabel} 失败`);
  }

  const outProposal = await runPhasePrompt('proposal.md', promptProposal);
  const outDesign = await runPhasePrompt('design.md', promptDesign);
  const outTasks = await runPhasePrompt('tasks.md', promptTasks);

  const vr = spawnSync('openspec', ['validate', changeName], {
    cwd: projectPath,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  const validateBlock = `exit=${vr.status}\n${vr.stdout || ''}\n${vr.stderr || ''}`;

  await fs.writeFile(
    path.join(stateDir, 'openspec-b.json'),
    JSON.stringify(
      {
        phase: 'validated',
        changeName,
        changeDir,
        validateExit: vr.status,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf-8'
  );

  return `# OpenSpec 形态 B 执行摘要

## proposal.md（模型输出摘要）
${String(outProposal).slice(0, 20000)}

---

## design.md（模型输出摘要）
${String(outDesign).slice(0, 20000)}

---

## tasks.md（模型输出摘要）
${String(outTasks).slice(0, 20000)}

---

## openspec validate
\`\`\`
${validateBlock.slice(0, 8000)}
\`\`\`

Change 目录: ${changeDir}
`;
}

/**
 * 执行 Sprint 迭代
 */
// 定义每个角色的步骤数
const ROLE_STEPS = {
  product: 5,
  architect: 5,
  tech_coach: 2,   // 步骤1: 信息收集(product/) + 步骤2: 技术实现
  developer: 7,   // 步骤1: 范围确认 + 步骤2-6: tasks执行 + 步骤7: 开发文档
  tester: 4,
  ops: 4,
  ghost: 2,
  creative: 2,
  evolver: 2
};

async function runIteration(
  sprintId,
  roleIndex,
  customModel = null,
  startStep = null,
  options = {}
) {
  const { replaceStepOutput = false } = options;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 AI Agent Executor - Sprint: ${sprintId.slice(0, 8)}, Role: ${roleIndex}`);
  console.log(`${'='.repeat(60)}`);
  
  // 获取 Sprint 状态
  const { data: sprint } = await axios.get(`${API_BASE}/api/sprints/${sprintId}`);
  
  if (!sprint) {
    console.error('❌ Sprint 不存在');
    return;
  }

  console.log(`📝 需求: ${sprint.rawInput}`);
  console.log(`📋 角色: ${sprint.iterations[roleIndex]?.role}`);
  
  // 收集上下文（用于传递给后续 Agent）
  // 新格式 sprintId = {projectId}-{uuid}，尝试从 sprintId 提取 projectId
  let projectId = sprint.projectId;
  if (!projectId && sprintId.includes('-')) {
    // 尝试从 sprintId 前半部分提取 projectId (UUID 格式)
    const parts = sprintId.split('-');
    if (parts.length >= 5) {
      projectId = parts.slice(0, 5).join('-');
    }
  }
  projectId = projectId || sprintId; // fallback

  const context = {
    sprintId,
    projectId,
    roleIndex,
    rawInput: sprint.rawInput,
    localProjectPath: sprint.localProjectPath || null,
    prdOutput: null,
    openspec: null,
    openspecChangeDir: null,
    developerOutput: null,
    codePaths: null,
    previousOutput: null,
    workspacePath: path.join(ROOT, 'workspace', sprintId),
    projectPath: path.join(ROOT, 'projects', projectId),
    // codePath：真正落盘的代码目录
    // - 若用户在创建 Sprint 时提供 localProjectPath，则优先写入该本地项目根（期望其下有 backend/、frontend/）
    // - 否则写入 DevForge 项目目录下的 src/
    codePath: sprint.localProjectPath
      ? sprint.localProjectPath
      : path.join(ROOT, 'projects', projectId, 'src'),
    openspecPath: path.join(ROOT, 'projects', projectId, 'openspec')
  };

  _projectCodegenCache = null;
  _projectCodegenCacheRoot = null;

  console.log(
    `   📁 Code paths: localProjectPath=${context.localProjectPath || 'null'} | codePath=${context.codePath} | projectPath=${context.projectPath}`
  );

  // 获取 workspace 路径
  const workspacePath = context.workspacePath;
  
  // 加载前面角色的输出
  for (let i = 0; i < roleIndex; i++) {
    const prevIteration = sprint.iterations[i];
    if (prevIteration?.output) {
      if (prevIteration.role === 'product') {
        context.prdOutput = prevIteration.output;
      } else if (prevIteration.role === 'tech_coach') {
        context.techCoachOutput = prevIteration.output;
      } else if (prevIteration.role === 'architect') {
        context.openspec = prevIteration.output;
        // 扫描 OpenSpec change 目录
        context.openspecChangeDir = await findOpenSpecChangeDir(
          context.projectPath,
          context.workspacePath
        );
      } else if (prevIteration.role === 'developer') {
        context.developerOutput = prevIteration.output;
      }
      context.previousOutput = prevIteration.output;
    }
  }

  const iteration = sprint.iterations[roleIndex];
  const role = iteration?.role;

  const scenario = sprint.scenario || 'BUILD';
  let roleStepCount = ROLE_STEPS[role] || 1;
  if (scenario === 'QUERY' && role === 'tech_coach') {
    roleStepCount = 1;
  }

  // 收集测试环境信息（如果是 tester 角色）
  if (role === 'tester') {
    context.testEnvironmentUrl = iteration?.testEnvironmentUrl || null;
  }
  
  // 获取当前步骤索引 - 处理 NaN 情况
  // 如果没有指定 startStep，默认从第 0 步开始执行所有步骤
  let stepIdx = 0;
  if (startStep !== undefined && startStep !== null) {
    const parsed = parseInt(startStep);
    stepIdx = isNaN(parsed) ? 0 : parsed;
  }
  console.log(`   📊 startStep: ${startStep}, parsed: ${stepIdx}, role: ${role}`);
  
  // 收集所有执行过的步骤（用于执行记录）
  const allSteps = [];
  for (let i = 0; i <= (stepIdx !== null ? stepIdx : roleStepCount - 1); i++) {
    const stepName = getStepGuidance(role, i)?.split('\n')[0] || `步骤 ${i + 1}`;
    allSteps.push({ id: i + 1, name: stepName });
  }
  
  if (!role) {
    console.error('❌ 角色不存在');
    return;
  }

  const useOpenSpecPipelineB =
    role === 'architect' && stepIdx === 4 && useArchitectOpenSpecPipelineB();

  const info = ROLE_INFO[role] || { icon: '🤖', name: role };
  console.log(`\n${info.icon} ${info.name}`);
  console.log(`   状态: ${iteration?.status}`);
  if (useOpenSpecPipelineB) {
    console.log('   🔷 架构师第 5 步：OpenSpec 形态 B（bootstrap + 三阶段 LLM + validate）');
  }
  if (replaceStepOutput && roleStepCount > 1) {
    console.log('   📌 分步重跑：仅覆盖本节输出（按 --- 分节），不追加到末尾');
  }

  // 生成 Prompt
  let prompt;
  if (useOpenSpecPipelineB) {
    prompt =
      '（OpenSpec 形态 B：分 proposal / design / tasks 三阶段 + 脚本 validate，见控制台与输出摘要）';
  } else {
    switch (role) {
    case 'product':
      prompt = generateProductPrompt({
        sprintId,
        rawInput: context.rawInput,
        workspacePath,
        stepIndex: stepIdx
      });
      break;
    case 'architect':
      prompt = await generateArchitectPrompt({
        pipelineId: sprintId,
        sprintId,
        rawInput: context.rawInput,
        workspacePath,
        prd: context.prdOutput,
        stepIndex: stepIdx,
        techCoachOutput: context.techCoachOutput,
        projectPath: context.projectPath,
        codePath: context.codePath
      });
      break;
    case 'tech_coach':
      prompt = generateTechCoachPrompt({
        sprintId,
        rawInput: context.rawInput,
        workspacePath,
        prdOutput: context.prdOutput,
        openspec: context.openspec,
        openspecChangeDir: context.openspecChangeDir
      });
      break;
    case 'developer':
      prompt = generateDeveloperPrompt({
        pipelineId: sprintId,
        sprintId,
        rawInput: context.rawInput,
        workspacePath,
        projectPath: context.projectPath,
        codePath: context.codePath,
        openspec: context.openspec,
        openspecChangeDir: context.openspecChangeDir,
        techCoachOutput: context.techCoachOutput,
        stepIndex: stepIdx
      });
      break;
    case 'tester':
      prompt = generateTesterPrompt({
        sprintId,
        projectId: context.projectId,
        projectPath: context.projectPath,
        rawInput: context.rawInput,
        workspacePath,
        prdOutput: context.prdOutput,
        openspec: context.openspec,
        developerOutput: context.developerOutput,
        codePaths: context.codePaths,
        testEnvironmentUrl: context.testEnvironmentUrl
      });
      break;
    case 'ops':
      prompt = generateOpsPrompt({
        sprintId,
        rawInput: context.rawInput,
        workspacePath,
        developerOutput: context.developerOutput,
        stepIndex: stepIdx
      });
      break;
    default:
      prompt = `执行 ${info.name} 任务\n\n用户需求: ${context.rawInput}`;
    }
  }

  // 如果指定了 stepIndex，添加步骤指示
  console.log(`   📊 startStep: ${startStep}, parsed: ${stepIdx}, role: ${role}`);
  if (stepIdx !== null && !useOpenSpecPipelineB) {
    const stepGuidance = getStepGuidance(role, stepIdx);
    prompt = `${prompt}\n\n## 当前执行步骤\n${stepGuidance}`;
    console.log(`   📝 步骤指示: ${stepGuidance ? stepGuidance.split('\n')[0] : '无'}`);
  } else if (stepIdx !== null && useOpenSpecPipelineB) {
    console.log('   📝 步骤指示: OpenSpec 形态 B（内部三阶段）');
  } else {
    console.log(`   📝 步骤指示: 未指定步骤`);
  }
    
   console.log(`   📋 Prompt 长度: ${prompt.length} 字符`);
   
   // 更新状态为运行中（仅在第一步设置，后续步骤不覆盖输出）
   if (stepIdx === 0 || stepIdx === null) {
     await axios.put(`${API_BASE}/api/sprints/${sprintId}/iterations/${roleIndex}/output`, {
       output: '正在执行...',
       status: 'running'
     });
   }
  
  try {
    // 根据角色和步骤确定需要加载的 skill
    const stepSkills = ROLE_STEP_SKILLS[role];
    const currentSkill = (stepIdx !== null && stepSkills && stepSkills[stepIdx]) || null;
    if (currentSkill) {
      console.log(`   📦 步骤 ${stepIdx + 1} 使用 Skill: ${currentSkill}`);
    } else if (stepIdx !== null) {
      console.log(`   📦 步骤 ${stepIdx + 1} 不需要 Skill`);
    }

    const hasTestEnv = role === 'tester' && context.testEnvironmentUrl;

    let rawOutput;
    let rateLimitRetryCount = 0;
    const maxRateLimitRetries = 2;
    const developerBackend = process.env.DEVFORGE_DEVELOPER_BACKEND || 'opencode';

    if (useOpenSpecPipelineB) {
      const model = customModel || process.env.AGENT_MODEL || AGENT_MODELS[role] || 'opencode/big-pickle';
      console.log(`   🎯 使用模型: ${model}`);
      const currentModel = model;
      rawOutput = await runArchitectOpenSpecPipelineB({
        sprintId,
        workspacePath,
        projectPath: context.projectPath,
        rawInput: context.rawInput,
        prd: context.prdOutput,
        model: currentModel,
        phaseTimeoutMs: DEFAULT_ARCHITECT_OPENSPEC_PHASE_MS
      });
    } else if (role === 'developer' && developerBackend === 'cursor_auto') {
      console.log(`   🎯 代码生成后端: Cursor CLI`);
      let promptForCursor = prompt;
      if (currentSkill) {
        const skillContent = await loadSkill(currentSkill);
        if (skillContent) {
          if (skillContent.length > MAX_SKILL_INJECT_SIZE) {
            console.log(`   ⏭️ Skill ${currentSkill} 过大 (${(skillContent.length / 1024).toFixed(1)}KB)，跳过注入`);
          } else {
            promptForCursor = `## Skill 参考: ${currentSkill}\n\n${skillContent}\n\n---\n\n${prompt}`;
          }
        }
      }
      if (stepIdx === 0) {
        await ensureDevForgeCursorProjectFiles({
          // Cursor 需要在“实际代码目录”下运行，才能把生成的代码落到本地项目
          projectPath: context.codePath,
          openspecChangeDir: context.openspecChangeDir,
          sprintId
        });
      }
      console.log(`   🧭 Cursor CLI cwd=${context.codePath} (will parse file blocks for disk write)`);
      rawOutput = await runCursorAgent(promptForCursor, {
        // 使用 codePath 作为 cwd，确保写入的是本地 project（而不是 DevForge projects/<id>）
        cwd: context.codePath,
        agentName: role,
        timeoutMs: TIMEOUT_CONFIG[role]
      });
    } else {
      const model = customModel || process.env.AGENT_MODEL || AGENT_MODELS[role] || 'opencode/big-pickle';
      console.log(`   🎯 使用模型: ${model}`);
      let currentModel = model;
      while (rateLimitRetryCount <= maxRateLimitRetries) {
        try {
          // Developer: opencode 后端时，按 tasks.md 每条 checkbox 逐条执行，打印每条 task 的 start/end
          if (role === 'developer' && developerBackend === 'opencode' && stepIdx !== null && stepIdx >= 1 && stepIdx <= 5) {
            const changeDir = await resolveOpenSpecChangeDirStrict({
              projectPath: context.projectPath,
              workspacePath: context.workspacePath,
              preferredChangeDir: context.openspecChangeDir
            });
            const art = resolveOpenSpecArtifactPaths(context.projectPath, changeDir);
            const tasksPath = art.tasksPath;
            if (!tasksPath) {
              throw new Error(`未定位到 tasks.md。请确认 OpenSpec change 目录存在：${context.projectPath}/openspec/changes/*/tasks.md`);
            }
            rawOutput = await runDeveloperPerTaskBatch({
              sprintId,
              roleIndex,
              model: currentModel,
              projectDir: context.codePath,
              tasksPath,
              workspacePath: context.workspacePath,
              promptBase: {
                stepIdx,
                fileWriteProtocol: `## 文件落盘协议（必须严格遵守）\n输出一个或多个文件块，格式：\n\n\`\`\`file:backend/README.md\n...\n\`\`\`\n\n规则：\n- 路径必须相对 ${context.codePath}\n- 只允许 backend/ 或 frontend/\n- 每个文件块是完整文件内容（非 diff）\n`
              }
            });
          } else {
            rawOutput = await runOpenCode(prompt, {
              model: currentModel,
              agentName: role,
              skillName: currentSkill,
              usePure: role !== 'tester' || !hasTestEnv,
              qaInstruction: role === 'tester' && hasTestEnv ? QA_INSTRUCTION : null
            });
          }

          if (
            rawOutput &&
            (rawOutput.includes('rate increased too quickly') ||
              rawOutput.includes('rate limit') ||
              rawOutput.includes('Request rate increased'))
          ) {
            const fallbackModel = getFallbackModel(currentModel, role);
            if (fallbackModel && rateLimitRetryCount < maxRateLimitRetries) {
              console.log(`   ⚠️ 检测到速率限制，切换模型: ${currentModel} → ${fallbackModel}`);
              currentModel = fallbackModel;
              rateLimitRetryCount++;
              continue;
            }
          }
          break;
        } catch (error) {
          const fallbackModel = getFallbackModel(currentModel, role);
          if (fallbackModel && rateLimitRetryCount < maxRateLimitRetries) {
            console.log(`   ⚠️ 执行失败，切换模型: ${currentModel} → ${fallbackModel}`);
            currentModel = fallbackModel;
            rateLimitRetryCount++;
            continue;
          }
          throw error;
        }
      }
    }
    
    console.log(`   ✅ 执行完成，输出长度: ${rawOutput.length} 字符`);
    
    // 解析输出 - 从 opencode JSON 流中提取文本
    const parsed = parseOpenCodeOutput(rawOutput);
    let output = parsed.text || rawOutput;

    // Developer 在 opencode 后端时：从输出中提取文件块并写入磁盘
    // （opencode 本身不会执行“写文件工具”，因此必须由执行器落盘）
    if (role === 'developer' && developerBackend === 'opencode') {
      const blocks = extractFileBlocks(output);
      if (blocks.length > 0) {
        // 步骤 7：仅允许写入 developer/README.md, developer/API.md, developer/dev-summary.md 到 workspace
        if (stepIdx === 6) {
          const res = await writeDeveloperDocsFromBlocks({
            sprintId,
            workspacePath,
            outputText: output
          });
          output =
            res.reason === 'OK'
              ? `已从模型输出解析并写入 ${res.written.length} 个开发文档文件（workspace 落盘）:\n` +
                res.written.map((w) => `- workspace/${sprintId}/${w.relPath} (${w.bytes} bytes)`).join('\n')
              : `${output}\n\n---\n\n⚠️ 未写入开发文档（reason=${res.reason}）。请按协议输出 \`\`\`file:developer/...\`\`\` 文件块。`;
        } else {
          const written = await writeFileBlocks({ projectDir: context.codePath, blocks });
          const summaryLines = [
            `已从模型输出解析并写入 ${written.length} 个文件（opencode 落盘模式）:`,
            ...written.slice(0, 60).map((w) => `- ${w.path} (${w.bytes} bytes)`)
          ];
          if (written.length > 60) summaryLines.push(`- ...（其余 ${written.length - 60} 个文件已省略）`);
          output = `${summaryLines.join('\n')}\n\n---\n\n（原始输出已省略；如需保留可在执行器中改为写入 execution-log）`;
        }
      } else {
        // 没有文件块：保持原输出，方便观察模型是否遵守协议
        output = `${output}\n\n---\n\n⚠️ 未检测到任何 \`\`\`file:<path>\n...\n\`\`\` 文件块，因此没有写入任何代码文件。`;
      }
    }

    // Developer 在 cursor_auto 后端时：同样支持“文件块落盘”
    // 说明：Cursor CLI 的 `agent chat --print` 只会打印结果，不会自动改写工作区文件；
    // 因此我们与 opencode 一致，要求模型输出 ```file:...``` 并由执行器写入磁盘。
    if (role === 'developer' && developerBackend === 'cursor_auto') {
      const blocks = extractFileBlocks(output);
      console.log(`   🧾 cursor_auto fileBlocks parsed: count=${blocks.length}`);
      if (blocks.length > 0) {
        if (stepIdx === 6) {
          const res = await writeDeveloperDocsFromBlocks({
            sprintId,
            workspacePath,
            outputText: output
          });
          output =
            res.reason === 'OK'
              ? `已从模型输出解析并写入 ${res.written.length} 个开发文档文件（workspace 落盘）:\n` +
                res.written.map((w) => `- workspace/${sprintId}/${w.relPath} (${w.bytes} bytes)`).join('\n')
              : `${output}\n\n---\n\n⚠️ 未写入开发文档（reason=${res.reason}）。请按协议输出 \`\`\`file:developer/...\`\`\` 文件块。`;
        } else {
          const written = await writeFileBlocks({ projectDir: context.codePath, blocks });
          const summaryLines = [
            `已从模型输出解析并写入 ${written.length} 个文件（cursor_auto 落盘模式）:`,
            ...written.slice(0, 60).map((w) => `- ${w.path} (${w.bytes} bytes)`)
          ];
          if (written.length > 60) summaryLines.push(`- ...（其余 ${written.length - 60} 个文件已省略）`);
          output = `${summaryLines.join('\n')}\n\n---\n\n（原始输出已省略；如需保留可在执行器中改为写入 execution-log）`;
        }
      } else {
        output = `${output}\n\n---\n\n⚠️ 未检测到任何 \`\`\`file:<path>\n...\n\`\`\` 文件块，因此没有写入任何代码文件。`;
      }
    }

    // 架构师步骤 1～4：将本步正文落盘到 workspace/<sprintId>/architect/*.md（与 Dashboard 文件预览、generateArchitectPrompt 读盘路径一致）
    if (role === 'architect' && stepIdx !== null && stepIdx >= 0 && stepIdx <= 3) {
      const archStepFiles = [
        'architecture.md',
        'api-design.md',
        'database.md',
        'data-flow.md'
      ];
      const fileName = archStepFiles[stepIdx];
      if (fileName) {
        try {
          const archDir = path.join(workspacePath, 'architect');
          await fs.mkdir(archDir, { recursive: true });
          const target = path.join(archDir, fileName);
          await fs.writeFile(target, output, 'utf-8');
          console.log(
            `   📄 已写入架构文档: workspace/${sprintId}/architect/${fileName} (${output.length} 字符)`
          );
        } catch (e) {
          console.warn(`   ⚠️ 写入架构文档失败: ${e.message}`);
        }
      }
    }

    // 测试工程师步骤 1～4：落盘到 workspace/<sprintId>/tester/*.md 与 output/*.md（与 Dashboard「输出文件（预期）」、文件预览 API 一致）
    if (role === 'tester' && stepIdx !== null && stepIdx >= 0 && stepIdx <= 3) {
      try {
        const testerDir = path.join(workspacePath, 'tester');
        const outputDir = path.join(workspacePath, 'output');
        await fs.mkdir(testerDir, { recursive: true });
        await fs.mkdir(outputDir, { recursive: true });
        if (stepIdx === 0) {
          await fs.writeFile(path.join(testerDir, 'test-cases.md'), output, 'utf-8');
          console.log(`   📄 已写入: workspace/${sprintId}/tester/test-cases.md`);
        } else if (stepIdx === 1) {
          await fs.writeFile(path.join(testerDir, 'test-results.md'), output, 'utf-8');
          console.log(`   📄 已写入: workspace/${sprintId}/tester/test-results.md`);
        } else if (stepIdx === 2) {
          await fs.writeFile(path.join(testerDir, 'security-scan.md'), output, 'utf-8');
          await fs.writeFile(path.join(testerDir, 'security-report.md'), output, 'utf-8');
          console.log(
            `   📄 已写入: workspace/${sprintId}/tester/security-scan.md 与 security-report.md`
          );
        } else if (stepIdx === 3) {
          await fs.writeFile(path.join(outputDir, 'test-report.md'), output, 'utf-8');
          await fs.writeFile(path.join(testerDir, 'test-report.md'), output, 'utf-8');
          await fs.writeFile(path.join(outputDir, 'security-report.md'), output, 'utf-8');
          await fs.writeFile(path.join(testerDir, 'security-report.md'), output, 'utf-8');
          console.log(
            `   📄 已写入: workspace/${sprintId}/output/test-report.md、tester/test-report.md 及 security-report（output + tester）`
          );
        }
      } catch (e) {
        console.warn(`   ⚠️ 写入测试文档失败: ${e.message}`);
      }
    }
    
    // 确保输出不为空
    if (!output || output.trim() === '') {
      output = `${role} 执行完成，但未生成有效输出`;
    }
    
    // 保存输出（多步骤角色：链式追加；显式 stepIndex 重跑时仅覆盖对应节）
    const stepCount = roleStepCount;
    if (stepCount > 1 && stepIdx !== null) {
      const isLastStep = stepIdx + 1 >= stepCount;
      const stepStatus = isLastStep ? 'completed' : 'running';
      try {
        const { data: sprintData } = await axios.get(`${API_BASE}/api/sprints/${sprintId}`);
        const existingOutput = sprintData?.iterations?.[roleIndex]?.output || '';
        const combined = mergeMultiStepOutput(
          existingOutput,
          output,
          stepIdx,
          stepCount,
          replaceStepOutput
        );
        await axios.put(`${API_BASE}/api/sprints/${sprintId}/iterations/${roleIndex}/output`, {
          output: combined,
          status: stepStatus
        });
      } catch (e) {
        await axios.put(`${API_BASE}/api/sprints/${sprintId}/iterations/${roleIndex}/output`, {
          output,
          status: stepStatus
        });
      }
    } else {
      await axios.put(`${API_BASE}/api/sprints/${sprintId}/iterations/${roleIndex}/output`, {
        output,
        status: 'completed'
      });
    }
    
    console.log(`   ✅ 输出已保存`);
    
    // 检查是否需要继续执行后续步骤
    const totalSteps = roleStepCount;
    const currentStep = stepIdx !== null ? stepIdx + 1 : totalSteps;
    
    // 当 stepIdx 为 null 时，从第 0 步开始执行所有步骤
    const startIdx = stepIdx !== null ? stepIdx : 0;
    
    if (currentStep < totalSteps) {
      const skipDeveloperChain =
        role === 'developer' &&
        parseBoolEnv('DEVFORGE_DEVELOPER_SINGLE_TASK', false) &&
        !parseBoolEnv('DEVFORGE_DEVELOPER_SINGLE_TASK_CHAIN', false);
      if (skipDeveloperChain) {
        console.log(`\n   📌 单任务模式（DEVFORGE_DEVELOPER_SINGLE_TASK）：不链式执行后续 ${role} 步骤`);
        try {
          const { data: sprintData } = await axios.get(`${API_BASE}/api/sprints/${sprintId}`);
          const out = sprintData?.iterations?.[roleIndex]?.output || '';
          await axios.put(`${API_BASE}/api/sprints/${sprintId}/iterations/${roleIndex}/output`, {
            output: out || output,
            status: 'completed'
          });
        } catch (e) {
          console.warn(`   ⚠️ 单任务模式收尾 completed 状态失败: ${e?.message || e}`);
        }
      } else {
        // 继续执行下一步骤
        console.log(`\n   🔄 步骤 ${currentStep + 1}/${totalSteps} 准备中...`);

        // 等待 2 秒后继续执行下一步
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // 递归执行下一步骤（链式始终追加，不按节覆盖）
        return await runIteration(sprintId, roleIndex, customModel, currentStep, {
          replaceStepOutput: false
        });
      }
    }
    
    console.log(`\n   ✅ 所有步骤执行完成 (共 ${totalSteps} 步骤)`);
    
    // 多步骤已在上面分步合并写入；勿用最后一步输出覆盖整段
    if (totalSteps <= 1) {
      await axios.put(`${API_BASE}/api/sprints/${sprintId}/iterations/${roleIndex}/output`, {
        output: output || `${role} 执行完成`,
        status: 'completed'
      });
    }
    
    // 保存执行记录
    await saveExecutionLog(sprintId, role, {
      roleIndex,
      startedAt: iteration?.startedAt || new Date().toISOString(),
      steps: allSteps,
      rawInput: context.rawInput,
      testEnvironmentUrl: context.testEnvironmentUrl,
      output: output
    });
    
    return { success: true, output };
  } catch (error) {
    console.error(`   ❌ 执行失败:`, error.message);
    await axios.put(`${API_BASE}/api/sprints/${sprintId}/iterations/${roleIndex}/output`, {
      output: `执行失败: ${error.message}`,
      status: 'failed'
    });
    throw error;
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const sprintId = args[0];
  const roleIndex = args[1] ? parseInt(args[1]) : null;
  const customModel = args[2] || null;  // args[2] 是 model 参数

  if (!sprintId) {
    console.log(`
🤖 AI Agent Executor (Sprint 模式)

用法: node sprint-agent-executor.js <sprint-id> <role-index> [model] [stepIndex]
    `);
    process.exit(1);
  }

  if (roleIndex === null) {
    console.log('❌ 需要指定 roleIndex');
    process.exit(1);
  }
  
  // 如果传入了模型，覆盖默认配置
  if (customModel) {
    console.log(`   🎯 使用指定模型: ${customModel}`);
  }
  
  let roleName = 'unknown';
  let totalSteps = 1;
  try {
    const { data: sprintMeta } = await axios.get(`${API_BASE}/api/sprints/${sprintId}`);
    roleName = sprintMeta?.iterations?.[roleIndex]?.role || 'unknown';
    totalSteps = ROLE_STEPS[roleName] || 1;
    if ((sprintMeta?.scenario || 'BUILD') === 'QUERY' && roleName === 'tech_coach') {
      totalSteps = 1;
    }
  } catch (e) {
    console.warn('   ⚠️ 无法预取 sprint 元数据，步骤数默认为 1:', e.message);
  }
  
  // 未传第 4 参：从第 0 步链式跑完；传了则只跑该步且按节覆盖（见 replaceStepOutput）
  const explicitStep = args[3] !== undefined;
  const stepIndexParsed = explicitStep ? parseInt(args[3], 10) : NaN;
  const startStep =
    explicitStep && !Number.isNaN(stepIndexParsed) ? stepIndexParsed : null;
  const replaceStepOutput = explicitStep && !Number.isNaN(stepIndexParsed);
  const logFrom = startStep !== null && startStep !== undefined ? startStep + 1 : 1;
  console.log(
    `🎯 执行角色: ${roleName}, 步骤: ${logFrom}-${totalSteps} (共${totalSteps}步)${replaceStepOutput ? ' [按节覆盖]' : ''}`
  );

  try {
    await runIteration(sprintId, roleIndex, customModel, startStep, { replaceStepOutput });
  } catch (error) {
    console.error('❌ 执行失败:', error);
    process.exit(1);
  }
}

main();
