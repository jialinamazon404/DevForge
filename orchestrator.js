#!/usr/bin/env node
/**
 * AI Team Pipeline Orchestrator (守门人 Gatekeeper)
 * 
 * 职责:
 * - 维护中央状态机
 * - 路由决策
 * - 派发 Agent 任务
 * - 监控执行状态
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { ROUTES } from './config/pipelineConfig.js';
import { ROLE_NAMES } from './config/pipelineConfig.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
import fsSync from 'fs';

// 结构与角色映射从 config/pipelineConfig.js 获取
const LOG_PATH = path.join(ROOT, 'logs', 'gatekeeper.log');

class Orchestrator {
  constructor() {
    this.pipelines = new Map();
    this.agents = new Map();
  }

  async init() {
    // 确保目录存在
    await fs.mkdir(path.join(ROOT, 'state', 'pipelines'), { recursive: true });
    await fs.mkdir(path.join(ROOT, 'specs'), { recursive: true });
    await fs.mkdir(path.join(ROOT, 'logs'), { recursive: true });
    await fs.mkdir(path.join(ROOT, 'workspace'), { recursive: true });
    
    // 加载已有状态
    await this.loadState();
    
    console.log('🛡️  守门人已启动');
    console.log(`📊 当前流水线: ${this.pipelines.size}`);
  }

  async loadState() {
    try {
      const stateFile = path.join(ROOT, 'state', 'pipelines.json');
      const data = await fs.readFile(stateFile, 'utf-8');
      const parsed = JSON.parse(data);
      for (const [id, pipeline] of Object.entries(parsed)) {
        this.pipelines.set(id, pipeline);
      }
    } catch (e) {
      // 首次运行，无状态
    }
  }

  async saveState() {
    const data = {};
    for (const [id, pipeline] of this.pipelines) {
      data[id] = pipeline;
    }
    await fs.writeFile(
      path.join(ROOT, 'state', 'pipelines.json'),
      JSON.stringify(data, null, 2)
    );
  }

  createPipeline(request) {
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
    this.saveState();
    
    return pipeline;
  }

  getPipeline(id) {
    return this.pipelines.get(id);
  }

  getAllPipelines() {
    return Array.from(this.pipelines.values());
  }

  getNextStage(id) {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return null;
    
    const pendingStage = pipeline.stages.find(s => s.status === 'pending');
    return pendingStage?.role || null;
  }

  updatePipelineStatus(id, status) {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return null;
    
    pipeline.status = status;
    pipeline.updatedAt = new Date().toISOString();
    this.saveState();
    return pipeline;
  }

  startPipeline(id) {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return null;
    
    const nextStage = this.getNextStage(id);
    if (!nextStage) {
      pipeline.status = 'completed';
      return pipeline;
    }

    pipeline.status = 'running';
    pipeline.currentStage = nextStage;
    pipeline.updatedAt = new Date().toISOString();
    
    // 标记阶段开始
    const stage = pipeline.stages.find(s => s.role === nextStage);
    if (stage) {
      stage.status = 'running';
      stage.startedAt = new Date().toISOString();
    }
    
    this.saveState();
    return pipeline;
  }

  completeStage(id, role, output, error = null) {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return null;
    
    const stage = pipeline.stages.find(s => s.role === role);
    if (stage) {
      stage.status = error ? 'failed' : 'completed';
      stage.completedAt = new Date().toISOString();
      stage.output = output;
      stage.error = error;
    }
    
    // 记录日志
    pipeline.logs.push({
      timestamp: new Date().toISOString(),
      agent: role,
      status: error ? 'failed' : 'completed',
      message: `Agent ${ROLE_NAMES[role]} 完成`
    });
    
    // 更新 context
    if (output) {
      if (role === 'architect' && output.openSpec) {
        pipeline.context.openSpec = output.openSpec;
      } else if (role === 'tech_coach' && output.findings) {
        pipeline.context.findings = output.findings;
      } else if (role === 'tester' && output.testReport) {
        pipeline.context.testReport = output.testReport;
      }
    }
    
    // 如果是架构师且有选项需要选择，暂停流水线
    if (role === 'architect' && output?.options && !pipeline.context.userSelection) {
      pipeline.status = 'waiting_selection';
      pipeline.currentStage = 'architect';
      pipeline.updatedAt = new Date().toISOString();
      this.saveState();
      return { pipeline, nextStage: 'architect', waitingSelection: true };
    }
    
    // 查找下一个阶段
    const nextStage = this.getNextStage(id);
    
    if (nextStage) {
      const next = pipeline.stages.find(s => s.role === nextStage);
      if (next) {
        next.status = 'running';
        next.startedAt = new Date().toISOString();
      }
      pipeline.currentStage = nextStage;
      pipeline.status = 'running';
    } else {
      pipeline.status = 'completed';
      pipeline.currentStage = 'done';
    }
    
    pipeline.updatedAt = new Date().toISOString();
    this.saveState();
    
    return { pipeline, nextStage, waitingSelection: false };
  }

  addLog(id, agent, message) {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      agent,
      message
    };
    pipeline.logs.push(logEntry);

    // 额外写入磁盘日志，便于持久化与排错
    try {
      fsSync.appendFileSync(LOG_PATH, `[${logEntry.timestamp}] ${agent} - ${message}\n`);
    } catch (e) {
      // ignore disk write errors
    }
    this.saveState();
  }

  // 获取 Agent 的下一个任务
  getNextTask(agentName) {
    for (const pipeline of this.pipelines.values()) {
      if (pipeline.status === 'running' && pipeline.currentStage === agentName) {
        return {
          pipelineId: pipeline.id,
          category: pipeline.category,
          context: pipeline.context,
          previousStage: pipeline.stages
            .filter(s => s.status === 'completed')
            .pop()?.role
        };
      }
    }
    return null;
  }

  // 获取等待中的任务列表
  getWaitingTasks() {
    const tasks = [];
    for (const pipeline of this.pipelines.values()) {
      if (pipeline.status === 'pending' || pipeline.status === 'running') {
        tasks.push({
          pipelineId: pipeline.id,
          category: pipeline.category,
          currentStage: pipeline.currentStage,
          status: pipeline.status
        });
      }
    }
    return tasks;
  }

  // 统计信息
  getStats() {
    const pipelines = this.getAllPipelines();
    return {
      total: pipelines.length,
      pending: pipelines.filter(p => p.status === 'pending').length,
      running: pipelines.filter(p => p.status === 'running').length,
      completed: pipelines.filter(p => p.status === 'completed').length,
      failed: pipelines.filter(p => p.status === 'failed').length
    };
  }
}

// 导出单例
export const orchestrator = new Orchestrator();

// CLI 界面
async function runCLI() {
  await orchestrator.init();
  
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  function prompt() {
    rl.question('\n守门人> ', async (cmd) => {
      const [action, ...args] = cmd.trim().split(' ');
      
      switch (action) {
        case 'list':
          console.log('\n📋 流水线列表:');
          const pipelines = orchestrator.getAllPipelines();
          if (pipelines.length === 0) {
            console.log('  暂无流水线');
          } else {
            pipelines.forEach(p => {
              console.log(`  [${p.status}] ${p.id.slice(0, 8)} - ${p.category} - ${p.currentStage}`);
            });
          }
          break;
          
        case 'stats':
          const stats = orchestrator.getStats();
          console.log('\n📊 统计:');
          console.log(`  总计: ${stats.total}`);
          console.log(`  待处理: ${stats.pending}`);
          console.log(`  运行中: ${stats.running}`);
          console.log(`  已完成: ${stats.completed}`);
          console.log(`  失败: ${stats.failed}`);
          break;
          
        case 'create':
          const category = args[0] || 'BUILD';
          const rawInput = args.slice(1).join(' ') || '测试请求';
          const pipeline = orchestrator.createPipeline({
            rawInput,
            category,
            priority: 'MEDIUM'
          });
          console.log(`\n✅ 创建流水线: ${pipeline.id.slice(0, 8)}`);
          console.log(`   路由: ${pipeline.stages.map(s => ROLE_NAMES[s.role]).join(' → ')}`);
          break;
          
        case 'start':
          const startId = args[0];
          if (!startId) {
            console.log('用法: start <pipeline-id>');
          } else {
            const p = orchestrator.startPipeline(startId);
            if (p) {
              console.log(`\n▶️  启动流水线: ${p.id.slice(0, 8)}`);
              console.log(`   当前阶段: ${ROLE_NAMES[p.currentStage] || p.currentStage}`);
            } else {
              console.log(`\n❌ 未找到流水线: ${startId}`);
            }
          }
          break;
          
        case 'status':
          const statusId = args[0];
          if (!statusId) {
            console.log('用法: status <pipeline-id>');
          } else {
            const p = orchestrator.getPipeline(statusId);
            if (p) {
              console.log(`\n📦 流水线: ${p.id}`);
              console.log(`   状态: ${p.status}`);
              console.log(`   类型: ${p.category}`);
              console.log(`   当前: ${ROLE_NAMES[p.currentStage] || p.currentStage}`);
              console.log('   阶段:');
              p.stages.forEach(s => {
                const icon = s.status === 'completed' ? '✓' : s.status === 'running' ? '▶' : '○';
                console.log(`     ${icon} ${ROLE_NAMES[s.role]} - ${s.status}`);
              });
            } else {
              console.log(`\n❌ 未找到流水线: ${statusId}`);
            }
          }
          break;
          
        case 'tasks':
          console.log('\n📌 等待中的任务:');
          const tasks = orchestrator.getWaitingTasks();
          if (tasks.length === 0) {
            console.log('  暂无等待中的任务');
          } else {
            tasks.forEach(t => {
              console.log(`  [${t.status}] ${t.pipelineId.slice(0, 8)} - ${t.category} - 需要: ${ROLE_NAMES[t.currentStage] || t.currentStage}`);
            });
          }
          break;
          
        case 'next':
          const agentName = args[0];
          if (!agentName) {
            console.log('用法: next <agent-name>');
          } else {
            const task = orchestrator.getNextTask(agentName);
            if (task) {
              console.log(`\n📋 ${agentName} 的下一个任务:`);
              console.log(`   Pipeline: ${task.pipelineId.slice(0, 8)}`);
              console.log(`   类型: ${task.category}`);
            } else {
              console.log(`\n⏸️  ${agentName} 暂无任务`);
            }
          }
          break;
          
        case 'help':
          console.log(`
🛡️  守门人 CLI

命令:
  list           - 列出所有流水线
  stats          - 显示统计信息
  create <type>  - 创建新流水线 (BUILD/REVIEW/QUERY/SECURITY/CRITICAL)
  start <id>     - 启动流水线
  status <id>    - 查看流水线状态
  tasks          - 显示等待中的任务
  next <agent>   - 查看 Agent 的下一个任务
  help           - 显示帮助
  exit           - 退出
`);
          break;
          
        case 'exit':
        case 'quit':
          console.log('👋 再见!');
          rl.close();
          process.exit(0);
          break;
          
        default:
          if (action) {
            console.log(`❓ 未知命令: ${action}`);
          }
          console.log('输入 "help" 查看可用命令');
      }
      
      prompt();
    });
  }

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           🛡️  AI Team Pipeline - 守门人                   ║
╠═══════════════════════════════════════════════════════════╣
║  命令: list | stats | create | start | status | tasks      ║
║  帮助: help | exit                                        ║
╚═══════════════════════════════════════════════════════════╝
  `);
  
  prompt();
}

// 如果直接运行
runCLI().catch(console.error);
