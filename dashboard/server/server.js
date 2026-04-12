import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import os from 'os';
import { ROUTES } from '../../config/pipelineConfig.js';
import { createHarness } from '../../harness/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// 配置路径 - 新结构 projects/{projectId}/sprints/{sprintId}/
const PROJECTS_DIR = path.join(ROOT, 'projects');
const AI_AGENT_EXECUTOR = path.join(ROOT, 'ai-agent-executor.js');
const WORKSPACE_DIR = path.join(ROOT, 'workspace');
const MAX_PREVIEW_BYTES = 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.DS_Store']);
const MODELS_CONFIG_PATH = path.join(ROOT, 'model-config.json');
const OPENCODE_CONFIG_PATH =
  process.env.OPENCODE_CONFIG_PATH || path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

const DEFAULT_SCENARIO = 'BUILD';

// 角色信息（须覆盖 ROUTES 中全部 role）
const ROLE_INFO = {
  product: { icon: '📋', name: '产品经理', name_en: 'Product BA' },
  architect: { icon: '🏗️', name: '架构师', name_en: 'Architect' },
  tech_coach: { icon: '🔍', name: '开发教练', name_en: 'Tech Coach' },
  developer: { icon: '💻', name: '开发者', name_en: 'Developer' },
  tester: { icon: '🧪', name: '测试工程师', name_en: 'QA Engineer' },
  ops: { icon: '⚙️', name: '运维工程师', name_en: 'DevOps' },
  evolver: { icon: '🔄', name: '进化顾问', name_en: 'Evolver' },
  ghost: { icon: '👻', name: '安全审计', name_en: 'Ghost' },
  creative: { icon: '🎨', name: '创意总监', name_en: 'Creative' }
};

function resolveRolesForScenario(scenario) {
  const key = scenario && ROUTES[scenario] ? scenario : DEFAULT_SCENARIO;
  return { scenario: key, roles: [...ROUTES[key]] };
}

/** 与 dashboard sprintStageConfig 阶段 id 对齐，用于将整段阶段标为已确认 */
function getRolesForStageId(scenario, stageId) {
  const maps = {
    BUILD: {
      requirement: ['product'],
      'tech-design': ['tech_coach', 'architect'],
      development: ['developer'],
      testing: ['tester'],
      deploy: ['ops'],
      optimize: ['evolver']
    },
    CRITICAL: {
      requirement: ['product'],
      'tech-design': ['architect'],
      creative: ['creative'],
      development: ['developer'],
      testing: ['tester'],
      optimize: ['evolver']
    },
    REVIEW: {
      design_review: ['creative'],
      security_pass: ['ghost'],
      testing: ['tester']
    },
    QUERY: {
      feasibility: ['tech_coach']
    },
    SECURITY: {
      security_pass: ['ghost'],
      architecture_review: ['architect']
    }
  };
  const m = maps[scenario] || maps.BUILD;
  return m[stageId] || null;
}

function buildIterations(roles) {
  return roles.map((role, index) => ({
    role,
    roleIndex: index,
    roleInfo: ROLE_INFO[role] || { icon: '🤖', name: role, name_en: role },
    status: 'pending',
    userInput: '',
    output: '',
    history: [],
    startedAt: null,
    completedAt: null,
    developerTaskCursor: role === 'developer' ? 1 : null,
    developerRunningTaskIndex: null
  }));
}

function getDeveloperStepIndexByTaskIndex(taskIndex) {
  const idx = Number(taskIndex);
  if (!Number.isFinite(idx) || idx < 1) return 1;
  if (idx <= 10) return 1;
  if (idx <= 20) return 2;
  if (idx <= 30) return 3;
  if (idx <= 40) return 4;
  return 5;
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
      tasks.push({ text: mt[1].trim(), h2, h3 });
    }
  }
  return tasks;
}

async function resolveLatestTasksPathForSprint(sprint) {
  const projectId = sprint?.projectId;
  if (!projectId) return null;
  const changesDir = path.join(PROJECTS_DIR, projectId, 'openspec', 'changes');
  if (!fsSync.existsSync(changesDir)) return null;
  const entries = await fs.readdir(changesDir, { withFileTypes: true });
  let latestPath = null;
  let latestMtime = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const taskPath = path.join(changesDir, entry.name, 'tasks.md');
    if (!fsSync.existsSync(taskPath)) continue;
    try {
      const stat = await fs.stat(taskPath);
      const mt = stat.mtimeMs || 0;
      if (mt >= latestMtime) {
        latestMtime = mt;
        latestPath = taskPath;
      }
    } catch (_e) {}
  }
  return latestPath;
}

// 跟踪运行中的 agent 进程
const runningAgents = new Map();

/** Harness：技能预热与进程池统计（sprint-agent-executor 仍为独立 spawn，统计可观测） */
let harnessInstance = null;
let harnessInitPromise = null;

function parseBoolEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultValue;
}

const HARNESS_REQUIRED = parseBoolEnv('HARNESS_REQUIRED', false);
const HARNESS_WARMUP_ON_START = parseBoolEnv('HARNESS_WARMUP_ON_START', false);

/**
 * 默认：直接 `opencode run`，不注入 `--attach`（不依赖 opencode serve / HTTP）。
 * 需要 attach 复用时设置 DEVFORGE_DISABLE_OPENCODE_ATTACH=0 或 false。
 */
function opencodeAttachDisabled() {
  return parseBoolEnv('DEVFORGE_DISABLE_OPENCODE_ATTACH', true);
}

async function ensureHarness() {
  if (harnessInstance) return harnessInstance;
  if (!harnessInitPromise) {
    harnessInitPromise = createHarness({ rootDir: ROOT }).catch((err) => {
      console.warn('[Harness] init failed:', err.message);
      harnessInitPromise = null;
      return null;
    });
  }
  harnessInstance = await harnessInitPromise;
  try {
    const attachUrl = harnessInstance?.getStats?.()?.opencode?.attachUrl;
    if (attachUrl && !opencodeAttachDisabled()) {
      process.env.DEVFORGE_OPENCODE_ATTACH_URL = String(attachUrl);
    }
  } catch {}
  return harnessInstance;
}

const MAX_CONCURRENT_SPRINT_EXECUTORS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_SPRINT_EXECUTORS || '3', 10) || 3
);
let activeSprintExecutors = 0;
const sprintExecutorWaitQueue = [];

function acquireSprintExecutorSlot() {
  return new Promise((resolve) => {
    if (activeSprintExecutors < MAX_CONCURRENT_SPRINT_EXECUTORS) {
      activeSprintExecutors++;
      resolve();
    } else {
      sprintExecutorWaitQueue.push(resolve);
    }
  });
}

function releaseSprintExecutorSlot() {
  activeSprintExecutors = Math.max(0, activeSprintExecutors - 1);
  const next = sprintExecutorWaitQueue.shift();
  if (next) {
    activeSprintExecutors++;
    next();
  }
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../dist')));

// SPA fallback - serve index.html for all non-API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// ==================== 认证 API ====================

// 简单用户认证（生产环境应使用数据库）
const USERS = {
  admin: { password: 'admin', name: '管理员', role: 'admin' }
};

// 环境变量覆盖
if (process.env.ADMIN_PASSWORD) {
  USERS.admin.password = process.env.ADMIN_PASSWORD;
}
if (process.env.ADMIN_USER) {
  const user = USERS.admin;
  delete USERS.admin;
  USERS[process.env.ADMIN_USER] = user;
}

// 登录
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  const user = USERS[username];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  
  // 简单 token（生产环境应使用 JWT）
  const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
  
  res.json({
    token,
    user: {
      username,
      name: user.name,
      role: user.role
    }
  });
});

// 验证 token
app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: '未登录' });
  }
  
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const [username] = decoded.split(':');
    const user = USERS[username];
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
    }
    res.json({ user: { username, name: user.name, role: user.role } });
  } catch {
    res.status(401).json({ error: 'Token 无效' });
  }
});

// ==================== 状态管理 ====================

// 项目管理器
class ProjectManager {
  constructor() {
    this.projects = new Map();
  }

  async load() {
    try {
      const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const projectJsonPath = path.join(PROJECTS_DIR, entry.name, 'project.json');
          try {
            const data = await fs.readFile(projectJsonPath, 'utf-8');
            const project = JSON.parse(data);
            project.codePath = normalizeCodePath(project.codePath);
            this.projects.set(entry.name, project);
          } catch (e) {
            // 跳过无效的目录
          }
        }
      }
    } catch (e) {
      // 目录不存在，从头开始
    }
  }

  async save(projectId) {
    const project = this.projects.get(projectId);
    if (project) {
      const projectPath = path.join(PROJECTS_DIR, projectId);
      await fs.mkdir(projectPath, { recursive: true });
      await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify(project, null, 2));
    }
  }

  async create(data) {
    const id = uuidv4();
    const normalizedCodePath = normalizeCodePath(data.codePath);
    const defaultProjectCodePath = path.join(PROJECTS_DIR, id, 'src');
    const project = {
      id,
      name: data.name,
      description: data.description || '',
      codePath: normalizedCodePath || defaultProjectCodePath,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.projects.set(id, project);
    try {
      await fs.mkdir(project.codePath, { recursive: true });
    } catch (_e) {}
    await this.save(id);
    return project;
  }

  async get(id) {
    return this.projects.get(id);
  }

  async getAll() {
    return Array.from(this.projects.values());
  }

  async update(id, updates) {
    const project = this.projects.get(id);
    if (!project) return null;
    const sanitizedUpdates = { ...updates };
    if (Object.prototype.hasOwnProperty.call(sanitizedUpdates, 'codePath')) {
      sanitizedUpdates.codePath = normalizeCodePath(sanitizedUpdates.codePath);
    }
    Object.assign(project, sanitizedUpdates, { updatedAt: new Date().toISOString() });
    await this.save(id);
    return project;
  }

  async delete(id) {
    this.projects.delete(id);
    const projectPath = path.join(PROJECTS_DIR, id);
    await fs.rm(projectPath, { recursive: true, force: true });
  }
}

