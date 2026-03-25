import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// 配置路径 - 统一使用 workspace/{uuid}/ 结构
const WORKSPACE_DIR = path.join(ROOT, 'workspace');
const AGENT_RUNNER = path.join(ROOT, 'gatekeeper.js');

function getPipelinePath(pipelineId) {
  return path.join(WORKSPACE_DIR, pipelineId);
}

function getPipelineJsonPath(pipelineId) {
  return path.join(getPipelinePath(pipelineId), 'pipeline.json');
}

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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== 认证 API ====================

// 简单用户认证（生产环境应使用数据库）
const USERS = {
  admin: { password: 'admin', name: '管理员', role: 'admin' }
};

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

// 决策树路由
const ROUTES = {
  CRITICAL: ['product', 'architect', 'creative', 'developer', 'tester', 'evolver'],
  BUILD: ['product', 'architect', 'scout', 'developer', 'tester', 'ops', 'evolver'],
  REVIEW: ['creative', 'ghost', 'tester'],
  QUERY: ['scout'],
  SECURITY: ['ghost', 'architect']
};

// 确保目录存在
async function ensureDirs() {
  await fs.mkdir(WORKSPACE_DIR, { recursive: true });
}

// 状态管理
class StateManager {
  constructor() {
    this.pipelines = new Map();
  }

  async load() {
    try {
      const entries = await fs.readdir(WORKSPACE_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pipelineJsonPath = getPipelineJsonPath(entry.name);
          try {
            const data = await fs.readFile(pipelineJsonPath, 'utf-8');
            const pipeline = JSON.parse(data);
            this.pipelines.set(entry.name, pipeline);
          } catch (e) {
            // 跳过无效的目录
          }
        }
      }
    } catch (e) {
      // 目录不存在，从头开始
    }
  }

  async save(pipelineId) {
    const pipeline = this.pipelines.get(pipelineId);
    if (pipeline) {
      await fs.writeFile(getPipelineJsonPath(pipelineId), JSON.stringify(pipeline, null, 2));
    }
  }

  async create(request) {
    const id = uuidv4();
    const route = ROUTES[request.category] || ROUTES.BUILD;
    
    const pipeline = {
      id,
      status: 'pending',
      currentStage: 'pending',
      category: request.category,
      priority: request.priority || 'MEDIUM',
      rawInput: request.rawInput,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      context: {
        request,
        workspacePath: `workspace/${id}`,
        openSpec: null,
        findings: [],
        artifacts: {},
        testReport: null
      },
      stages: route.map(role => ({
        role,
        status: 'pending',
        startedAt: null,
        completedAt: null,
        output: null,
        error: null
      })),
      logs: []
    };

    this.pipelines.set(id, pipeline);
    
    // 创建统一目录结构
    const basePath = getPipelinePath(id);
    await fs.mkdir(basePath, { recursive: true });
    await fs.mkdir(path.join(basePath, 'logs'), { recursive: true });
    await fs.mkdir(path.join(basePath, 'thinking'), { recursive: true });
    await fs.mkdir(path.join(basePath, 'output'), { recursive: true });
    
    // Agent 工作目录 (保留用于存放具体文件)
    await fs.mkdir(path.join(basePath, 'product'), { recursive: true });
    await fs.mkdir(path.join(basePath, 'architect'), { recursive: true });
    await fs.mkdir(path.join(basePath, 'scout'), { recursive: true });
    await fs.mkdir(path.join(basePath, 'developer'), { recursive: true });
    await fs.mkdir(path.join(basePath, 'tester', 'bugs'), { recursive: true });
    await fs.mkdir(path.join(basePath, 'ops'), { recursive: true });
    await fs.mkdir(path.join(basePath, 'ghost'), { recursive: true });
    await fs.mkdir(path.join(basePath, 'creative'), { recursive: true });
    await fs.mkdir(path.join(basePath, 'evolver'), { recursive: true });
    
    await this.save(id);
    return pipeline;
  }

  async get(id) {
    return this.pipelines.get(id);
  }

  async getAll() {
    return Array.from(this.pipelines.values());
  }

  async update(id, updates) {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return null;
    
    Object.assign(pipeline, updates, { updatedAt: new Date().toISOString() });
    await this.save(id);
    return pipeline;
  }

  async updateStage(id, role, updates) {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return null;
    
    const stage = pipeline.stages.find(s => s.role === role);
    if (stage) {
      Object.assign(stage, updates);
    }
    await this.save(id);
    return pipeline;
  }

  async addLog(id, log) {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return;
    
    pipeline.logs.push({
      timestamp: new Date().toISOString(),
      ...log
    });
    await this.save(id);
  }

  async delete(id) {
    this.pipelines.delete(id);
    await fs.rm(getPipelinePath(id), { recursive: true, force: true });
  }

  async getNextStage(id) {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return null;
    
    const pendingStage = pipeline.stages.find(s => s.status === 'pending');
    return pendingStage?.role || null;
  }
}

