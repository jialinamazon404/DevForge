#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const API_BASE = 'http://localhost:3000';

// 加载 Agent 定义
const definitions = JSON.parse(
  await fs.readFile(path.join(ROOT, 'agents', 'definitions.json'), 'utf-8')
);

class Gatekeeper {
  constructor(pipelineId, workspace) {
    this.pipelineId = pipelineId;
    this.workspace = workspace;
    this.stages = [];
    this.currentStage = 0;
  }

  async initialize(request) {
    const category = this.route(request);
    const route = definitions.routes[category] || definitions.routes.BUILD;
    
    this.stages = route.map(role => ({
      role,
      agent: definitions.agents[role],
      status: 'pending',
      goal: definitions.agents[role].goal,
      thinking: null,
      output: null,
      startedAt: null,
      completedAt: null,
      duration: null
    }));

    const state = {
      id: this.pipelineId,
      category,
      status: 'pending',
      currentStage: 0,
      request,
      stages: this.stages.map(s => ({
        role: s.role,
        status: s.status,
        goal: s.goal
      })),
      context: {
        prd: null,
        openspec: null,
        techCoachReport: null,
        devOutput: null,
        testReport: null,
        opsConfig: null,
        securityReport: null,
        designReview: null,
        evolverReport: null
      }
    };

    await this.saveState(state);
    return { category, stages: this.stages };
  }

  route(request) {
    const text = request.rawInput?.toLowerCase() || '';
    
    if (text.includes('安全') || text.includes('漏洞') || text.includes('审计')) {
      return 'SECURITY';
    }
    if (text.includes('审查') || text.includes('评审') || text.includes('review')) {
      return 'REVIEW';
    }
    if (text.includes('查询') || text.includes('探索') || text.includes('search')) {
      return 'QUERY';
    }
    if (text.includes('紧急') || text.includes('critical') || request.priority === 'CRITICAL') {
      return 'CRITICAL';
    }
    return 'BUILD';
  }

  async saveState(state) {
    await fs.writeFile(
      path.join(this.workspace, 'pipeline.json'),
      JSON.stringify(state, null, 2)
    );
  }

