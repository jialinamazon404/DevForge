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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// 配置路径 - 新结构 projects/{projectId}/sprints/{sprintId}/
const PROJECTS_DIR = path.join(ROOT, 'projects');
const AI_AGENT_EXECUTOR = path.join(ROOT, 'ai-agent-executor.js');

// BUILD 流程默认角色
const DEFAULT_ROLES = ['product', 'architect', 'scout', 'developer', 'tester', 'ops', 'evolver'];

// 角色信息
const ROLE_INFO = {
  product: { icon: '📋', name: '产品经理', name_en: 'Product Manager' },
  architect: { icon: '🏗️', name: '架构师', name_en: 'Architect' },
  scout: { icon: '🔍', name: '侦察兵', name_en: 'Scout' },
  developer: { icon: '💻', name: '开发者', name_en: 'Developer' },
  tester: { icon: '🧪', name: '测试工程师', name_en: 'Tester' },
  ops: { icon: '⚙️', name: '运维工程师', name_en: 'DevOps' },
  evolver: { icon: '🔄', name: '进化顾问', name_en: 'Evolver' }
};

// 跟踪运行中的 agent 进程
const runningAgents = new Map();

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
    const project = {
      id,
      name: data.name,
      description: data.description || '',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.projects.set(id, project);
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
    Object.assign(project, updates, { updatedAt: new Date().toISOString() });
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
    const id = uuidv4();
    const sprintNumber = (this.sprints.size || 0) + 1;

    const sprint = {
      id,
      projectId,
      name: data.name || `Sprint #${sprintNumber}`,
      goal: data.goal || '',
      rawInput: data.rawInput || '',
      localProjectPath: data.localProjectPath || null,
      status: 'pending',
      roles: [...DEFAULT_ROLES],
      currentRoleIndex: 0,
      iterations: DEFAULT_ROLES.map((role, index) => ({
        role,
        roleInfo: ROLE_INFO[role],
        status: 'pending',
        userInput: '',
        output: '',
        history: [],
        startedAt: null,
        completedAt: null
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.sprints.set(id, sprint);
    await this.save(id);
    return sprint;
  }

  async get(id) {
    return this.sprints.get(id);
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

// 确保目录存在
async function ensureDirs() {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
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

    iteration.status = 'confirmed';
    iteration.completedAt = new Date().toISOString();

    // 移动到下一个角色，并设置为 ready 状态
    if (roleIndex < sprint.iterations.length - 1) {
      sprint.currentRoleIndex = roleIndex + 1;
      sprint.status = 'running';
      // 设置下一角色为 ready，允许前端执行
      sprint.iterations[sprint.currentRoleIndex].status = 'ready';
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

    // 重置状态，准备重新执行
    iteration.status = 'ready';
    iteration.startedAt = new Date().toISOString();
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
    iteration.status = req.body.status || 'completed';
    iteration.completedAt = iteration.completedAt || new Date().toISOString();

    await sprintManager.save(sprint.id);
    io.emit('iteration:output:updated', { sprintId: sprint.id, roleIndex, iteration });
    res.json(iteration);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 触发 Agent 执行
const AI_AGENT_EXECUTOR_SPRINT = path.join(ROOT, 'sprint-agent-executor.js');

app.post('/api/sprints/:sprintId/iterations/:roleIndex/execute', async (req, res) => {
  try {
    const sprintId = req.params.sprintId;
    const roleIndex = parseInt(req.params.roleIndex);

    const sprint = await sprintManager.get(sprintId);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    const iteration = sprint.iterations[roleIndex];
    if (!iteration) {
      return res.status(404).json({ error: 'Iteration not found' });
    }

    // 检查是否有用户输入
    if (!iteration.userInput && roleIndex > 0) {
      return res.status(400).json({ error: '需要用户先输入' });
    }

    // 更新状态为运行中
    iteration.status = 'running';
    iteration.startedAt = new Date().toISOString();
    await sprintManager.save(sprint.id);

    // 启动 Agent Executor 进程
    console.log(`🚀 启动 Agent Executor for sprint ${sprintId.slice(0, 8)}, role ${roleIndex}`);

    const apiPort = process.env.PORT || 3000;
    const agentProc = spawn('node', [AI_AGENT_EXECUTOR_SPRINT, sprintId, roleIndex.toString()], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, API_BASE: `http://localhost:${apiPort}` }
    });

    runningAgents.set(`${sprintId}-${roleIndex}`, agentProc);

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

    agentProc.on('close', (code) => {
      console.log(`[agent] Process exited with code ${code}`);
      runningAgents.delete(`${sprintId}-${roleIndex}`);
      
      // 等待一下让 agentProc 完全结束，然后更新状态
      setTimeout(async () => {
        try {
          const sprint = await sprintManager.get(sprintId);
          if (sprint && sprint.iterations[roleIndex]) {
            // 只有当输出不为空时才标记为 completed，否则标记为 waiting_input
            const output = sprint.iterations[roleIndex].output;
            if (output && output !== '正在执行...' && !output.includes('执行失败')) {
              sprint.iterations[roleIndex].status = 'completed';
            } else {
              sprint.iterations[roleIndex].status = 'waiting_input';
            }
            await sprintManager.save(sprintId);
            io.emit('iteration:confirmed', { sprintId, roleIndex });
          }
        } catch (e) {
          console.error('更新 iteration 状态失败:', e.message);
        }
      }, 1000);
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

  socket.on('disconnect', () => {
    console.log('[WS] Client disconnected:', socket.id);
  });
});

// 启动服务器
async function start() {
  await ensureDirs();
  await projectManager.load();
  await sprintManager.load();
  
  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║          AI Team Pipeline API Server                      ║
║                                                           ║
║  HTTP:      http://localhost:${PORT}                         ║
║  WebSocket: ws://localhost:${PORT}                           ║
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