const stateManager = new StateManager();

// ==================== REST API ====================

// 创建流水线
app.post('/api/pipelines', async (req, res) => {
  try {
    const pipeline = await stateManager.create(req.body);
    io.emit('pipeline:created', pipeline);
    res.status(201).json(pipeline);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取所有流水线
app.get('/api/pipelines', async (req, res) => {
  try {
    const pipelines = await stateManager.getAll();
    res.json(pipelines);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取单个流水线
app.get('/api/pipelines/:id', async (req, res) => {
  try {
    const pipeline = await stateManager.get(req.params.id);
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    res.json(pipeline);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新流水线
app.put('/api/pipelines/:id', async (req, res) => {
  try {
    const pipeline = await stateManager.update(req.params.id, req.body);
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    io.emit('pipeline:updated', pipeline);
    res.json(pipeline);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除流水线
app.delete('/api/pipelines/:id', async (req, res) => {
  try {
    await stateManager.delete(req.params.id);
    io.emit('pipeline:deleted', { id: req.params.id });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 停止流水线
app.post('/api/pipelines/:id/stop', async (req, res) => {
  try {
    const pipelineId = req.params.id;
    
    // 停止运行中的 agent 进程
    const proc = runningAgents.get(pipelineId);
    if (proc) {
      proc.kill();
      runningAgents.delete(pipelineId);
      console.log(`🛑 已停止 pipeline ${pipelineId.slice(0, 8)} 的 agent 进程`);
    }
    
    const pipeline = await stateManager.update(pipelineId, { status: 'stopped' });
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    io.emit('pipeline:stopped', pipeline);
    res.json(pipeline);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 暂停流水线
app.post('/api/pipelines/:id/pause', async (req, res) => {
  try {
    const pipelineId = req.params.id;
    const pipeline = await stateManager.update(pipelineId, { 
      status: 'paused',
      pausedAt: new Date().toISOString()
    });
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    
    // 暂停 agent 进程（发送 SIGSTOP 信号）
    const proc = runningAgents.get(pipelineId);
    if (proc) {
      proc.kill('SIGSTOP');
      console.log(`⏸️ 已暂停 pipeline ${pipelineId.slice(0, 8)} 的 agent 进程`);
    }
    
    io.emit('pipeline:paused', pipeline);
    res.json(pipeline);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 放弃流水线
app.post('/api/pipelines/:id/abandon', async (req, res) => {
  try {
    const pipelineId = req.params.id;
    
    // 停止运行中的 agent 进程
    const proc = runningAgents.get(pipelineId);
    if (proc) {
      proc.kill();
      runningAgents.delete(pipelineId);
      console.log(`❌ 已终止 pipeline ${pipelineId.slice(0, 8)} 的 agent 进程`);
    }
    
    const pipeline = await stateManager.update(pipelineId, { 
      status: 'abandoned',
      abandonedAt: new Date().toISOString(),
      abandonedReason: req.body.reason || '用户主动放弃'
    });
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    io.emit('pipeline:abandoned', pipeline);
    res.json(pipeline);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 启动流水线
app.post('/api/pipelines/:id/start', async (req, res) => {
  try {
    const pipelineId = req.params.id;
    const pipeline = await stateManager.update(pipelineId, { 
      status: 'running',
      currentStage: await stateManager.getNextStage(pipelineId)
    });
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    
    // 启动 agent-runner 进程
    console.log(`🚀 启动 agent-runner for pipeline ${pipelineId.slice(0, 8)}`);
    
    const agentProc = spawn('node', [AGENT_RUNNER, pipelineId], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    runningAgents.set(pipelineId, agentProc);
    
    agentProc.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[agent] ${output}`);
      stateManager.addLog(pipelineId, { 
        type: 'agent_log', 
        message: output 
      });
      io.emit('agent:output', { pipelineId, output });
    });
    
    agentProc.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`[agent:error] ${output}`);
      stateManager.addLog(pipelineId, { 
        type: 'agent_error', 
        message: output 
      });
    });
    
    agentProc.on('close', (code) => {
      console.log(`[agent] Process exited with code ${code}`);
      runningAgents.delete(pipelineId);
    });
    
    io.emit('pipeline:started', pipeline);
    res.json(pipeline);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 用户选择（架构师技术栈选择）
app.post('/api/pipelines/:id/select', async (req, res) => {
  try {
    const { option, message } = req.body;
    const pipeline = await stateManager.get(req.params.id);
    
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    
    // 存储用户选择到 context
    pipeline.context.userSelection = {
      option,
      message,
      timestamp: new Date().toISOString()
    };
    
    // 如果架构师正在等待选择，标记为已收到选择
    if (pipeline.status === 'waiting_selection') {
      pipeline.status = 'running';
    }
    
    await stateManager.save(req.params.id);
    
    // 通知客户端
    io.emit('pipeline:selection:made', { 
      pipelineId: req.params.id, 
      option,
      message 
    });
    
    res.json({ success: true, selection: { option, message } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取用户选择
app.get('/api/pipelines/:id/selection', async (req, res) => {
  try {
    const pipeline = await stateManager.get(req.params.id);
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    res.json(pipeline.context.userSelection || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent 提交输出
app.post('/api/agent/:name/submit', async (req, res) => {
  try {
    const { pipelineId, output, status } = req.body;
    const pipeline = await stateManager.get(pipelineId);
    
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }

    // 更新当前阶段状态
    await stateManager.updateStage(pipelineId, req.params.name, {
      status,
      output,
      completedAt: new Date().toISOString()
    });

    await stateManager.addLog(pipelineId, {
      agent: req.params.name,
      status,
      message: `Agent ${req.params.name} completed`
    });

    // 找到下一个阶段
    const nextStage = await stateManager.getNextStage(pipelineId);
    
    if (nextStage) {
      await stateManager.update(pipelineId, { 
        currentStage: nextStage,
        status: 'running'
      });
    } else {
      await stateManager.update(pipelineId, { 
        status: 'completed',
        currentStage: 'done'
      });
    }

    const updatedPipeline = await stateManager.get(pipelineId);
    io.emit('pipeline:stage:completed', { pipelineId, agent: req.params.name, nextStage });
    io.emit('pipeline:updated', updatedPipeline);

    res.json({ success: true, nextStage });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取下一个任务
app.get('/api/agent/:name/next', async (req, res) => {
  try {
    const { status } = req.query;
    const pipelines = await stateManager.getAll();
    
    // 找到等待该 Agent 的流水线
    const waiting = pipelines.find(p => 
      p.status === 'running' && 
      p.currentStage === req.params.name &&
      p.context.request?.status !== 'completed'
    );

    if (waiting) {
      res.json({
        pipelineId: waiting.id,
        category: waiting.category,
        context: waiting.context,
        previousStage: waiting.stages.find(s => s.status === 'completed')?.role
      });
    } else {
      res.json({ pipelineId: null });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取日志
app.get('/api/pipelines/:id/logs', async (req, res) => {
  try {
    const pipeline = await stateManager.get(req.params.id);
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    res.json(pipeline.logs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 测试报告
app.get('/api/reports', async (req, res) => {
  try {
    const pipelines = await stateManager.getAll();
    const reports = [];
    
    for (const pipeline of pipelines) {
      if (pipeline.context.testReport) {
        reports.push(pipeline.context.testReport);
      }
    }
    
    res.json(reports);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/reports/:id', async (req, res) => {
  try {
    const specsPath = path.join(getPipelinePath(req.params.id), 'specs');
    const files = await fs.readdir(specsPath);
    const reportFile = files.find(f => f.startsWith('test-report'));
    
    if (reportFile) {
      const content = await fs.readFile(path.join(specsPath, reportFile), 'utf-8');
      res.json(JSON.parse(content));
    } else {
      res.status(404).json({ error: 'Report not found' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取 workspace 文件列表
app.get('/api/workspace/:pipelineId', async (req, res) => {
  try {
    const workspacePath = path.join(WORKSPACE_DIR, req.params.pipelineId);
    
    async function getFiles(dir, baseDir = dir) {
      const items = await fs.readdir(dir, { withFileTypes: true });
      const result = [];
      
      for (const item of items) {
        const itemPath = path.join(dir, item.name);
        const relativePath = path.relative(baseDir, itemPath);
        
        if (item.isDirectory()) {
          result.push({
            name: item.name,
            path: relativePath,
            type: 'directory',
            children: await getFiles(itemPath, baseDir)
          });
        } else {
          const stat = await fs.stat(itemPath);
          result.push({
            name: item.name,
            path: relativePath,
            type: 'file',
            size: stat.size,
            modified: stat.mtime
          });
        }
      }
      
      return result;
    }
    
    const files = await getFiles(workspacePath);
    res.json(files);
  } catch (e) {
    res.status(404).json({ error: 'Pipeline not found' });
  }
});

// 获取 thinking 内容
app.get('/api/pipelines/:id/thinking', async (req, res) => {
  try {
    const thinkingDir = path.join(WORKSPACE_DIR, req.params.id, 'thinking');
    const files = await fs.readdir(thinkingDir);
    
    const thinking = [];
    for (const file of files.sort()) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(path.join(thinkingDir, file), 'utf-8');
        thinking.push({ file, data: JSON.parse(content) });
      }
    }
    
    res.json(thinking);
  } catch (e) {
    res.status(404).json({ error: 'Thinking not found' });
  }
});

// 获取 output 内容
app.get('/api/pipelines/:id/output', async (req, res) => {
  try {
    const outputDir = path.join(WORKSPACE_DIR, req.params.id, 'output');
    const files = await fs.readdir(outputDir);
    
    const outputs = [];
    for (const file of files) {
      const filePath = path.join(outputDir, file);
      const stat = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      outputs.push({ 
        file, 
        type: file.endsWith('.json') ? 'json' : 'markdown',
        data: file.endsWith('.json') ? JSON.parse(content) : content,
        size: stat.size,
        modified: stat.mtime
      });
    }
    
    res.json(outputs);
  } catch (e) {
    res.status(404).json({ error: 'Output not found' });
  }
});

// 获取单个阶段状态
app.get('/api/pipelines/:id/stage/:stageIndex', async (req, res) => {
  try {
    const pipeline = await stateManager.get(req.params.id);
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    
    const stage = pipeline.stages[parseInt(req.params.stageIndex)];
    if (!stage) {
      return res.status(404).json({ error: 'Stage not found' });
    }
    
    // 读取对应的 thinking 和 output
    const thinkingFile = path.join(WORKSPACE_DIR, req.params.id, 'thinking', 
      `${String(parseInt(req.params.stageIndex) + 1).padStart(2, '0')}-${stage.role}.json`);
    const outputFile = path.join(WORKSPACE_DIR, req.params.id, 'output', 
      stage.role === 'product' ? 'prd.md' : 
      stage.role === 'architect' ? 'openspec.md' : 
      `${stage.role}-report.md`);
    
    let thinking = null;
    let output = null;
    
    try {
      thinking = JSON.parse(await fs.readFile(thinkingFile, 'utf-8'));
    } catch {}
    
    try {
      output = await fs.readFile(outputFile, 'utf-8');
    } catch {}
    
    res.json({ ...stage, thinking, output });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取流水线树状状态（用于 Dashboard 展示）
app.get('/api/pipelines/:id/tree', async (req, res) => {
  try {
    const pipeline = await stateManager.get(req.params.id);
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    
    const definitions = JSON.parse(
      await fs.readFile(path.join(ROOT, 'agents', 'definitions.json'), 'utf-8')
    );
    
    const tree = pipeline.stages.map((stage, index) => {
      const agent = definitions.agents[stage.role];
      return {
        index,
        role: stage.role,
        icon: agent?.icon || '❓',
        name: agent?.name || stage.role,
        name_en: agent?.name_en || stage.role,
        goal: agent?.goal || stage.goal || '',
        status: stage.status,
        duration: stage.duration,
        startedAt: stage.startedAt,
        completedAt: stage.completedAt,
        thinkingFile: `thinking/${String(index + 1).padStart(2, '0')}-${stage.role}.json`,
        outputFile: `output/${stage.role === 'product' ? 'prd' : stage.role === 'architect' ? 'openspec' : stage.role}-${['product', 'architect'].includes(stage.role) ? 'md' : 'report.md'}`
      };
    });
    
    res.json({
      id: pipeline.id,
      status: pipeline.status,
      category: pipeline.category,
      rawInput: pipeline.rawInput,
      stages: tree,
      currentStage: pipeline.currentStage,
      progress: `${pipeline.stages.filter(s => s.status === 'completed').length}/${pipeline.stages.length}`
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 读取 workspace 文件内容
app.get('/api/workspace/:pipelineId/*', async (req, res) => {
  try {
    const filePath = req.params[0];
    const fullPath = path.join(WORKSPACE_DIR, req.params.pipelineId, filePath);
    
    const content = await fs.readFile(fullPath, 'utf-8');
    res.type('text/plain').send(content);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== WebSocket ====================

io.on('connection', (socket) => {
  console.log('[WS] Client connected:', socket.id);

  socket.on('subscribe', (data) => {
    if (data.pipelineId) {
      socket.join(`pipeline:${data.pipelineId}`);
      console.log(`[WS] ${socket.id} subscribed to pipeline:${data.pipelineId}`);
    }
  });

  socket.on('unsubscribe', (data) => {
    if (data.pipelineId) {
      socket.leave(`pipeline:${data.pipelineId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('[WS] Client disconnected:', socket.id);
  });
});

// 启动服务器
async function start() {
  await ensureDirs();
  await stateManager.load();
  
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
║  - POST   /api/pipelines          Create pipeline         ║
║  - GET    /api/pipelines          List pipelines          ║
║  - GET    /api/pipelines/:id      Get pipeline            ║
║  - PUT    /api/pipelines/:id      Update pipeline         ║
║  - DELETE /api/pipelines/:id      Delete pipeline         ║
║  - POST   /api/pipelines/:id/start Start pipeline         ║
║  - POST   /api/pipelines/:id/stop  Stop pipeline          ║
║  - GET    /api/pipelines/:id/logs  Get logs              ║
║  - POST   /api/agent/:name/submit  Agent submit           ║
║  - GET    /api/agent/:name/next    Agent next task       ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);