  async loadState() {
    try {
      const data = await fs.readFile(
        path.join(this.workspace, 'pipeline.json'),
        'utf-8'
      );
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async updateStage(stageIndex, updates) {
    const state = await this.loadState();
    if (!state) return null;

    const stage = state.stages[stageIndex];
    if (stage) {
      Object.assign(stage, updates);
      state.stages[stageIndex] = stage;
    }

    state.currentStage = stageIndex;
    await this.saveState(state);
    return state;
  }

  async saveThinking(stageIndex, thinking) {
    const filePath = path.join(
      this.workspace, 
      'thinking', 
      `${String(stageIndex + 1).padStart(2, '0')}-${this.stages[stageIndex].role}.json`
    );
    await fs.writeFile(filePath, JSON.stringify(thinking, null, 2));
    return filePath;
  }

  async saveOutput(stageIndex, output) {
    const role = this.stages[stageIndex].role;
    let filePath;

    switch (role) {
      case 'product':
        filePath = path.join(this.workspace, 'output', 'prd.md');
        break;
      case 'architect':
        filePath = path.join(this.workspace, 'output', 'openspec.md');
        break;
      case 'tech_coach':
        filePath = path.join(this.workspace, 'output', 'tech-implementation.md');
        break;
      case 'developer':
        filePath = path.join(this.workspace, 'output', 'dev-summary.md');
        break;
      case 'tester':
        filePath = path.join(this.workspace, 'output', 'test-report.md');
        break;
      case 'ops':
        filePath = path.join(this.workspace, 'output', 'ops-config.md');
        break;
      case 'ghost':
        filePath = path.join(this.workspace, 'output', 'security-report.md');
        break;
      case 'creative':
        filePath = path.join(this.workspace, 'output', 'design-review.md');
        break;
      case 'evolver':
        filePath = path.join(this.workspace, 'output', 'evolver-report.md');
        break;
      default:
        filePath = path.join(this.workspace, 'output', `${role}-output.md`);
    }

    await fs.writeFile(filePath, typeof output === 'string' ? output : JSON.stringify(output, null, 2));
    return filePath;
  }

  getCurrentStage() {
    return this.stages[this.currentStage];
  }

  nextStage() {
    this.currentStage++;
    return this.currentStage < this.stages.length ? this.stages[this.currentStage] : null;
  }

  isComplete() {
    // 所有阶段都已完成
    return this.stages.every(s => s.status === 'completed');
  }
  
  // 获取下一个未完成的阶段索引
  getNextPendingStageIndex() {
    return this.stages.findIndex(s => s.status !== 'completed');
  }

  getStatus() {
    return {
      pipelineId: this.pipelineId,
      currentStage: this.currentStage,
      totalStages: this.stages.length,
      currentRole: this.stages[this.currentStage]?.role || 'done',
      currentAgent: this.stages[this.currentStage]?.agent,
      progress: `${this.currentStage}/${this.stages.length}`,
      stages: this.stages.map((s, i) => ({
        index: i,
        role: s.role,
        agent: s.agent,
        status: i < this.currentStage ? 'completed' : i === this.currentStage ? 'running' : 'pending'
      }))
    };
  }
}

// Agent 执行器 - 模拟 Agent 的思考和输出过程
class AgentRunner {
  constructor(gatekeeper, stageIndex) {
    this.gatekeeper = gatekeeper;
    this.stageIndex = stageIndex;
    this.stage = gatekeeper.stages[stageIndex];
    // 如果 stage.agent 未定义，从 definitions 获取
    this.agent = this.stage.agent || definitions.agents[this.stage.role];
  }

  async run(context) {
    const startTime = Date.now();

    // 1. 更新状态为运行中
    await this.gatekeeper.updateStage(this.stageIndex, {
      status: 'running',
      startedAt: new Date().toISOString()
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`${this.agent.icon} ${this.agent.name} (${this.agent.name_en})`);
    console.log(`${'='.repeat(60)}`);
    console.log(`目标: ${this.agent.goal}\n`);

    // 2. Chain-of-Thought 思考过程
    const thinking = await this.think(context);
    
    // 3. 生成输出
    const output = await this.execute(context, thinking);
    
    const endTime = Date.now();

    // 4. 保存 thinking 和 output
    await this.gatekeeper.saveThinking(this.stageIndex, thinking);
    await this.gatekeeper.saveOutput(this.stageIndex, output);

    // 5. 更新状态为完成
    await this.gatekeeper.updateStage(this.stageIndex, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      duration: endTime - startTime,
      thinking,
      output
    });

    console.log(`\n✅ 完成 (${((endTime - startTime) / 1000).toFixed(1)}s)\n`);

    return { thinking, output };
  }

  async think(context) {
    const thinkingSteps = this.agent.thinking_template || [];
    
    const thinking = {
      agent: this.stage.role,
      startedAt: new Date().toISOString(),
      steps: []
    };

    for (const step of thinkingSteps) {
      console.log(`  💭 ${step}`);
      thinking.steps.push({
        prompt: step,
        thought: `思考: ${step}`,
        timestamp: new Date().toISOString()
      });
    }

    return thinking;
  }

  async execute(context, thinking) {
    // 根据不同角色生成不同的输出
    switch (this.stage.role) {
      case 'product':
        return this.generatePRD(context, thinking);
      case 'architect':
        return this.generateOpenSpec(context, thinking);
      case 'tech_coach':
        return this.generateScoutReport(context, thinking);
      case 'developer':
        return this.generateDevOutput(context, thinking);
      case 'tester':
        return this.generateTestReport(context, thinking);
      case 'ops':
        return this.generateOpsConfig(context, thinking);
      case 'ghost':
        return this.generateSecurityReport(context, thinking);
      case 'creative':
        return this.generateDesignReview(context, thinking);
      case 'evolver':
        return this.generateEvolverReport(context, thinking);
      default:
        return { message: 'Agent completed' };
    }
  }

  generatePRD(context, thinking) {
    return {
      problem: `用户需要解决: ${context.request.rawInput}`,
      users: [{ persona: '主要用户', goals: ['核心目标1', '核心目标2'] }],
      stories: [
        {
          id: 'US-001',
          as_a: '用户',
          i_want: context.request.rawInput,
          so_that: '实现业务价值',
          acceptance: ['功能正常工作', '性能满足要求']
        }
      ],
      features: [
        { id: 'F-001', name: '核心功能', priority: 'HIGH', description: '主要功能描述' }
      ],
      constraints: ['必须在截止日期前完成', '需要兼容现有系统']
    };
  }

  generateOpenSpec(context, thinking) {
    return {
      version: '1.0',
      requirements: [
        { id: 'REQ-001', source: 'US-001', description: '功能需求', priority: 'HIGH' }
      ],
      architecture: {
        components: [
          { name: 'Frontend', responsibility: '用户界面', tech_stack: 'Vue 3' },
          { name: 'Backend', responsibility: '业务逻辑', tech_stack: 'Node.js' },
          { name: 'Database', responsibility: '数据存储', tech_stack: 'PostgreSQL' }
        ],
        data_flow: ['用户请求 → 前端 → API → 业务逻辑 → 数据库']
      },
      api: {
        endpoints: [
          { method: 'GET', path: '/api/health', request: 'none', response: '{status: "ok"}' }
        ]
      },
      data_model: {
        entities: [
          { name: 'User', fields: [{ name: 'id', type: 'UUID' }, { name: 'name', type: 'string' }] }
        ]
      },
      tech_stack: { frontend: 'Vue 3 + Vite', backend: 'Express.js', database: 'PostgreSQL' },
      decisions: [
        { id: 'DEC-001', topic: '技术选型', decision: '使用 Node.js', rationale: '团队熟悉' }
      ]
    };
  }

  generateScoutReport(context, thinking) {
    return {
      findings: [
        { type: 'opportunity', location: 'src/', description: '可复用现有组件', severity: 'MEDIUM' }
      ],
      similar_implementations: [],
      dependency_analysis: { existing: ['vue', 'express'], new: ['uuid'] },
      recommendations: ['可使用现有认证中间件']
    };
  }

  generateDevOutput(context, thinking) {
    return {
      branch: `feature/${this.gatekeeper.pipelineId.slice(0, 8)}`,
      files: [
        { path: 'src/index.js', action: 'create', lines: 50 }
      ],
      commits: [{ hash: 'abc123', message: 'feat: initial implementation' }],
      test_results: { passed: 10, failed: 0, total: 10 },
      pr_url: null
    };
  }

  generateTestReport(context, thinking) {
    return {
      summary: { total: 20, passed: 18, failed: 2, skipped: 0 },
      bugs: [
        { id: 'BUG-001', title: '登录失败', severity: 'HIGH', steps: ['输入密码', '点击登录'], screenshot: null }
      ],
      performance: { lcp: '1.2s', fid: '50ms', cls: '0.1', load_time: '2.1s' }
    };
  }

  generateOpsConfig(context, thinking) {
    return {
      dockerfile: 'FROM node:18-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --only=production\nCOPY . .\nEXPOSE 3000\nCMD ["node", "index.js"]',
      docker_compose: 'version: "3.8"\nservices:\n  app:\n    build: .\n    ports:\n      - "3000:3000"',
      ci_config: { provider: 'github-actions', stages: ['test', 'build', 'deploy'] },
      deployment_script: '#!/bin/bash\necho "Deploying..."',
      env_template: { NODE_ENV: 'production', PORT: '3000' }
    };
  }

  generateSecurityReport(context, thinking) {
    return {
      secrets_found: [],
      security_issues: [
        { severity: 'LOW', title: '建议使用 HTTPS', file: null, recommendation: '生产环境应使用 HTTPS' }
      ],
      compliance: { passed: ['OWASP Top 10'], failed: [] }
    };
  }

  generateDesignReview(context, thinking) {
    return {
      design_review: {
        consistency: { score: 8, issues: [] },
        usability: { score: 7, issues: ['建议增加 loading 状态'] },
        aesthetics: { score: 8, issues: [] }
      },
      screenshots: [],
      recommendations: [
        { priority: 'MEDIUM', title: '增加 loading 动画', description: '改善用户体验' }
      ]
    };
  }

  generateEvolverReport(context, thinking) {
    const requestText = context?.request?.rawInput || '';
    return {
      technical_improvements: [
        { id: 'TI-001', title: '性能优化', description: '建议添加缓存层以提升响应速度', priority: 'MEDIUM', effort: '中' },
        { id: 'TI-002', title: 'API 版本控制', description: '为 API 添加版本管理，支持未来升级', priority: 'LOW', effort: '高' }
      ],
      business_growth: [
        { id: 'BG-001', title: '多租户支持', description: '未来可扩展为多租户架构', priority: 'MEDIUM', impact: '高' },
        { id: 'BG-002', title: '数据导出功能', description: '支持 Excel/CSV 导出，便于数据分析', priority: 'LOW', impact: '中' }
      ],
      tech_debt: [
        { id: 'TD-001', title: '缺乏单元测试', description: '建议补充核心业务逻辑的单元测试', severity: 'MEDIUM', refactor_suggestion: '使用 Jest 或 Vitest 补充测试' },
        { id: 'TD-002', title: '错误处理不完善', description: '部分 API 缺少统一的错误处理', severity: 'LOW', refactor_suggestion: '添加全局错误中间件' }
      ],
      next_steps: [
        '1. 补充核心功能的单元测试',
        '2. 添加 API 版本控制中间件',
        '3. 考虑引入 Redis 缓存层'
      ]
    };
  }
}

// 从 API 加载流水线状态
async function loadFromAPI(pipelineId) {
  try {
    const response = await axios.get(`${API_BASE}/api/pipelines/${pipelineId}`);
    return response.data;
  } catch (e) {
    console.error(`❌ 无法从 API 加载流水线: ${e.message}`);
    return null;
  }
}

// 更新 API 状态
async function updateAPI(pipelineId, updates) {
  try {
    await axios.put(`${API_BASE}/api/pipelines/${pipelineId}`, updates);
  } catch (e) {
    console.error(`❌ 无法更新 API: ${e.message}`);
  }
}

// 主执行流程
async function main() {
  const pipelineId = process.argv[2];

  if (!pipelineId) {
    console.error('Usage: node gatekeeper.js <pipelineId>');
    process.exit(1);
  }

  const workspace = path.join(ROOT, 'workspace', pipelineId);

  console.log('\n🚪 Gatekeeper 启动\n');
  console.log(`流水线ID: ${pipelineId}`);
  console.log(`工作目录: ${workspace}`);

  // 加载现有流水线状态
  let pipelineState = await loadFromAPI(pipelineId);
  
  if (!pipelineState) {
    console.error('❌ 流水线不存在');
    process.exit(1);
  }

  console.log(`流水线状态: ${pipelineState.status}`);
  console.log(`当前阶段: ${pipelineState.currentStage || '无'}`);

  const gatekeeper = new Gatekeeper(pipelineId, workspace);
  
  // 如果流水线还没有 stages，进行初始化
  if (!pipelineState.stages || pipelineState.stages.length === 0) {
    const request = {
      rawInput: pipelineState.rawInput,
      category: pipelineState.category,
      priority: pipelineState.priority
    };
    const initResult = await gatekeeper.initialize(request);
    console.log(`\n📍 路由: ${initResult.category}`);
    console.log(`📍 阶段: ${initResult.stages.map(s => `${s.agent.icon}${s.role}`).join(' → ')}`);
    pipelineState = await gatekeeper.loadState();
  } else {
    // 加载现有的 stages 到 gatekeeper
    gatekeeper.stages = pipelineState.stages.map((s, i) => ({
      role: s.role,
      agent: definitions.agents[s.role],
      status: s.status,
      goal: s.goal || definitions.agents[s.role]?.goal,
      thinking: s.thinking,
      output: s.output,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      duration: s.duration
    }));
    gatekeeper.currentStage = pipelineState.stages.findIndex(s => s.status === 'running' || s.status === 'pending');
    if (gatekeeper.currentStage === -1) gatekeeper.currentStage = 0;
  }

  // 执行流水线
  while (!gatekeeper.isComplete()) {
    // 找到下一个未完成的阶段
    const nextIndex = gatekeeper.getNextPendingStageIndex();
    if (nextIndex === -1) break;
    gatekeeper.currentStage = nextIndex;
    
    const stage = gatekeeper.getCurrentStage();
    if (!stage) break;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 执行阶段: ${stage.role} (${stage.agent?.name || stage.role})`);
    
    const runner = new AgentRunner(gatekeeper, gatekeeper.currentStage);
    const state = await gatekeeper.loadState();
    
    await runner.run(state.context || { request: pipelineState });
    
    // 更新文件和 API 状态
    const updatedState = await gatekeeper.loadState();
    await gatekeeper.saveState(updatedState);
    await updateAPI(pipelineId, { 
      stages: updatedState.stages
    });
    
    // 重新加载状态以确保同步
    const newState = await gatekeeper.loadState();
    gatekeeper.stages = newState.stages;
    
    // 短暂延迟避免过快
    await new Promise(r => setTimeout(r, 500));
  }

  // 完成
  const finalState = await gatekeeper.loadState();
  finalState.status = 'completed';
  finalState.completedAt = new Date().toISOString();
  await gatekeeper.saveState(finalState);
  await updateAPI(pipelineId, { status: 'completed', currentStage: 'done' });

  console.log('\n✅ 流水线完成\n');
}

// CLI 模式
if (process.argv[1] && process.argv[1].includes('gatekeeper')) {
  main().catch(console.error);
}

export { Gatekeeper, AgentRunner };