// 冲刺管理器
class SprintManager {
  constructor(projectManager) {
    this.sprints = new Map();
    this.projectManager = projectManager;
  }

  getProjectPath(projectId) {
    return path.join(PROJECTS_DIR, projectId);
  }

  getSprintPath(projectId, sprintId) {
    return path.join(this.getProjectPath(projectId), 'sprints', sprintId);
  }

  getSprintJsonPath(projectId, sprintId) {
    return path.join(this.getSprintPath(projectId, sprintId), 'sprint.json');
  }

  async load() {
    // 加载所有项目的冲刺
    const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sprintsPath = path.join(PROJECTS_DIR, entry.name, 'sprints');
        try {
          const sprintEntries = await fs.readdir(sprintsPath, { withFileTypes: true });
          for (const sprintEntry of sprintEntries) {
            if (sprintEntry.isDirectory()) {
              const sprintJsonPath = path.join(sprintsPath, sprintEntry.name, 'sprint.json');
              try {
                const data = await fs.readFile(sprintJsonPath, 'utf-8');
                const sprint = JSON.parse(data);
                if (!sprint.scenario) sprint.scenario = DEFAULT_SCENARIO;
                if (!sprint.developerBackend || !['opencode', 'cursor_auto'].includes(sprint.developerBackend)) {
                  sprint.developerBackend = 'opencode';
                }
                this.sprints.set(sprint.id, sprint);
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }
  }

  async save(sprintId) {
    const sprint = this.sprints.get(sprintId);
    if (sprint) {
      const sprintPath = this.getSprintPath(sprint.projectId, sprintId);
      await fs.mkdir(sprintPath, { recursive: true });
      await fs.writeFile(path.join(sprintPath, 'sprint.json'), JSON.stringify(sprint, null, 2));
    }
  }

  async create(projectId, data) {
    // 验证 projectId 不能为空
    if (!projectId) {
      throw new Error('projectId is required. Please select a project before creating a sprint.');
    }

    const project = await this.projectManager.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const normalizedSprintCodePath = normalizeCodePath(data.localProjectPath);
    const normalizedProjectCodePath = normalizeCodePath(project.codePath);

    if (normalizedProjectCodePath && normalizedSprintCodePath && normalizedProjectCodePath !== normalizedSprintCodePath) {
      const err = new Error('Project codePath mismatch');
      err.code = 'PROJECT_CODE_PATH_MISMATCH';
      err.expectedCodePath = normalizedProjectCodePath;
      err.receivedCodePath = normalizedSprintCodePath;
      throw err;
    }

    if (!normalizedProjectCodePath && normalizedSprintCodePath) {
      project.codePath = normalizedSprintCodePath;
      project.updatedAt = new Date().toISOString();
      await this.projectManager.save(projectId);
    }

    // Sprint ID 格式: {projectId}-{uuid}
    const shortUuid = uuidv4().slice(0, 8);
    const id = `${projectId}-${shortUuid}`;
    const sprintNumber = (this.sprints.size || 0) + 1;

    const { scenario, roles } = resolveRolesForScenario(data.scenario);

    const defaultDev =
      process.env.DEVFORGE_DEVELOPER_BACKEND === 'cursor_auto' ? 'cursor_auto' : 'opencode';
    const sprint = {
      id,
      projectId,
      scenario,
      name: data.name || `Sprint #${sprintNumber}`,
      goal: data.goal || '',
      rawInput: data.rawInput || '',
      localProjectPath: normalizedSprintCodePath || normalizedProjectCodePath || null,
      status: 'pending',
      roles,
      currentRoleIndex: 0,
      developerBackend:
        data.developerBackend === 'cursor_auto' || data.developerBackend === 'opencode'
          ? data.developerBackend
          : defaultDev,
      iterations: buildIterations(roles),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.sprints.set(id, sprint);
    await this.save(id);
    return sprint;
  }

  async get(id) {
    const sprint = this.sprints.get(id);
    if (sprint && (!sprint.developerBackend || !['opencode', 'cursor_auto'].includes(sprint.developerBackend))) {
      sprint.developerBackend = 'opencode';
    }
    return sprint;
  }

  async getByProject(projectId) {
    return Array.from(this.sprints.values()).filter(s => s.projectId === projectId);
  }

  async update(id, updates) {
    const sprint = this.sprints.get(id);
    if (!sprint) return null;
    Object.assign(sprint, updates, { updatedAt: new Date().toISOString() });
    await this.save(id);
    return sprint;
  }

  async updateIteration(sprintId, roleIndex, updates) {
    const sprint = this.sprints.get(sprintId);
    if (!sprint) return null;
    
    if (sprint.iterations[roleIndex]) {
      Object.assign(sprint.iterations[roleIndex], updates);
    }
    await this.save(sprintId);
    return sprint;
  }

  async delete(id) {
    const sprint = this.sprints.get(id);
    if (!sprint) return;
    this.sprints.delete(id);
    const sprintPath = this.getSprintPath(sprint.projectId, id);
    await fs.rm(sprintPath, { recursive: true, force: true });
  }

  async addLog(sprintId, log) {
    const sprint = this.sprints.get(sprintId);
    if (!sprint) return;
    if (!sprint.logs) sprint.logs = [];
    sprint.logs.push({
      timestamp: new Date().toISOString(),
      ...log
    });
    await this.save(sprintId);
  }
}

// 初始化
const projectManager = new ProjectManager();
const sprintManager = new SprintManager(projectManager);

function isChildProcessExited(proc) {
  if (!proc) return true;
  return proc.exitCode !== null || proc.signalCode !== null;
}

/** Map 中若残留已退出子进程，移除（close 未触发等边界情况） */
function pruneDeadRunningAgent(runningKey) {
  const proc = runningAgents.get(runningKey);
  if (!proc) return;
  if (isChildProcessExited(proc)) {
    runningAgents.delete(runningKey);
  }
}

/** 本进程 HTTP 自调用，复用 POST /execute 的校验与 spawn（如 tech_coach 完成后自动跑架构师） */
async function triggerExecuteSprintRoleViaLoopback(sprintId, roleIndex, body = {}) {
  const apiPort = process.env.PORT || 3000;
  const url = `http://127.0.0.1:${apiPort}/api/sprints/${sprintId}/iterations/${roleIndex}/execute`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * sprint.json 里可能是 running，但进程已结束或服务器重启后 Map 为空。
 * 读 sprint 时自愈，避免 UI 永远卡在「进行中」且无法点执行。
 */
async function reconcileStaleRunningIterations(sprint) {
  if (!sprint?.iterations?.length) return false;
  let changed = false;
  for (let roleIndex = 0; roleIndex < sprint.iterations.length; roleIndex++) {
    const iteration = sprint.iterations[roleIndex];
    if (!iteration || iteration.status !== 'running') continue;
    const runningKey = `${sprint.id}-${roleIndex}`;
    pruneDeadRunningAgent(runningKey);
    if (!runningAgents.has(runningKey)) {
      if (roleIndex === 0) {
        iteration.status = 'ready';
        iteration.userInput = iteration.userInput || sprint.rawInput || '';
      } else {
        iteration.status = iteration.userInput ? 'ready' : 'waiting_input';
      }
      iteration.startedAt = null;
      iteration.completedAt = null;
      changed = true;
    }
  }
  if (changed) await sprintManager.save(sprint.id);
  return changed;
}

// 确保目录存在
async function ensureDirs() {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
}

function readOpenCodeModels() {
  try {
    if (!fsSync.existsSync(OPENCODE_CONFIG_PATH)) return [];
    const raw = fsSync.readFileSync(OPENCODE_CONFIG_PATH, 'utf-8');
    const conf = JSON.parse(raw);
    const providers = conf?.provider || {};
    const out = [];
    for (const [providerName, providerDef] of Object.entries(providers)) {
      const models = providerDef?.models || {};
      for (const modelName of Object.keys(models)) {
        out.push(`${providerName}/${modelName}`);
      }
    }
    return Array.from(new Set(out));
  } catch (_e) {
    return [];
  }
}

function pickBestModel(models, candidates, fallback) {
  for (const candidate of candidates) {
    if (models.includes(candidate)) return candidate;
  }
  return fallback;
}

function getDefaultModelConfig() {
  const available = readOpenCodeModels();
  const bestDev = pickBestModel(
    available,
    [
      'ciykj/gpt-5.4',
      'ciykj/gpt-5.3-codex',
      'ciykj/gpt-5.3-codex-spark',
      'opencode/gpt-5-nano'
    ],
    'opencode/gpt-5-nano'
  );

  return {
    ba: 'opencode/big-pickle',
    product: 'opencode/qwen3.6-plus-free',
    architect: 'opencode/qwen3.6-plus-free',
    tech_coach: 'opencode/qwen3.6-plus-free',
    developer: bestDev,
    tester: 'opencode/qwen3.6-plus-free',
    ops: 'opencode/gpt-5-nano',
    evolver: 'opencode/gpt-5-nano',
    ghost: 'opencode/big-pickle',
    creative: 'opencode/big-pickle'
  };
}

async function readModelConfig() {
  try {
    const data = await fs.readFile(MODELS_CONFIG_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (_e) {
    return getDefaultModelConfig();
  }
}

function normalizeCodePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return null;
  const trimmed = inputPath.trim();
  if (!trimmed) return null;
  return path.resolve(trimmed);
}

function isPathInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

function toSafeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseTestReportMarkdown(content) {
  const text = String(content || '');
  const readNumber = (patterns) => {
    for (const re of patterns) {
      const m = text.match(re);
      if (m?.[1]) return toSafeNumber(m[1], 0);
    }
    return 0;
  };

  const summary = {
    total: readNumber([/总(?:用例数|计)\D*(\d+)/i, /total\D*(\d+)/i]),
    passed: readNumber([/通过\D*(\d+)/i, /passed\D*(\d+)/i]),
    failed: readNumber([/失败\D*(\d+)/i, /failed\D*(\d+)/i]),
    skipped: readNumber([/跳过\D*(\d+)/i, /skipped\D*(\d+)/i])
  };

  const pickMetric = (name) => {
    const m = text.match(new RegExp(`${name}\\s*[:：]?\\s*([^\\n\\r]+)`, 'i'));
    return m?.[1]?.trim() || null;
  };

  const performance = {};
  const lcp = pickMetric('LCP');
  const fid = pickMetric('FID');
  const cls = pickMetric('CLS');
  const loadTime = pickMetric('加载时间|load[_ ]?time');
  if (lcp) performance.lcp = lcp;
  if (fid) performance.fid = fid;
  if (cls) performance.cls = cls;
  if (loadTime) performance.load_time = loadTime;

  return {
    summary,
    performance: Object.keys(performance).length > 0 ? performance : null,
    testType: /regression/i.test(text)
      ? 'regression'
      : /smoke/i.test(text)
      ? 'smoke'
      : /e2e/i.test(text)
      ? 'e2e'
      : 'full'
  };
}

async function collectReports({ projectId = null, sprintManagerRef }) {
  const reports = [];
  const sprints = Array.from(sprintManagerRef.sprints.values());

  for (const sprint of sprints) {
    if (projectId && sprint.projectId !== projectId) continue;

    const outputDir = path.join(WORKSPACE_DIR, sprint.id, 'output');
    const jsonPath = path.join(outputDir, 'test-report.json');
    const mdPath = path.join(outputDir, 'test-report.md');

    let source = null;
    let parsed = null;
    let timestamp = sprint.updatedAt || sprint.createdAt || new Date().toISOString();

    try {
      if (fsSync.existsSync(jsonPath)) {
        const raw = await fs.readFile(jsonPath, 'utf-8');
        const data = JSON.parse(raw);
        source = 'json';
        parsed = {
          summary: {
            total: toSafeNumber(data?.summary?.total, 0),
            passed: toSafeNumber(data?.summary?.passed, 0),
            failed: toSafeNumber(data?.summary?.failed, 0),
            skipped: toSafeNumber(data?.summary?.skipped, 0)
          },
          performance: data?.performance || null,
          testType: data?.testType || 'full'
        };
        const stat = await fs.stat(jsonPath);
        timestamp = stat.mtime.toISOString();
      } else if (fsSync.existsSync(mdPath)) {
        const raw = await fs.readFile(mdPath, 'utf-8');
        source = 'md';
        parsed = parseTestReportMarkdown(raw);
        const stat = await fs.stat(mdPath);
        timestamp = stat.mtime.toISOString();
      }
    } catch (e) {
      // ignore broken single report
    }

    if (!parsed) continue;

    reports.push({
      reportId: `${sprint.id}-test-report`,
      projectId: sprint.projectId,
      sprintId: sprint.id,
      pipelineId: sprint.id,
      timestamp,
      testType: parsed.testType,
      summary: parsed.summary,
      performance: parsed.performance,
      source
    });
  }

  reports.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return reports;
}

// ==================== REST API ====================

// ==================== 项目 API ====================

// 创建项目
app.post('/api/projects', async (req, res) => {
  try {
    const project = await projectManager.create(req.body);
    io.emit('project:created', project);
    res.status(201).json(project);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取所有项目
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await projectManager.getAll();
    res.json(projects);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取单个项目
app.get('/api/projects/:id', async (req, res) => {
  try {
    const project = await projectManager.get(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(project);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新项目
app.put('/api/projects/:id', async (req, res) => {
  try {
    const project = await projectManager.update(req.params.id, req.body);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    io.emit('project:updated', project);
    res.json(project);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新项目代码路径（每个项目唯一代码库）
app.put('/api/projects/:id/code-path', async (req, res) => {
  try {
    const project = await projectManager.get(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const normalized = normalizeCodePath(req.body?.codePath);
    if (normalized && !fsSync.existsSync(normalized)) {
      return res.status(400).json({ error: 'Code path does not exist' });
    }
    if (normalized) {
      const stat = await fs.stat(normalized);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Code path is not a directory' });
      }
    }

    const updated = await projectManager.update(req.params.id, { codePath: normalized });
    io.emit('project:updated', updated);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除项目
app.delete('/api/projects/:id', async (req, res) => {
  try {
    await projectManager.delete(req.params.id);
    io.emit('project:deleted', { id: req.params.id });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 冲刺 API ====================

// 创建冲刺
app.post('/api/projects/:projectId/sprints', async (req, res) => {
  try {
    const project = await projectManager.get(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const sprint = await sprintManager.create(req.params.projectId, req.body);
    io.emit('sprint:created', sprint);
    res.status(201).json(sprint);
  } catch (e) {
    if (e?.code === 'PROJECT_CODE_PATH_MISMATCH') {
      return res.status(409).json({
        error: 'Project code path mismatch',
        code: e.code,
        expectedCodePath: e.expectedCodePath,
        receivedCodePath: e.receivedCodePath
      });
    }
    res.status(500).json({ error: e.message });
  }
});

// 获取项目的所有冲刺
app.get('/api/projects/:projectId/sprints', async (req, res) => {
  try {
    const sprints = await sprintManager.getByProject(req.params.projectId);
    res.json(sprints);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取单个冲刺
app.get('/api/sprints/:id', async (req, res) => {
  try {
    const sprint = await sprintManager.get(req.params.id);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }
    await reconcileStaleRunningIterations(sprint);
    res.json(sprint);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新冲刺
app.put('/api/sprints/:id', async (req, res) => {
  try {
    const sprint = await sprintManager.update(req.params.id, req.body);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }
    io.emit('sprint:updated', sprint);
    res.json(sprint);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除冲刺
app.delete('/api/sprints/:id', async (req, res) => {
  try {
    await sprintManager.delete(req.params.id);
    io.emit('sprint:deleted', { id: req.params.id });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 迭代 API ====================

// 用户输入（角色开始前）
app.put('/api/sprints/:sprintId/iterations/:roleIndex/input', async (req, res) => {
  try {
    const sprint = await sprintManager.get(req.params.sprintId);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    const roleIndex = parseInt(req.params.roleIndex);
    const iteration = sprint.iterations[roleIndex];
    if (!iteration) {
      return res.status(404).json({ error: 'Iteration not found' });
    }

    // 如果是第一个角色（product），使用 sprint.rawInput 作为用户输入
    const userInput = roleIndex === 0 ? (sprint.rawInput || '') : (req.body.userInput || '');

    // 保存用户输入到历史记录
    if (iteration.userInput) {
      iteration.history.push({
        input: iteration.userInput,
        output: iteration.output,
        timestamp: iteration.completedAt || new Date().toISOString()
      });
    }

    // 更新用户输入
    iteration.userInput = userInput;
    iteration.status = 'ready';
    iteration.startedAt = iteration.startedAt || new Date().toISOString();

    await sprintManager.save(sprint.id);
    io.emit('iteration:input:updated', { sprintId: sprint.id, roleIndex, iteration });
    res.json(iteration);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 确认输出（角色完成后）
app.put('/api/sprints/:sprintId/iterations/:roleIndex/confirm', async (req, res) => {
  try {
    const sprint = await sprintManager.get(req.params.sprintId);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    const roleIndex = parseInt(req.params.roleIndex);
    const iteration = sprint.iterations[roleIndex];
    if (!iteration) {
      return res.status(404).json({ error: 'Iteration not found' });
    }

    // 双向同步：如果请求包含 output，则同步更新
    if (req.body.output) {
      iteration.output = req.body.output;
      
      // 同步更新到 output 文件
      const workspacePath = path.join(ROOT, 'workspace', sprint.id);
      const outputDir = path.join(workspacePath, 'output');
      await fs.mkdir(outputDir, { recursive: true });
      
      // 根据角色确定文件名
      const roleNames = ['ba', 'product', 'tech_coach', 'architect', 'developer', 'tester', 'ops', 'evolver', 'ghost', 'creative'];
      const role = iteration.role || roleNames[roleIndex] || 'unknown';
      const fileNameMap = {
        'ba': 'ba-analysis.md',
        'product': 'prd.md',
        'tech_coach': 'tech-implementation.md',
        'architect': 'openspec.md',
        'developer': 'dev-summary.md',
        'tester': 'test-report.md',
        'ops': 'ops-config.md',
        'evolver': 'evolver-report.md',
        'ghost': 'security-report.md',
        'creative': 'design-review.md'
      };
      const fileName = fileNameMap[role] || `${role}-output.md`;
      
      await fs.writeFile(path.join(outputDir, fileName), req.body.output, 'utf-8');
    }

    iteration.status = 'confirmed';
    iteration.completedAt = new Date().toISOString();

    // 自动传递输入给下一个角色
    if (roleIndex < sprint.iterations.length - 1) {
      const nextIteration = sprint.iterations[roleIndex + 1];
      const nextRole = nextIteration?.role;
      
      // 角色顺序: product, tech_coach, architect, developer, tester, ops
      // Ops 需要从 Developer 获取输入，其他角色从上一个角色获取输入
      if (nextRole === 'ops') {
        // Ops 从 Developer 获取输入
        const developerIndex = sprint.iterations.findIndex(i => i.role === 'developer');
        if (developerIndex >= 0) {
          nextIteration.userInput = sprint.iterations[developerIndex].output;
        }
      } else {
        // 其他角色使用当前角色的输出作为输入
        nextIteration.userInput = iteration.output;
      }
    }

    // 移动到下一个角色；仅当下一角色尚未跑完时设为 ready（避免把已 completed 的架构师降级为 ready，导致技术设计阶段一直显示「等待输入」）
    if (roleIndex < sprint.iterations.length - 1) {
      sprint.currentRoleIndex = roleIndex + 1;
      sprint.status = 'running';
      const nextIt = sprint.iterations[sprint.currentRoleIndex];
      if (
        nextIt &&
        !['completed', 'confirmed', 'running'].includes(nextIt.status)
      ) {
        nextIt.status = 'ready';
      }
    } else {
      sprint.status = 'completed';
      sprint.currentRoleIndex = sprint.iterations.length;
    }

    await sprintManager.save(sprint.id);
    io.emit('iteration:confirmed', { sprintId: sprint.id, roleIndex, iteration, nextRoleIndex: sprint.currentRoleIndex });
    res.json({ success: true, nextRoleIndex: sprint.currentRoleIndex });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * 将某流程阶段内所有角色标为 confirmed（用于卡住时解锁下一阶段，继续测试）
 * body: { stageId: 'tech-design' }（与前端阶段 id 一致）
 */
app.post('/api/sprints/:sprintId/mark-stage-confirmed', async (req, res) => {
  try {
    const { stageId } = req.body || {};
    if (!stageId || typeof stageId !== 'string') {
      return res.status(400).json({ error: 'body.stageId 必填（如 tech-design）' });
    }

    const sprint = await sprintManager.get(req.params.sprintId);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    const scenario = sprint.scenario || DEFAULT_SCENARIO;
    const roles = getRolesForStageId(scenario, stageId);
    if (!roles?.length) {
      return res.status(400).json({ error: `未知阶段: ${stageId}（scenario=${scenario}）` });
    }

    const now = new Date().toISOString();
    let updated = 0;
    for (const iteration of sprint.iterations) {
      if (roles.includes(iteration.role)) {
        iteration.status = 'confirmed';
        iteration.completedAt = iteration.completedAt || now;
        updated++;
      }
    }

    const order = ROUTES[scenario] || ROUTES[DEFAULT_SCENARIO];
    const lastRole = roles[roles.length - 1];
    const lastIdx = order.indexOf(lastRole);
    if (lastIdx >= 0 && lastIdx < order.length - 1) {
      const nextRole = order[lastIdx + 1];
      const nextIterIdx = sprint.iterations.findIndex((i) => i.role === nextRole);
      if (nextIterIdx >= 0) {
        sprint.currentRoleIndex = nextIterIdx;
        const ni = sprint.iterations[nextIterIdx];
        if (ni && !['completed', 'confirmed', 'running'].includes(ni.status)) {
          ni.status = 'ready';
        }
      }
    }

    sprint.status = 'running';
    await sprintManager.save(sprint.id);
    io.emit('sprint:updated', { sprintId: sprint.id, stageId, roles });
    res.json({
      success: true,
      stageId,
      roles,
      updated,
      currentRoleIndex: sprint.currentRoleIndex
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 设置测试环境地址
app.put('/api/sprints/:sprintId/iterations/:roleIndex/environment', async (req, res) => {
  try {
    const sprint = await sprintManager.get(req.params.sprintId);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    const roleIndex = parseInt(req.params.roleIndex);
    const iteration = sprint.iterations[roleIndex];
    if (!iteration) {
      return res.status(404).json({ error: 'Iteration not found' });
    }

    const { testEnvironmentUrl } = req.body;
    iteration.testEnvironmentUrl = testEnvironmentUrl || '';
    
    // 如果设置了环境地址，清除跳过标记
    if (testEnvironmentUrl) {
      iteration.environmentDeferred = false;
      iteration.environmentDeferredAt = null;
    }

    await sprintManager.save(sprint.id);
    io.emit('iteration:environmentUpdated', { 
      sprintId: sprint.id, 
      roleIndex, 
      testEnvironmentUrl: iteration.testEnvironmentUrl 
    });
    
    res.json({ success: true, testEnvironmentUrl: iteration.testEnvironmentUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 重新执行角色
app.post('/api/sprints/:sprintId/iterations/:roleIndex/rerun', async (req, res) => {
  try {
    const sprint = await sprintManager.get(req.params.sprintId);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    const roleIndex = parseInt(req.params.roleIndex);
    const iteration = sprint.iterations[roleIndex];
    if (!iteration) {
      return res.status(404).json({ error: 'Iteration not found' });
    }

    // 保存当前输出到历史
    if (iteration.output) {
      iteration.history.push({
        input: iteration.userInput,
        output: iteration.output,
        timestamp: new Date().toISOString()
      });
    }

    // 重置状态，准备重新执行（由前端或用户再点「执行」时启动；前端会在 rerun 后立即 execute）
    iteration.status = 'ready';
    iteration.startedAt = null;
    iteration.completedAt = null;
    iteration.output = '';

    await sprintManager.save(sprint.id);
    io.emit('iteration:rerun', { sprintId: sprint.id, roleIndex, iteration });
    res.json(iteration);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新迭代输出（Agent 提交）
app.put('/api/sprints/:sprintId/iterations/:roleIndex/output', async (req, res) => {
  try {
    const sprint = await sprintManager.get(req.params.sprintId);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    const roleIndex = parseInt(req.params.roleIndex);
    const iteration = sprint.iterations[roleIndex];
    if (!iteration) {
      return res.status(404).json({ error: 'Iteration not found' });
    }

    iteration.output = req.body.output || '';
    const explicit = req.body.status;
    const trimmedOut = String(iteration.output || '').trim();
    if (explicit !== undefined && explicit !== '') {
      iteration.status = explicit;
    } else if (trimmedOut === '正在执行...') {
      // 执行器占位：仍在跑 OpenCode，不能记为已完成
      iteration.status = 'running';
    } else {
      // 未显式传 status 时默认「进行中」：多步角色会多次 PUT 合并输出，
      // 若默认 completed 会导致尚未跑完所有步骤 UI 就显示已完成
      iteration.status = 'running';
    }
    if (iteration.status === 'completed') {
      iteration.completedAt = iteration.completedAt || new Date().toISOString();
    } else {
      iteration.completedAt = null;
    }

    // Agent 完成后把有效产出写入下一角色的 userInput（排除占位文案，避免误传「正在执行...」）
    const out = (iteration.output || '').trim();
    const isPlaceholder =
      !out ||
      out === '正在执行...' ||
      out.startsWith('执行失败') ||
      out.includes('执行失败:');
    if (iteration.status === 'completed' && !isPlaceholder && roleIndex < sprint.iterations.length - 1) {
      const nextIt = sprint.iterations[roleIndex + 1];
      if (nextIt) {
        if (iteration.role === 'tech_coach' && nextIt.role === 'architect') {
          nextIt.userInput = iteration.output;
          if (['pending', 'waiting_input', 'failed'].includes(nextIt.status)) {
            nextIt.status = 'ready';
          }
        } else if (!(nextIt.userInput || '').trim()) {
          nextIt.userInput = iteration.output;
          if (nextIt.status === 'pending') nextIt.status = 'ready';
        }
      }
    }

    await sprintManager.save(sprint.id);
    io.emit('iteration:output:updated', { sprintId: sprint.id, roleIndex, iteration });

    const nextAfterTech = sprint.iterations[roleIndex + 1];
    const chainTechToArchitect =
      iteration.role === 'tech_coach' &&
      iteration.status === 'completed' &&
      !isPlaceholder &&
      nextAfterTech?.role === 'architect' &&
      nextAfterTech.status !== 'running';

    if (chainTechToArchitect) {
      const nextIdx = roleIndex + 1;
      setImmediate(() => {
        triggerExecuteSprintRoleViaLoopback(sprint.id, nextIdx, {})
          .then(() => {
            console.log(`[chain] 已自动启动架构师 (roleIndex=${nextIdx})`);
            io.emit('iteration:chain:started', {
              sprintId: sprint.id,
              fromRoleIndex: roleIndex,
              toRoleIndex: nextIdx
            });
          })
          .catch((e) => console.warn('[chain] tech_coach→architect 自动执行失败:', e.message));
      });
    }

    res.json(iteration);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 触发 Agent 执行
const AI_AGENT_EXECUTOR_SPRINT = path.join(ROOT, 'sprint-agent-executor.js');

app.get('/api/harness/stats', async (req, res) => {
  try {
    const h = await ensureHarness();
    if (!h) {
      return res.json({
        enabled: false,
        message: 'Harness 未初始化（可能缺少 opencode 或池启动失败）',
        maxConcurrentSprintExecutors: MAX_CONCURRENT_SPRINT_EXECUTORS,
        activeSprintExecutors,
        queuedSprintExecutors: sprintExecutorWaitQueue.length
      });
    }
    res.json({
      enabled: true,
      ...h.getStats(),
      maxConcurrentSprintExecutors: MAX_CONCURRENT_SPRINT_EXECUTORS,
      activeSprintExecutors,
      queuedSprintExecutors: sprintExecutorWaitQueue.length
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/harness/health', async (req, res) => {
  try {
    const h = await ensureHarness();
    if (!h) {
      return res.json({
        enabled: false,
        healthy: false,
        errorCode: 'HARNESS_UNAVAILABLE',
        message: 'Harness 未初始化（可能缺少 opencode 或池启动失败）',
        config: {
          required: HARNESS_REQUIRED,
          warmupOnStart: HARNESS_WARMUP_ON_START
        }
      });
    }

    const [health, stats] = await Promise.all([
      h.healthCheck(),
      Promise.resolve(h.getStats())
    ]);

    const opencodeHealth = health?.opencode || null;
    const attachUrl = stats?.opencode?.attachUrl || null;

    res.json({
      enabled: true,
      healthy: !!(opencodeHealth?.ok || health?.poolHealth?.isHealthy),
      initialized: !!health?.initialized,
      poolHealth: health?.poolHealth || null,
      cacheHitRate: health?.cacheHitRate ?? null,
      pools: stats?.pools || {},
      scheduler: stats?.scheduler || {},
      opencode: {
        attachUrl,
        health: opencodeHealth
      },
      config: {
        required: HARNESS_REQUIRED,
        warmupOnStart: HARNESS_WARMUP_ON_START
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message, errorCode: 'HARNESS_HEALTH_CHECK_FAILED' });
  }
});

app.post('/api/sprints/:sprintId/iterations/:roleIndex/execute', async (req, res) => {
  try {
    const h = await ensureHarness();
    if (!h && HARNESS_REQUIRED) {
      return res.status(503).json({
        error: 'Harness 初始化失败且当前配置要求 Harness 可用',
        errorCode: 'HARNESS_REQUIRED_INIT_FAILED'
      });
    }
    if (!h) {
      console.warn('[Harness] unavailable, continue execution by degradation mode');
    }

    const sprintId = req.params.sprintId;
    const roleIndex = parseInt(req.params.roleIndex);
    const runningKey = `${sprintId}-${roleIndex}`;
    let stepIndex = null;
    if (req.body.stepIndex !== undefined && req.body.stepIndex !== null && req.body.stepIndex !== '') {
      const n = parseInt(req.body.stepIndex, 10);
      if (!Number.isNaN(n)) stepIndex = n;
    }
    let requestedTaskIndex = null;
    if (req.body.taskIndex !== undefined && req.body.taskIndex !== null && req.body.taskIndex !== '') {
      const n = parseInt(req.body.taskIndex, 10);
      if (!Number.isNaN(n) && n >= 1) requestedTaskIndex = n;
    }

    const sprint = await sprintManager.get(sprintId);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    const iteration = sprint.iterations[roleIndex];
    if (!iteration) {
      return res.status(404).json({ error: 'Iteration not found' });
    }

    pruneDeadRunningAgent(runningKey);
    const liveProc = runningAgents.get(runningKey);
    if (iteration.status === 'running' && liveProc && !isChildProcessExited(liveProc)) {
      return res.status(409).json({
        error: '该角色正在执行中，请稍候',
        errorCode: 'ALREADY_RUNNING'
      });
    }

    // 自愈：如果 sprint.json 里残留 running，但当前进程表里并没有对应 agent，
    // 则重置为可执行状态（避免 UI 永远提示“正在运行”但实际没跑）。
    if (iteration.status === 'running' && !runningAgents.has(runningKey)) {
      // product 允许直接执行（使用 sprint.rawInput 作为输入）；其他角色回到 waiting_input/ready
      if (roleIndex === 0) {
        iteration.status = 'ready';
        iteration.userInput = iteration.userInput || sprint.rawInput || '';
      } else {
        iteration.status = iteration.userInput ? 'ready' : 'waiting_input';
      }
      iteration.startedAt = null;
      iteration.completedAt = null;
      await sprintManager.save(sprint.id);
    }

    if (req.body.developerBackend === 'opencode' || req.body.developerBackend === 'cursor_auto') {
      sprint.developerBackend = req.body.developerBackend;
    }

    // Developer 角色强制使用单任务执行模式（基于游标）
    let effectiveTaskIndex = null;
    if (iteration.role === 'developer') {
      const tasksPath = await resolveLatestTasksPathForSprint(sprint);
      if (!tasksPath || !fsSync.existsSync(tasksPath)) {
        return res.status(400).json({ error: '未找到 tasks.md，无法进行单任务执行' });
      }
      const tasksMd = await fs.readFile(tasksPath, 'utf-8');
      const tasks = parseTasksFromMarkdown(tasksMd);
      if (!tasks.length) {
        return res.status(400).json({ error: 'tasks.md 没有可执行任务（checkbox）' });
      }

      const cursor = Number.isFinite(Number(iteration.developerTaskCursor))
        ? Math.max(1, Number(iteration.developerTaskCursor))
        : 1;
      const candidate = requestedTaskIndex || cursor;
      if (candidate < 1 || candidate > tasks.length) {
        return res.status(400).json({ error: `任务索引越界: ${candidate}，总任务数 ${tasks.length}` });
      }
      effectiveTaskIndex = candidate;
      stepIndex = getDeveloperStepIndexByTaskIndex(effectiveTaskIndex);
      iteration.developerRunningTaskIndex = effectiveTaskIndex;
    }

    // 检查是否有用户输入
    if (roleIndex === 0 && !iteration.userInput) {
      iteration.userInput = sprint.rawInput || '';
      iteration.status = iteration.status === 'pending' ? 'ready' : iteration.status;
      await sprintManager.save(sprint.id);
    } else if (!iteration.userInput && roleIndex > 0) {
      return res.status(400).json({ error: '需要用户先输入' });
    }

    // 检查前一个角色是否已完成（串行执行保证）
    if (roleIndex > 0) {
      const prevIteration = sprint.iterations[roleIndex - 1];
      if (!prevIteration || (prevIteration.status !== 'completed' && prevIteration.status !== 'confirmed')) {
        return res.status(400).json({ 
          error: `前一个角色（${prevIteration?.roleInfo?.name || '未知'}）尚未完成，无法执行当前角色` 
        });
      }
    }

    // 更新状态为运行中（从 failed 重跑时清 completedAt，避免残留终态时间）
    if (iteration.status === 'failed') {
      iteration.completedAt = null;
    }
    iteration.status = 'running';
    iteration.startedAt = new Date().toISOString();
    await sprintManager.save(sprint.id);

    // 读取模型配置（优先 model-config.json，fallback 到 opencode config 推断）
    const modelConfig = await readModelConfig()

    // 启动 Agent Executor 进程
    console.log(
      `🚀 启动 Agent Executor for sprint ${sprintId.slice(0, 8)}, role ${roleIndex}, step ${stepIndex ?? 'all'}`
    );

    const apiPort = process.env.PORT || 3000;
    const roleName = iteration.role;
    const model = modelConfig[roleName] || modelConfig.developer || 'opencode/big-pickle';
    
    // 构建参数: sprintId, roleIndex, model, stepIndex
    const args = [AI_AGENT_EXECUTOR_SPRINT, sprintId, roleIndex.toString(), model];
    if (stepIndex !== null) {
      args.push(stepIndex.toString());
    }

    await acquireSprintExecutorSlot();

    const defaultDevBackend =
      process.env.DEVFORGE_DEVELOPER_BACKEND === 'cursor_auto' ? 'cursor_auto' : 'opencode';
    const developerBackendForEnv =
      sprint.developerBackend === 'cursor_auto' || sprint.developerBackend === 'opencode'
        ? sprint.developerBackend
        : defaultDevBackend;

    const extraEnv = {};
    if (effectiveTaskIndex) {
      extraEnv.DEVFORGE_DEVELOPER_SINGLE_TASK = 'true';
      extraEnv.DEVFORGE_DEVELOPER_SINGLE_TASK_INDEX = String(effectiveTaskIndex);
    }

    const attachUrl =
      !opencodeAttachDisabled() && h?.getStats?.()?.opencode?.attachUrl
        ? String(h.getStats().opencode.attachUrl)
        : '';

    const agentProc = spawn('node', args, {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        API_BASE: `http://localhost:${apiPort}`,
        AGENT_MODEL: model,
        DEVFORGE_DEVELOPER_BACKEND: developerBackendForEnv,
        // 显式覆盖，避免父进程曾注入 attach 而子进程仍继承 DEVFORGE_OPENCODE_ATTACH_URL
        DEVFORGE_OPENCODE_ATTACH_URL: attachUrl,
        OPENCODE_ATTACH_URL: attachUrl,
        ...extraEnv
      }
    });

    runningAgents.set(runningKey, agentProc);

    agentProc.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[agent:${roleIndex}] ${output}`);
      sprintManager.addLog(sprintId, {
        type: 'agent_log',
        message: output
      });
      io.emit('agent:output', { sprintId, roleIndex, output });
    });

    agentProc.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`[agent:error:${roleIndex}] ${output}`);
    });

    agentProc.on('error', (err) => {
      console.error(`[agent] spawn error:`, err);
      releaseSprintExecutorSlot();
      runningAgents.delete(`${sprintId}-${roleIndex}`);
    });

    agentProc.on('close', (code) => {
      console.log(`[agent] Process exited with code ${code}`);
      runningAgents.delete(`${sprintId}-${roleIndex}`);
      releaseSprintExecutorSlot();

      // 等待 agent 完全结束并保存输出
      setTimeout(async () => {
        try {
          const sprint = await sprintManager.get(sprintId);
          if (sprint && sprint.iterations[roleIndex]) {
            const iteration = sprint.iterations[roleIndex];
            const output = iteration.output;
            
            if (code !== 0) {
              if (iteration.status === 'running') {
                iteration.status = 'failed';
                iteration.developerRunningTaskIndex = null;
                await sprintManager.save(sprintId);
              }
            } else if (output && output !== '正在执行...' && !output.includes('执行失败')) {
              // 进程正常退出：仅当仍为 running 时兜底标为完成（executor 成功时通常会先 PUT completed）
              if (iteration.status === 'running') {
                iteration.status = 'completed';
                iteration.completedAt = new Date().toISOString();
                // Developer 角色完成后自动推进游标
                if (iteration.role === 'developer') {
                  const ran = Number(iteration.developerRunningTaskIndex || effectiveTaskIndex || 0);
                  if (ran >= 1) {
                    iteration.developerTaskCursor = ran + 1;
                  }
                }
                iteration.developerRunningTaskIndex = null;
                await sprintManager.save(sprintId);
                io.emit('iteration:completed', { sprintId, roleIndex });
                console.log(`[step-complete] 角色 ${roleIndex} 已完成（close 兜底）`);
              } else if (iteration.status === 'completed') {
                iteration.developerRunningTaskIndex = null;
                await sprintManager.save(sprintId);
              }
            } else if (output && output.includes('执行失败')) {
              iteration.status = 'failed';
              iteration.developerRunningTaskIndex = null;
              await sprintManager.save(sprintId);
            } else {
              iteration.status = 'waiting_input';
              iteration.developerRunningTaskIndex = null;
              await sprintManager.save(sprintId);
              io.emit('iteration:confirmed', { sprintId, roleIndex });
            }
          }
        } catch (e) {
          console.error('更新 iteration 状态失败:', e.message);
        }
      }, 3000);
    });

    io.emit('iteration:execution:started', { sprintId, roleIndex });
    res.json({ success: true, message: 'Agent 已启动' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 启动冲刺（执行当前角色）
app.post('/api/sprints/:id/start', async (req, res) => {
  try {
    const sprint = await sprintManager.get(req.params.id);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    sprint.status = 'running';
    const currentRoleIndex = sprint.currentRoleIndex;
    if (sprint.iterations[currentRoleIndex]) {
      sprint.iterations[currentRoleIndex].status = 'waiting_input';
    }

    await sprintManager.save(sprint.id);
    io.emit('sprint:started', sprint);
    res.json(sprint);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取日志
app.get('/api/sprints/:id/logs', async (req, res) => {
  try {
    const sprint = await sprintManager.get(req.params.id);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }
    res.json(sprint.logs || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 读取本地项目文件 ====================

// 读取本地项目目录
app.get('/api/local-project/validate', async (req, res) => {
  try {
    const projectPath = req.query.path;
    if (!projectPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    // 检查路径是否存在
    const exists = fsSync.existsSync(projectPath);
    if (!exists) {
      return res.status(404).json({ error: 'Path does not exist', path: projectPath });
    }

    // 检查是否为目录
    const stat = await fs.stat(projectPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory', path: projectPath });
    }

    // 尝试读取 package.json（如果存在）
    let packageJson = null;
    try {
      const pkgPath = path.join(projectPath, 'package.json');
      if (fsSync.existsSync(pkgPath)) {
        packageJson = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
      }
    } catch (e) {}

    res.json({
      valid: true,
      path: projectPath,
      name: packageJson?.name || path.basename(projectPath),
      hasPackageJson: !!packageJson
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 读取本地项目文件树
app.get('/api/local-project/files', async (req, res) => {
  try {
    const projectPath = req.query.path;
    if (!projectPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    if (!fsSync.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Path does not exist' });
    }

    async function getFiles(dir, baseDir = dir, depth = 0) {
      if (depth > 3) return []; // 限制深度

      const items = await fs.readdir(dir, { withFileTypes: true });
      const result = [];

      for (const item of items) {
        // 跳过 node_modules, .git 等
        if (['node_modules', '.git', 'dist', 'build', '.next'].includes(item.name)) {
          continue;
        }

        const itemPath = path.join(dir, item.name);
        const relativePath = path.relative(baseDir, itemPath);

        if (item.isDirectory()) {
          result.push({
            name: item.name,
            path: relativePath,
            type: 'directory',
            children: await getFiles(itemPath, baseDir, depth + 1)
          });
        } else {
          const stat = await fs.stat(itemPath);
          result.push({
            name: item.name,
            path: relativePath,
            type: 'file',
            size: stat.size
          });
        }
      }

      return result;
    }

    const files = await getFiles(projectPath);
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 读取本地项目文件内容
app.get('/api/local-project/content', async (req, res) => {
  try {
    const projectPath = req.query.path;
    const filePath = req.query.file;
    if (!projectPath || !filePath) {
      return res.status(400).json({ error: 'Path and file are required' });
    }

    const fullPath = path.join(projectPath, filePath);
    if (!fsSync.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File does not exist' });
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    res.type('text/plain').send(content);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== Pipeline API (兼容旧版 agent-runner.js) ====================

// 获取流水线列表
app.get('/api/pipelines', async (req, res) => {
  try {
    const pipelines = [];
    const workspacePath = path.join(ROOT, 'workspace');
    try {
      const entries = await fs.readdir(workspacePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pipelineJsonPath = path.join(workspacePath, entry.name, 'pipeline.json');
          try {
            const data = await fs.readFile(pipelineJsonPath, 'utf-8');
            pipelines.push(JSON.parse(data));
          } catch (e) {}
        }
      }
    } catch (e) {}
    res.json(pipelines);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取单个流水线
app.get('/api/pipelines/:id', async (req, res) => {
  try {
    const pipelinePath = path.join(ROOT, 'workspace', req.params.id, 'pipeline.json');
    const data = await fs.readFile(pipelinePath, 'utf-8');
    res.json(JSON.parse(data));
  } catch (e) {
    res.status(404).json({ error: 'Pipeline not found' });
  }
});

// 更新流水线状态
app.put('/api/pipelines/:id', async (req, res) => {
  try {
    const pipelinePath = path.join(ROOT, 'workspace', req.params.id, 'pipeline.json');
    let pipeline = {};
    try {
      const data = await fs.readFile(pipelinePath, 'utf-8');
      pipeline = JSON.parse(data);
    } catch (e) {}
    pipeline = { ...pipeline, ...req.body };
    await fs.mkdir(path.dirname(pipelinePath), { recursive: true });
    await fs.writeFile(pipelinePath, JSON.stringify(pipeline, null, 2));
    res.json(pipeline);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新阶段状态 (ai-agent-executor.js 调用)
app.put('/api/pipelines/:id/stage/:agentName', async (req, res) => {
  try {
    const pipelinePath = path.join(ROOT, 'workspace', req.params.id, 'pipeline.json');
    let pipeline = {};
    try {
      const data = await fs.readFile(pipelinePath, 'utf-8');
      pipeline = JSON.parse(data);
    } catch (e) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }

    const agentName = req.params.agentName;
    if (pipeline.stages) {
      const stage = pipeline.stages.find(s => s.role === agentName);
      if (stage) {
        Object.assign(stage, req.body);
      }
    }

    await fs.writeFile(pipelinePath, JSON.stringify(pipeline, null, 2));
    io.emit('pipeline:stage:updated', { pipelineId: req.params.id, agentName, ...req.body });
    res.json(pipeline);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取用户选择 (agent-runner.js 调用)
app.get('/api/pipelines/:id/selection', async (req, res) => {
  try {
    const pipelinePath = path.join(ROOT, 'workspace', req.params.id, 'pipeline.json');
    const data = await fs.readFile(pipelinePath, 'utf-8');
    const pipeline = JSON.parse(data);
    res.json(pipeline.context?.userSelection || null);
  } catch (e) {
    res.status(404).json({ error: 'Pipeline not found' });
  }
});

// 提交 Agent 输出 (agent-runner.js 调用)
app.post('/api/agent/:agentName/submit', async (req, res) => {
  try {
    const { pipelineId, output, status } = req.body;
    const pipelinePath = path.join(ROOT, 'workspace', pipelineId, 'pipeline.json');
    let pipeline = {};
    try {
      const data = await fs.readFile(pipelinePath, 'utf-8');
      pipeline = JSON.parse(data);
    } catch (e) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }

    const agentName = req.params.agentName;
    if (!pipeline.context) pipeline.context = {};
    pipeline.context[agentName] = output;
    if (status) pipeline.status = status;

    await fs.writeFile(pipelinePath, JSON.stringify(pipeline, null, 2));
    io.emit('agent:submitted', { pipelineId, agentName, output, status });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 启动流水线
app.post('/api/pipelines/:id/start', async (req, res) => {
  try {
    const pipelinePath = path.join(ROOT, 'workspace', req.params.id, 'pipeline.json');
    let pipeline = {};
    try {
      const data = await fs.readFile(pipelinePath, 'utf-8');
      pipeline = JSON.parse(data);
    } catch (e) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }

    pipeline.status = 'running';
    if (pipeline.stages && pipeline.stages.length > 0) {
      pipeline.currentStage = pipeline.stages[0].role;
      pipeline.stages[0].status = 'running';
      pipeline.stages[0].startedAt = new Date().toISOString();
    }

    await fs.writeFile(pipelinePath, JSON.stringify(pipeline, null, 2));
    io.emit('pipeline:started', { pipelineId: req.params.id });
    res.json(pipeline);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 报告聚合 API ====================

app.get('/api/reports', async (req, res) => {
  try {
    const reports = await collectReports({ sprintManagerRef: sprintManager });
    res.json(reports);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:projectId/reports', async (req, res) => {
  try {
    const project = await projectManager.get(req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const reports = await collectReports({
      projectId: req.params.projectId,
      sprintManagerRef: sprintManager
    });
    res.json(reports);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 项目代码只读 API ====================

app.get('/api/projects/:id/code/files', async (req, res) => {
  try {
    const project = await projectManager.get(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const codePath = normalizeCodePath(project.codePath);
    if (!codePath) {
      return res.status(400).json({ error: 'Project code path is not configured' });
    }
    if (!fsSync.existsSync(codePath)) {
      return res.status(404).json({ error: 'Project code path does not exist' });
    }

    const stat = await fs.stat(codePath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Project code path is not a directory' });
    }

    const files = [];

    async function scanDir(dir, baseDir, depth = 0) {
      if (depth > 8) return;
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (SKIP_DIRS.has(item.name)) continue;
        const itemPath = path.join(dir, item.name);
        const relPath = path.relative(baseDir, itemPath).split(path.sep).join('/');
        if (item.isDirectory()) {
          files.push({ path: relPath, name: item.name, type: 'directory', size: 0 });
          await scanDir(itemPath, baseDir, depth + 1);
        } else {
          const itemStat = await fs.stat(itemPath);
          files.push({ path: relPath, name: item.name, type: 'file', size: itemStat.size });
        }
      }
    }

    await scanDir(codePath, codePath, 0);
    files.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    res.json({ codePath, files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id/code/content', async (req, res) => {
  try {
    const project = await projectManager.get(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const codePath = normalizeCodePath(project.codePath);
    if (!codePath) {
      return res.status(400).json({ error: 'Project code path is not configured' });
    }

    const fileRelPath = String(req.query.file || '').trim();
    if (!fileRelPath) {
      return res.status(400).json({ error: 'file is required' });
    }

    const fullPath = path.resolve(codePath, fileRelPath);
    if (!isPathInside(codePath, fullPath)) {
      return res.status(403).json({ error: 'Invalid file path' });
    }
    if (!fsSync.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
      return res.status(400).json({ error: 'Path is not a file' });
    }

    const fd = await fs.open(fullPath, 'r');
    let preview;
    let bytesRead;
    try {
      const buffer = Buffer.alloc(MAX_PREVIEW_BYTES + 1);
      const readResult = await fd.read(buffer, 0, buffer.length, 0);
      bytesRead = readResult.bytesRead;
      preview = buffer.subarray(0, bytesRead);
    } finally {
      await fd.close();
    }

    const hasBinary = preview.includes(0);
    if (hasBinary) {
      return res.json({
        type: 'binary',
        path: fileRelPath,
        name: path.basename(fullPath),
        size: stat.size,
        content: null,
        truncated: false
      });
    }

    const truncated = bytesRead > MAX_PREVIEW_BYTES;
    const textBuffer = truncated ? preview.subarray(0, MAX_PREVIEW_BYTES) : preview;
    const content = textBuffer.toString('utf-8');

    res.json({
      type: 'file',
      path: fileRelPath,
      name: path.basename(fullPath),
      size: stat.size,
      content,
      truncated
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== WebSocket ====================

io.on('connection', (socket) => {
  console.log('[WS] Client connected:', socket.id);

  socket.on('subscribe', (data) => {
    if (data.sprintId) {
      socket.join(`sprint:${data.sprintId}`);
      console.log(`[WS] ${socket.id} subscribed to sprint:${data.sprintId}`);
    }
    if (data.projectId) {
      socket.join(`project:${data.projectId}`);
      console.log(`[WS] ${socket.id} subscribed to project:${data.projectId}`);
    }
  });

  socket.on('unsubscribe', (data) => {
    if (data.sprintId) {
      socket.leave(`sprint:${data.sprintId}`);
    }
    if (data.projectId) {
      socket.leave(`project:${data.projectId}`);
    }
  });
  
  // 转发 agent:progress 事件给所有订阅的客户端
  socket.on('agent:progress', (data) => {
    if (data.sprintId) {
      io.to(`sprint:${data.sprintId}`).emit('agent:progress', data);
    }
  });

  socket.on('disconnect', () => {
    console.log('[WS] Client disconnected:', socket.id);
  });
});

// 获取模型配置
app.get('/api/config/models', async (req, res) => {
  try {
    const conf = await readModelConfig();
    res.json(conf);
  } catch (e) {
    res.json(getDefaultModelConfig());
  }
});

// 获取 OpenCode 可用模型列表（用于前端下拉，避免手填拼错）
app.get('/api/config/models/available', async (_req, res) => {
  try {
    const available = readOpenCodeModels();
    const fallback = Object.values(getDefaultModelConfig());
    const merged = Array.from(new Set([...available, ...fallback])).sort((a, b) => a.localeCompare(b));
    res.json({ models: merged });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 保存模型配置
app.put('/api/config/models', async (req, res) => {
  try {
    await fs.writeFile(MODELS_CONFIG_PATH, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 文件预览 API ====================

// 读取 sprint 输出文件内容
app.get('/api/sprints/:sprintId/file', async (req, res) => {
  try {
    const { file } = req.query;
    if (!file) {
      return res.status(400).json({ error: 'File path is required' });
    }

    const sprintId = req.params.sprintId;
    const baseWorkspacePath = path.join(ROOT, 'workspace', sprintId);
    
    // 获取 sprint 信息以获取 projectId
    let projectId = sprintId; // fallback
    try {
      const sprint = sprintManager.sprints?.get?.(sprintId);
      if (sprint?.projectId) projectId = sprint.projectId;
    } catch (e) {}
    
    const projectPath = path.join(ROOT, 'projects', projectId);

    // 历史兼容：提示词曾只落盘到 output/，而 Dashboard 预期 tester/*.md
    const legacyTesterAliases = [];
    if (file === 'tester/test-report.md') {
      legacyTesterAliases.push(path.join(baseWorkspacePath, 'output', 'test-report.md'));
    }
    if (file === 'tester/security-report.md') {
      legacyTesterAliases.push(path.join(baseWorkspacePath, 'output', 'security-report.md'));
      legacyTesterAliases.push(path.join(baseWorkspacePath, 'tester', 'security-scan.md'));
    }
    
    // 尝试多个可能的位置：先项目目录（代码/OpenSpec），再 workspace（执行记录）
    const possiblePaths = [
      ...legacyTesterAliases,
      path.join(projectPath, file),                             // 项目根目录文件
      path.join(projectPath, 'src', file),                      // src/ 代码文件
      path.join(projectPath, 'openspec', file),                 // openspec/ 文件
      path.join(baseWorkspacePath, 'output', file),             // output/ 执行记录
      path.join(baseWorkspacePath, file),                       // 根目录
      path.join(baseWorkspacePath, 'product', file),            // product/ 产品文档
      path.join(baseWorkspacePath, 'architect', file),          // architect/ 架构文档
      path.join(baseWorkspacePath, 'tech-coach', file),         // tech-coach/ 技术教练
      path.join(baseWorkspacePath, 'tester', file),             // tester/ 测试文档
      path.join(baseWorkspacePath, 'ops', file),                // ops/ 运维文档
      path.join(baseWorkspacePath, 'execution-log', file),      // execution-log/ 执行日志
    ];
    
    let fullPath = null;
    for (const p of possiblePaths) {
      if (fsSync.existsSync(p)) {
        fullPath = p;
        break;
      }
    }
    
    if (!fullPath) {
      return res.status(404).json({ error: 'File not found', searched: possiblePaths });
    }

    // 安全检查：防止路径穿越
    if (!fullPath.startsWith(baseWorkspacePath) && !fullPath.startsWith(projectPath)) {
      return res.status(403).json({ error: 'Invalid file path' });
    }

    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      // 如果是目录，返回目录结构
      async function getDirTree(dir, depth = 0) {
        if (depth > 2) return [];
        const items = await fs.readdir(dir, { withFileTypes: true });
        const result = [];
        for (const item of items) {
          if (['node_modules', '.git', 'dist'].includes(item.name)) continue;
          const itemPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            result.push({
              name: item.name,
              type: 'directory',
              children: await getDirTree(itemPath, depth + 1)
            });
          } else {
            const itemStat = await fs.stat(itemPath);
            result.push({
              name: item.name,
              type: 'file',
              size: itemStat.size
            });
          }
        }
        return result;
      }
      const tree = await getDirTree(fullPath);
      return res.json({ type: 'directory', tree });
    }

    // 读取文件内容
    const content = await fs.readFile(fullPath, 'utf-8');
    const ext = path.extname(fullPath).toLowerCase();
    
    res.json({
      type: 'file',
      name: path.basename(fullPath),
      ext,
      content,
      size: stat.size
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取 sprint 的实际文件列表
app.get('/api/sprints/:sprintId/files', async (req, res) => {
  try {
    const sprintId = req.params.sprintId;
    const basePath = path.join(ROOT, 'workspace', sprintId);
    
    // 获取 sprint 信息以获取 projectId
    let projectId = null;
    try {
      const sprint = sprintManager.sprints?.get?.(sprintId);
      if (sprint?.projectId) projectId = sprint.projectId;
    } catch (e) {}
    
    // 如果没有 projectId，从 sprintId 中提取 (格式: {projectId}-{uuid})
    if (!projectId) {
      const parts = sprintId.split('-');
      if (parts.length >= 5) {
        projectId = parts.slice(0, 5).join('-');
      } else {
        projectId = sprintId;
      }
    }
    
    const projectPath = path.join(ROOT, 'projects', projectId);
    const projectSrcPath = path.join(projectPath, 'src');
    
    if (!fsSync.existsSync(basePath) && !fsSync.existsSync(projectPath)) {
      return res.json({ files: [], message: '工作区不存在' });
    }
    
    // 定义各角色可能生成的文件（workspace 执行记录）
    const roleFileMap = {
      product: ['product/prd.md', 'product/prd.json', 'product/user-personas.md', 'product/user-stories.md', 'product/functional-requirements.md', 'product/ui-layout.md', 'product/user-journey.md'],
      architect: ['architect/architecture.md', 'architect/api-design.md', 'architect/database.md', 'architect/data-flow.md'],
      tech_coach: ['tech-coach/tech-implementation.md', 'output/user-stories.md', 'output/tech-feasibility.md'],
      developer: ['developer/README.md', 'developer/API.md', 'developer/dev-summary.md'],
      tester: ['tester/test-report.md', 'tester/security-report.md', 'tester/test-cases.md', 'tester/test-results.md', 'tester/security-scan.md'],
      ops: ['ops/Dockerfile', 'ops/docker-compose.yml', 'ops/ops-config.md', 'ops/env-analysis.md', 'ops/.github/workflows/deploy.yml']
    };
    
    const allFiles = [];
    
    // 遍历 workspace 文件（执行记录）
    for (const [role, files] of Object.entries(roleFileMap)) {
      for (const file of files) {
        const fullPath = path.join(basePath, file);
        const exists = fsSync.existsSync(fullPath);
        if (exists) {
          const stat = await fs.stat(fullPath);
          allFiles.push({
            role,
            name: path.basename(file),
            path: file,
            size: stat.size,
            exists: true,
            source: 'sprint'
          });
        }
      }
    }
    
    // 扫描项目代码文件
    if (fsSync.existsSync(projectSrcPath)) {
      try {
        async function scanProjectDir(dir, relPath) {
          const items = await fs.readdir(dir, { withFileTypes: true });
          for (const item of items) {
            if (['node_modules', '.git', 'dist', '.DS_Store'].includes(item.name)) continue;
            const itemPath = path.join(dir, item.name);
            const itemRelPath = relPath ? `${relPath}/${item.name}` : item.name;
            if (item.isDirectory()) {
              allFiles.push({
                role: 'developer',
                name: item.name + '/',
                path: `src/${itemRelPath}`,
                size: 0,
                exists: true,
                source: 'project',
                isDirectory: true
              });
              await scanProjectDir(itemPath, itemRelPath);
            } else {
              const stat = await fs.stat(itemPath);
              allFiles.push({
                role: 'developer',
                name: item.name,
                path: `src/${itemRelPath}`,
                size: stat.size,
                exists: true,
                source: 'project'
              });
            }
          }
        }
        await scanProjectDir(projectSrcPath, '');
      } catch (e) {
        // ignore
      }
    }
    
    // 扫描 OpenSpec change 目录（项目级）
    const openspecChangesDir = path.join(projectPath, 'openspec', 'changes');
    if (fsSync.existsSync(openspecChangesDir)) {
      try {
        const changes = await fs.readdir(openspecChangesDir);
        for (const changeName of changes) {
          const changeDir = path.join(openspecChangesDir, changeName);
          const changeFiles = await fs.readdir(changeDir);
          for (const file of changeFiles) {
            const filePath = `openspec/changes/${changeName}/${file}`;
            const fullPath = path.join(projectPath, filePath);
            const stat = await fs.stat(fullPath);
            allFiles.push({
              role: 'architect',
              name: `${changeName}/${file}`,
              path: filePath,
              size: stat.size,
              exists: true,
              source: 'project'
            });
          }
        }
      } catch (e) {
        // ignore
      }
    }
    
    res.json({ files: allFiles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sprints/:sprintId/developer/task-runs', async (req, res) => {
  try {
    const sprintId = req.params.sprintId;
    const dir = path.join(ROOT, 'workspace', sprintId, 'developer-task-runs');
    if (!fsSync.existsSync(dir)) {
      return res.json({ items: [] });
    }
    const entries = await fs.readdir(dir);
    const jsonFiles = entries.filter((f) => f.endsWith('.json')).sort((a, b) => a.localeCompare(b));
    const items = [];
    for (const file of jsonFiles) {
      const full = path.join(dir, file);
      try {
        const raw = await fs.readFile(full, 'utf-8');
        const data = JSON.parse(raw);
        items.push({
          taskIndex: data.taskIndex,
          totalTasks: data.totalTasks,
          title: data.title,
          status: data.status,
          riskLevel: data.riskLevel,
          errorCode: data.errorCode || '',
          message: data.message || '',
          noChangeReason: data.noChangeReason || '',
          writtenCount: data.writtenCount || 0,
          fileCount: Array.isArray(data.files) ? data.files.length : 0,
          updatedAt: data.updatedAt || ''
        });
      } catch (_e) {}
    }
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sprints/:sprintId/developer/task-runs/:taskIndex', async (req, res) => {
  try {
    const sprintId = req.params.sprintId;
    const taskIndex = parseInt(req.params.taskIndex, 10);
    if (!Number.isFinite(taskIndex) || taskIndex < 1) {
      return res.status(400).json({ error: 'taskIndex 非法' });
    }
    const filePath = path.join(
      ROOT,
      'workspace',
      sprintId,
      'developer-task-runs',
      `${String(taskIndex).padStart(3, '0')}.json`
    );
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ error: 'task run not found' });
    }
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sprints/:sprintId/developer/state', async (req, res) => {
  try {
    const sprint = await sprintManager.get(req.params.sprintId);
    if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
    const it = (sprint.iterations || []).find((x) => x.role === 'developer');
    if (!it) return res.status(404).json({ error: 'Developer iteration not found' });

    const tasksPath = await resolveLatestTasksPathForSprint(sprint);
    let totalTasks = 0;
    let currentTask = null;
    if (tasksPath && fsSync.existsSync(tasksPath)) {
      const tasksMd = await fs.readFile(tasksPath, 'utf-8');
      const tasks = parseTasksFromMarkdown(tasksMd);
      totalTasks = tasks.length;
      const cursor = Math.max(1, Number(it.developerTaskCursor || 1));
      if (cursor >= 1 && cursor <= tasks.length) {
        currentTask = {
          taskIndex: cursor,
          text: tasks[cursor - 1].text,
          h2: tasks[cursor - 1].h2,
          h3: tasks[cursor - 1].h3
        };
      }
    }

    res.json({
      roleIndex: it.roleIndex,
      cursor: Math.max(1, Number(it.developerTaskCursor || 1)),
      runningTaskIndex: it.developerRunningTaskIndex || null,
      totalTasks,
      currentTask
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 启动服务器
async function start() {
  await ensureDirs();
  await projectManager.load();
  await sprintManager.load();
  
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  const localIP = getLocalIP();
  httpServer.listen(PORT, HOST, () => {
    if (HARNESS_WARMUP_ON_START) {
      ensureHarness().catch(() => {});
    }
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║          AI Coding PasS API Server                    ║
║                                                           ║
║  HTTP:      http://${localIP}:${PORT}                         ║
║  HTTP:      http://localhost:${PORT}                         ║
║  WebSocket: ws://${localIP}:${PORT}                           ║
║                                                           ║
║  Endpoints:                                              ║
║  - POST   /api/projects           Create project          ║
║  - GET    /api/projects           List projects           ║
║  - GET    /api/projects/:id       Get project             ║
║  - PUT    /api/projects/:id       Update project          ║
║  - DELETE /api/projects/:id       Delete project          ║
║  - POST   /api/projects/:p/sprints Create sprint          ║
║  - GET    /api/projects/:p/sprints List sprints            ║
║  - GET    /api/sprints/:id         Get sprint              ║
║  - PUT    /api/sprints/:id/iterations/:i/input User input ║
║  - PUT    /api/sprints/:id/iterations/:i/confirm Confirm  ║
║  - POST   /api/sprints/:id/iterations/:i/rerun Rerun      ║
║  - PUT    /api/sprints/:id/iterations/:i/output Agent out ║
║  - POST   /api/sprints/:id/start  Start sprint            ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);
