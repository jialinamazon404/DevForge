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
import { spawn } from 'child_process';
import axios from 'axios';
import { io } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const WORKSPACE = path.join(ROOT, 'workspace');
const PROJECTS = path.join(ROOT, 'projects');

// 从命令行参数获取 API_BASE，或使用默认值
const API_BASE = process.argv.find(arg => arg.startsWith('API_BASE='))?.split('=')[1] || 'http://localhost:3000';

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

// Skill 路径映射
// 注意：大 skill（>30KB）不注入 prompt，保持通过 opencode 按需加载
// plan-eng-review: 56KB, ship: 80KB — 不注入
const SKILL_PATHS = {
  brainstorming: '/Users/jialin.chen/.cache/opencode/node_modules/superpowers/skills/brainstorming/SKILL.md',
  'plan-eng-review': '/Users/jialin.chen/.claude/skills/gstack/plan-eng-review/SKILL.md',
  'office-hours': '/Users/jialin.chen/.claude/skills/gstack/office-hours/SKILL.md',
  qa: '/Users/jialin.chen/.claude/skills/gstack/qa/SKILL.md',
  'test-driven-development': '/Users/jialin.chen/.cache/opencode/node_modules/superpowers/skills/test-driven-development/SKILL.md',
  ship: '/Users/jialin.chen/.claude/skills/gstack/ship/SKILL.md',
  cso: '/Users/jialin.chen/.claude/skills/gstack/cso/SKILL.md',
  'design-review': '/Users/jialin.chen/.claude/skills/gstack/design-review/SKILL.md',
  retro: '/Users/jialin.chen/.claude/skills/gstack/retro/SKILL.md',
  // Product 步骤级 skills
  'user-story': '/Users/jialin.chen/.agents/skills/user-story/SKILL.md',
  'product-spec-kit': '/Users/jialin.chen/.agents/skills/product-spec-kit/SKILL.md',
  'tailwind-design-system': '/Users/jialin.chen/.agents/skills/tailwind-design-system/SKILL.md',
  'user-journeys': '/Users/jialin.chen/.agents/skills/user-journeys/SKILL.md',
  // Architect 步骤级 skills
  'system-design': '/Users/jialin.chen/.agents/skills/system-design/SKILL.md',
  'database-design': '/Users/jialin.chen/.agents/skills/database-design/SKILL.md',
  'api-design': '/Users/jialin.chen/.agents/skills/api-design-principles/SKILL.md',
  'event-driven': '/Users/jialin.chen/.agents/skills/event-driven-architect/SKILL.md',
  // Developer 步骤级 skills
  'systematic-debugging': '/Users/jialin.chen/.agents/skills/systematic-debugging/SKILL.md',
  'unit-test-generator': '/Users/jialin.chen/.agents/skills/unit-test-generator/SKILL.md',
  'log-analyzer': '/Users/jialin.chen/.agents/skills/ln-514-test-log-analyzer/SKILL.md',
  // Ops 步骤级 skills
  'docker-helper': '/Users/jialin.chen/.agents/skills/docker-helper/SKILL.md',
  'azure-deploy': '/Users/jialin.chen/.agents/skills/azure-deploy/SKILL.md'
};

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
1. 使用 Bash 工具打开浏览器：\`open "<url>"\` 或使用浏览工具
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
    'tailwind-design-system', // 步骤 4/5: 界面布局与交互流程 (15KB)
    null                      // 步骤 5/5: 汇总生成PRD（不需要 skill）
  ],
  architect: [
    'system-design',          // 步骤 1/4: 系统架构设计 (1.3KB)
    'api-design',             // 步骤 2/4: API 接口设计 (13KB)
    'database-design',        // 步骤 3/4: 数据库模型设计 (1.6KB)
    null                      // 步骤 4/4: OpenSpec CLI 生成 change proposal（不需要 skill 注入）
  ],
  developer: [
    null,                     // 步骤 1/6: 项目结构搭建
    null,                     // 步骤 2/6: 后端基础配置
    'api-design',             // 步骤 3/6: 后端 API 实现 (13KB)
    null,                     // 步骤 4/6: 前端基础配置
    null,                     // 步骤 5/6: 前端页面实现
    'test-driven-development' // 步骤 6/6: 生成开发文档+测试 (9.8KB)
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
    null                      // 单步：整合产品+架构产出，输出技术实现文档
  ]
};

// Agent 模型配置 - 使用实际可用的模型
const AGENT_MODELS = {
  ba: 'opencode/big-pickle',
  product: 'opencode/qwen3.6-plus',
  architect: 'opencode/qwen3.6-plus',
  tech_coach: 'opencode/qwen3.6-plus',
  developer: 'opencode/qwen3.6-plus',
  tester: 'opencode/qwen3.6-plus',
  ops: 'opencode/gpt-5-nano',
  evolver: 'opencode/gpt-5-nano',
  ghost: 'opencode/big-pickle',
  creative: 'opencode/big-pickle'
};

// 超时配置 (毫秒)
const TIMEOUT_CONFIG = {
  ba: 300000,         // 5分钟
  product: 300000,    // 5分钟
  architect: 300000,  // 5分钟
  tech_coach: 300000, // 5分钟
  developer: 600000,  // 10分钟 (8步拆分后每步)
  tester: 300000,     // 5分钟
  ops: 300000,        // 5分钟
  evolver: 300000     // 5分钟
};

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
 * 加载 Skill 内容
 */
async function loadSkill(skillName) {
  const skillPath = SKILL_PATHS[skillName];
  if (!skillPath) {
    console.log(`   ⚠️ 未找到 Skill: ${skillName}`);
    return null;
  }
  try {
    const content = await fs.readFile(skillPath, 'utf-8');
    return content;
  } catch (e) {
    console.log(`   ❌ 无法加载 Skill: ${skillPath}`);
    return null;
  }
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
 * 获取阶段索引
 */
function getStageIndex(role) {
  const order = ['ba', 'product', 'architect', 'developer', 'tester', 'ops', 'evolver', 'ghost', 'creative'];
  return order.indexOf(role);
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
    const { execSync } = require('child_process');
    // 只清理状态为 T (stopped) 的僵尸进程，不影响正常运行的进程
    execSync("pkill -f 'opencode run' -t T 2>/dev/null", { stdio: 'ignore' });
  } catch (e) {
    // 忽略错误（可能没有僵尸进程）
  }
}

/**
 * 执行 OpenCode 并获取输出（带超时和重试）
 */
async function runOpenCode(prompt, options = {}) {
  const { model = 'opencode/big-pickle', agentName = 'developer', retryCount = 0, skillName = null, usePure = true, qaInstruction = null } = options;
  
  // 清理僵尸进程
  cleanupZombieProcesses();
  
  // 获取对应角色的超时配置
  const timeout = TIMEOUT_CONFIG[agentName] || 180000;
  
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
      const cmd = `opencode run --format json ${pureFlag} --model "${model}" --dir "${ROOT}"`;
      
      console.log(`   🚀 启动 OpenCode: ${model}`);
      sendProgress(`正在调用 AI 模型: ${model}...`);
      
      const proc = spawn('bash', ['-c', `${cmd} < "${tmpFile}"`], {
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
 * 解析 OpenCode 输出
 * 只提取纯文本内容，过滤掉 JSON 事件结构
 */
function parseOpenCodeOutput(rawOutput) {
  const lines = rawOutput.split('\n').filter(l => l.trim());
  const texts = [];
  
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      
      // 只提取纯文本响应，跳过 OpenCode 内部事件结构
      if (event.type === 'text' && event.part?.text) {
        texts.push(event.part.text);
      }
      // 跳过 tool_use, step_start, step_finish 等事件
    } catch (e) {
      // 非 JSON 行当作文本处理
      if (line.trim()) {
        texts.push(line);
      }
    }
  }
  
  return {
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
${workspacePath || `workspace/${pipelineId}`}

## 你的任务
分析目标用户群体，识别核心需求和痛点。

## 输出要求
生成用户画像文档，包含：
- 目标用户群体描述
- 用户痛点
- 核心需求
- 用户场景

## 输出文件
保存到: \`${workspacePath || `workspace/${pipelineId}`}/product/user-personas.md\`
`,
    `# 角色：产品经理 - 步骤 2/5: 用户故事拆解

## 用户需求
${rawInput}

## 工作目录
${workspacePath || `workspace/${pipelineId}`}

## 你的任务
基于用户画像拆解用户故事。

## 输出要求
生成用户故事文档，包含：
- 用户故事（As a, I want, so that）
- 优先级（HIGH/MEDIUM/LOW）
- 验收标准（Given-When-Then 格式）

## 输出文件
保存到: \`${workspacePath || `workspace/${pipelineId}`}/product/user-stories.md\`
`,
    `# 角色：产品经理 - 步骤 3/5: 功能清单与验收标准

## 用户需求
${rawInput}

## 工作目录
${workspacePath || `workspace/${pipelineId}`}

## 你的任务
定义功能清单和验收标准。

## 输出要求
生成功能需求文档，包含：
- 功能清单（功能名称、描述、优先级）
- 功能依赖关系
- 验收标准

## 输出文件
保存到: \`${workspacePath || `workspace/${pipelineId}`}/product/functional-requirements.md\`
`,
    `# 角色：产品经理 - 步骤 4/5: 界面布局与交互流程

## 用户需求
${rawInput}

## 工作目录
${workspacePath || `workspace/${pipelineId}`}

## 你的任务
设计页面布局和用户交互流程。

## 输出要求
生成界面设计文档，包含：
- 页面结构
- 导航结构
- 核心页面布局
- 用户交互流程

## 输出文件
保存到: \`${workspacePath || `workspace/${pipelineId}`}/product/ui-layout.md\`
和: \`${workspacePath || `workspace/${pipelineId}`}/product/user-journey.md\`
`,
    `# 角色：产品经理 - 步骤 5/5: 汇总生成PRD

## 用户需求
${rawInput}

## 工作目录
${workspacePath || `workspace/${pipelineId}`}

## 你的任务
整合所有产出，生成完整的PRD文档。

## 输出要求
生成 JSON 格式的 PRD，必须包含以下结构：

\`\`\`json
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
\`\`\`

## 输出文件
保存为 JSON 到: \`${workspacePath || `workspace/${pipelineId}`}/product/prd.json\`
同时生成 Markdown 版本到: \`${workspacePath || `workspace/${pipelineId}`}/product/prd.md\`
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
      '## 步骤 1/4: 系统架构设计\n专注于设计系统架构图、技术栈选型、组件划分。输出到 output/architect-step1.md',
      '## 步骤 2/4: API 接口设计\n基于架构设计 RESTful API 规范。输出到 output/architect-step2.md',
      '## 步骤 3/4: 数据库模型设计\n设计数据库表结构和关系。输出到 output/architect-step3.md',
      '## 步骤 4/4: OpenSpec Change Proposal\n使用 OpenSpec CLI 创建规范的 change proposal。执行: openspec init --tools opencode, openspec new change "<name>", openspec instructions, openspec validate'
    ],
    developer: [
      '## 步骤 1/6: 项目结构搭建\n根据技术文档创建项目目录结构、初始化 Git。输出到 developer/',
      '## 步骤 2/6: 后端基础配置\n创建后端 package.json、安装依赖、配置数据库和中间件。输出到 developer/backend/',
      '## 步骤 3/6: 后端 API 实现\n根据技术文档 API 清单实现所有后端接口。输出到 developer/backend/',
      '## 步骤 4/6: 前端基础配置\n创建前端项目、安装依赖、配置路由和状态管理。输出到 developer/frontend/',
      '## 步骤 5/6: 前端页面实现\n根据产品界面布局实现所有前端页面。输出到 developer/frontend/',
      '## 步骤 6/6: 生成开发文档\n生成 README.md、API.md、项目说明。输出到 developer/README.md, developer/API.md, developer/dev-summary.md'
    ],
    tester: [
      '## 步骤 1/4: 功能测试用例设计\n基于 PRD 和 OpenSpec 设计功能测试用例。输出到 tester/test-cases.md',
      '## 步骤 2/4: 执行功能测试\n执行功能测试并记录测试结果。输出到 tester/test-results.md',
      '## 步骤 3/4: 安全漏洞扫描\n进行安全漏洞扫描，检查接口安全。输出到 tester/security-scan.md',
      '## 步骤 4/4: 生成测试报告\n汇总所有测试结果，生成最终测试报告。输出到 tester/test-report.md, tester/security-report.md'
    ],
    tech_coach: [
      '## 技术实现文档生成\n整合产品和架构产出，输出前后端技术实现文档。输出到 tech-coach/tech-implementation.md, output/user-stories.md, output/tech-feasibility.md'
    ]
  };
  
  return steps[role]?.[stepIndex] || '';
}

/**
 * 生成 Architect Agent 的提示词 - 直接选择方案并生成架构，不提问
 */
async function generateArchitectPrompt(context) {
  const { pipelineId, rawInput, workspacePath, prd, stepIndex, projectPath } = context;
  
  // 步骤 4 需要读取前三步的产出文件
  let step1Output = '', step2Output = '', step3Output = '';
  if (stepIndex === 3) {
    try {
      step1Output = await fs.readFile(path.join(workspacePath, 'output/architect-step1.md'), 'utf-8');
    } catch (e) { step1Output = '未找到（步骤 1 可能未执行或未保存）'; }
    try {
      step2Output = await fs.readFile(path.join(workspacePath, 'output/architect-step2.md'), 'utf-8');
    } catch (e) { step2Output = '未找到（步骤 2 可能未执行或未保存）'; }
    try {
      step3Output = await fs.readFile(path.join(workspacePath, 'output/architect-step3.md'), 'utf-8');
    } catch (e) { step3Output = '未找到（步骤 3 可能未执行或未保存）'; }
  }
  
  const previousStepsContext = stepIndex === 3 ? `
## 前三步架构设计产出（必须读取并整合到 OpenSpec artifacts 中）

### 步骤 1：系统架构设计
\`\`\`
${step1Output}
\`\`\`

### 步骤 2：API 接口设计
\`\`\`
${step2Output}
\`\`\`

### 步骤 3：数据库模型设计
\`\`\`
${step3Output}
\`\`\`

**重要**: 以上是你之前生成的架构设计产出，创建 OpenSpec artifacts 时必须基于这些实际内容：
- design.md 必须整合步骤 1 的系统架构 + 步骤 2 的 API 设计 + 步骤 3 的数据库设计
- tasks.md 的任务必须覆盖以上所有设计内容
- 不要凭空编造，要忠实反映前三步的实际设计决策
` : '';
  
  const openSpecInit = stepIndex === 3 ? `
### 1. 初始化 OpenSpec 环境（如果项目还没有 OpenSpec）
切换到项目目录: \`cd ${projectPath || `projects/${pipelineId}`}\`
检查是否存在 \`openspec/spec.json\` 或 \`openspec/\` 目录：
- 如果不存在: \`openspec init --tools opencode --no-color\`
- 如果已存在: 跳过此步骤
` : '';

  const openSpecCreate = stepIndex === 3 ? `
### 2. 创建 change proposal
切换到项目目录: \`cd ${projectPath || `projects/${pipelineId}`}\`
基于 PRD 和前 3 步的架构设计，创建 change：
\`\`\`bash
openspec new change "<feature-name>" --description "<一句话描述>"
\`\`\`
feature-name 格式: \`sprint-N-short-desc\`（如 "sprint-1-user-auth", "sprint-2-payment"）
description 简要描述本次迭代内容。
` : '';

  const openSpecStatus = stepIndex === 3 ? `
### 3. 获取 artifact 构建顺序
\`\`\`bash
openspec status --change "<feature-name>" --json
\`\`\`
从 JSON 中获取 applyRequires（需要哪些 artifacts 才能开始实现）。
` : '';

  const openSpecArtifacts = stepIndex === 3 ? `
### 4. 按依赖顺序创建 artifacts
对每个 artifact：
\`\`\`bash
openspec instructions <artifact-id> --change "<feature-name>" --json
\`\`\`
从 instructions JSON 获取 template 和 rules，创建对应文件：
- **proposal.md** — 变更描述、需求、影响范围（需求来源: PRD）
- **design.md** — 技术设计决策（整合步骤 1 的系统架构 + 步骤 2 的 API 设计 + 步骤 3 的数据库设计）
- **tasks.md** — 实现任务清单（基于 design.md，细化为可执行的开发任务，供开发者按顺序执行）
` : '';

  const openSpecValidate = stepIndex === 3 ? `
### 5. 验证 change proposal
\`\`\`bash
openspec validate "<feature-name>"
openspec status --change "<feature-name>"
\`\`\`
确保所有 applyRequires artifacts 状态为 done。
` : '';

  const openSpecOutput = stepIndex === 3 ? `
## 输出要求
- OpenSpec change 目录: \`${projectPath || `projects/${pipelineId}`}/openspec/changes/<feature-name>/\`
- 包含 proposal.md, design.md, tasks.md 等标准 artifacts
- 确保 \`openspec status\` 显示所有 applyRequires artifacts 为 done 状态
` : '';

  const openSpecFallback = stepIndex === 3 ? `
- 如果 openspec CLI 不可用，降级为手动创建目录结构:
  \`\`\`
  ${projectPath || `projects/${pipelineId}`}/openspec/changes/<feature-name>/
  ├── proposal.md
  ├── design.md
  └── tasks.md
  \`\`\`
` : '';
  
  const stepPrompts = [
    `# 角色：架构师 - 步骤 1/4：系统架构设计

## 用户原始需求
${rawInput}

## 工作目录
${workspacePath || `workspace/${pipelineId}`}

## 你的任务
设计系统架构，包含组件划分和技术栈选型。

## 输出要求
1. 系统架构图（使用 Mermaid）
2. 技术选型及理由
3. 组件列表和职责
4. 数据流设计

保存到: \`${workspacePath || `workspace/${pipelineId}`}/output/architect-step1.md\`
`,
    `# 角色：架构师 - 步骤 2/4：API 接口设计

## 用户原始需求
${rawInput}

## 工作目录
${workspacePath || `workspace/${pipelineId}`}

## 你的任务
基于架构设计，设计 RESTful API 接口规范。

## 输出要求
1. API 端点列表（方法、路径、描述）
2. 请求参数和响应格式
3. 错误码定义

保存到: \`${workspacePath || `workspace/${pipelineId}`}/output/architect-step2.md\`
`,
    `# 角色：架构师 - 步骤 3/4：数据库模型设计

## 用户原始需求
${rawInput}

## 工作目录
${workspacePath || `workspace/${pipelineId}`}

## 你的任务
设计数据库表结构和关系。

## 输出要求
1. 实体定义
2. 字段类型和约束
3. 表关系（1:1, 1:N, N:M）

保存到: \`${workspacePath || `workspace/${pipelineId}`}/output/architect-step3.md\`
`,
    `# 角色：架构师 - 步骤 4/4：OpenSpec Change Proposal

## 用户原始需求
${rawInput}

## PRD 文档
${prd || '无'}
${previousStepsContext}

## 工作目录
${workspacePath || `workspace/${pipelineId}`}

## 你的任务
使用 OpenSpec CLI 工具创建规范的 change proposal，作为下游开发教练和开发者的标准依据。

## 执行步骤
${openSpecInit}
${openSpecCreate}
${openSpecStatus}
${openSpecArtifacts}
${openSpecValidate}
${openSpecOutput}

## 注意
- 技术选型已在前面的步骤中确定，直接使用
- proposal.md 的需求来源: PRD 文档
- design.md 的技术设计来源: 前三步架构设计产出（见上方）
- tasks.md 的任务拆解: 基于 design.md，细化为可执行的开发任务${openSpecFallback}
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
 * 生成 Scout Agent 的提示词
 */
/**
 * 生成 Tech Coach Agent 的提示词
 * 作用：整合产品和架构的产出，输出技术实现文档（分前后端），减少开发者思考负担
 */
function generateTechCoachPrompt(context) {
  const { pipelineId, rawInput, workspacePath, prdOutput, openspec, openspecChangeDir } = context;
  
  const prdContext = prdOutput ? `\n## 产品产出（PRD）\n${prdOutput.slice(0, 3000)}` : '';
  const specContext = openspec ? `\n## 架构产出（OpenSpec）\n${openspec.slice(0, 3000)}` : '';
  const openspecChangeContext = openspecChangeDir ? `\n## OpenSpec Change Proposal\nChange 目录: ${openspecChangeDir}\n请读取以下文件作为技术实现的权威依据:\n- proposal.md（需求定义）\n- design.md（技术设计）\n- tasks.md（任务清单）` : '';
  
  return `# 角色：开发教练 (Tech Coach)

## 原始需求
${rawInput}
${prdContext}
${specContext}
${openspecChangeContext}

## 工作目录
${workspacePath || `workspace/${pipelineId}`}

## 你的任务
你是产品和架构之间的桥梁。你的目标是将产品的"用户语言"和架构的"架构语言"翻译成开发者的"代码语言"，让开发者拿到的是"可直接开工"的完整规格。

### 1. 整合产品产出
- 从 PRD 中提取功能需求
- 从功能清单中映射到技术实现
- 从界面布局中关联前端组件设计
- 从用户故事中转化为开发任务

### 2. 整合架构产出
- 从 OpenSpec Change Proposal 中确认技术选型和设计决策
- 从 API 接口设计中补充遗漏接口
- 从数据库模型中补充表设计建议

### 3. 输出技术实现文档
生成前后端分离的技术实现文档，包含：

#### 前端实现
- 组件结构（对应产品界面布局）
- 页面路由规划
- 状态管理方案
- API 调用封装

#### 后端实现
- API 实现清单（对应架构 API 设计 + 补充）
- 数据库实现（对应架构数据模型 + 补充）
- 业务逻辑说明
- 认证/权限设计

#### 技术可行性分析
- 风险点识别
- 实现难点评估

#### 开发任务拆解
- 对应产品用户故事 → 开发任务
- 优先级排序

## 输出要求
生成以下文件（必须完整）：
- \`${workspacePath || `workspace/${pipelineId}`}/tech-coach/tech-implementation.md\` - 技术实现文档（前后端分离）
- \`${workspacePath || `workspace/${pipelineId}`}/output/user-stories.md\` - 开发用用户故事
- \`${workspacePath || `workspace/${pipelineId}`}/output/tech-feasibility.md\` - 技术可行性分析
`;
}

/**
 * 生成 Developer Agent 的提示词 - 根据 tech_coach 产出动态生成步骤
 */
function generateDeveloperPrompt(context) {
  const { pipelineId, rawInput, workspacePath, openspec, openspecChangeDir, techCoachOutput, stepIndex, projectPath, codePath } = context;
  
  let specContext = '';
  if (openspecChangeDir) {
    specContext = `
## OpenSpec Change Proposal
Change 目录: ${openspecChangeDir}
请读取以下文件作为开发的权威依据:
- tasks.md（实现任务清单 — 按顺序执行）
- design.md（技术设计决策）
- proposal.md（需求背景）
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
  
  const projectDir = codePath || path.join(projectPath || `projects/${pipelineId}`, 'src');
  
  const stepPrompts = [
    `# 角色：开发者 - 步骤 1/6：项目结构搭建

## 用户需求
${rawInput}
${specContext}
${techContext}

## 工作目录
${projectDir}

## 你的任务
根据技术实现文档和 OpenSpec，创建项目目录结构：
1. 分析技术栈选型（前端框架、后端框架、数据库等）
2. 创建对应的项目目录结构
3. 初始化 Git 仓库
4. 创建基础配置文件

## 输出要求
- 创建 ${projectDir}/ 目录结构（前后端分离或单体，根据技术文档决定）
- package.json（前端+后端，根据技术栈决定）
- .gitignore
- 基础配置文件（数据库配置、环境变量等）

保存到: \`${projectDir}/\`
`,
    `# 角色：开发者 - 步骤 2/6：后端基础配置

## 用户需求
${rawInput}
${specContext}
${techContext}

## 工作目录
${projectDir}

## 你的任务
创建后端基础配置：
1. 创建后端 package.json
2. 安装后端依赖
3. 配置数据库连接
4. 配置中间件

## 输出要求
- 后端 package.json
- 依赖安装完成
- 数据库配置文件
- 中间件配置

保存到: \`${projectDir}/backend/\`
`,
    `# 角色：开发者 - 步骤 3/6：后端 API 实现

## 用户需求
${rawInput}
${specContext}
${techContext}

## 工作目录
${projectDir}

## 你的任务
根据技术文档 API 清单实现所有后端接口：
1. 创建路由定义
2. 实现控制器逻辑
3. 实现数据访问层
4. 添加错误处理

## 输出要求
- 所有 API 端点实现
- 路由配置
- 控制器
- 数据访问层

保存到: \`${projectDir}/backend/\`
`,
    `# 角色：开发者 - 步骤 4/6：前端基础配置

## 用户需求
${rawInput}
${specContext}
${techContext}

## 工作目录
${projectDir}

## 你的任务
创建前端项目：
1. 创建前端 package.json
2. 安装前端依赖
3. 配置路由
4. 配置状态管理

## 输出要求
- 前端 package.json
- 依赖安装完成
- 路由配置
- 状态管理配置

保存到: \`${projectDir}/frontend/\`
`,
    `# 角色：开发者 - 步骤 5/6：前端页面实现

## 用户需求
${rawInput}
${specContext}
${techContext}

## 工作目录
${projectDir}

## 你的任务
根据产品界面布局实现所有前端页面：
1. 创建页面组件
2. 实现组件交互
3. 连接 API
4. 添加状态管理

## 输出要求
- 所有页面组件
- 组件交互逻辑
- API 调用
- 状态管理

保存到: \`${projectDir}/frontend/\`
`,
    `# 角色：开发者 - 步骤 6/6：生成开发文档

## 用户需求
${rawInput}
${specContext}
${techContext}

## 工作目录
${projectDir}

## 你的任务
生成项目文档：
1. README.md（项目说明）
2. API.md（API 文档）
3. 项目说明文档

## 输出要求
- README.md
- API.md
- 项目说明

保存到: \`${projectDir}/README.md\`, \`${projectDir}/API.md\`, \`${projectDir}/dev-summary.md\`
`
  ];

  // 如果指定了 stepIndex，返回对应步骤的 prompt
  if (stepIndex !== null && stepIndex >= 0 && stepIndex < stepPrompts.length) {
    return stepPrompts[stepIndex];
  }

  // 默认返回完整 prompt（第6步）
  return stepPrompts[5];
}

/**
 * 生成 Tester Agent 的提示词
 */
function generateTesterPrompt(context) {
  const { pipelineId, rawInput, workspacePath, projectPath, stepIndex, testEnvironmentUrl } = context;
  const hasEnvironment = !!testEnvironmentUrl;
  const codeDir = path.join(projectPath || `projects/${pipelineId}`, 'src');
  
  const stepPrompts = [
    `# 角色：测试工程师 - 步骤 1/4：功能测试用例设计

## 用户需求
${rawInput}

## 代码位置
${codeDir}

## 你的任务
基于 PRD 和 OpenSpec 设计功能测试用例。

## 输出要求
1. 测试用例列表
2. 测试覆盖范围
3. 测试数据准备

保存到: \`${workspacePath || `workspace/${pipelineId}`}/tester/test-cases.md\`
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

保存到: \`${workspacePath || `workspace/${pipelineId}`}/tester/test-results.md\`
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

保存到: \`${workspacePath || `workspace/${pipelineId}`}/tester/security-scan.md\`
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

保存到: \`${workspacePath || `workspace/${pipelineId}`}/output/test-report.md\`
和: \`${workspacePath || `workspace/${pipelineId}`}/output/security-report.md\`
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

保存到: \`${workspacePath || `workspace/${pipelineId}`}/ops/env-analysis.md\`
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

保存到: \`${workspacePath || `workspace/${pipelineId}`}/ops/\`
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

保存到: \`${workspacePath || `workspace/${pipelineId}`}/ops/.github/workflows/\`
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

保存到: \`${workspacePath || `workspace/${pipelineId}`}/ops/\`
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
    
    // 执行 OpenCode（带重试机制）
    let rawOutput;
    let retryCount = 0;
    
    while (retryCount <= MAX_RETRIES) {
      try {
        rawOutput = await runOpenCode(prompt, {
          model: AGENT_MODELS[agentName] || 'opencode/big-pickle',
          agentName,
          skillName: skill
        });
        break; // 成功，跳出重试循环
      } catch (error) {
        retryCount++;
        if (error.message === 'TIMEOUT_RETRY' && retryCount <= MAX_RETRIES) {
          console.log(`   🔄 超时重试 ${retryCount}/${MAX_RETRIES}...`);
          await new Promise(r => setTimeout(r, 1000)); // 等待1秒后重试
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
 * 查找 OpenSpec change 目录
 */
async function findOpenSpecChangeDir(projectPath) {
  const changesDir = path.join(projectPath, 'openspec', 'changes');
  try {
    const changes = await fs.readdir(changesDir);
    if (changes.length > 0) {
      return path.join(changesDir, changes[0]);
    }
  } catch (e) {}
  return null;
}

/**
 * 执行 Sprint 迭代
 */
// 定义每个角色的步骤数
const ROLE_STEPS = {
  product: 5,
  architect: 4,
  tech_coach: 1,   // 单步角色：整合产出，输出技术实现文档
  developer: 6,   // 项目初始化 → 后端配置 → 后端API → 前端配置 → 前端页面 → 文档
  tester: 4,
  ops: 4
};

async function runIteration(sprintId, roleIndex, customModel = null, startStep = null) {
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
  const projectId = sprint.projectId || sprintId;
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
    codePath: path.join(ROOT, 'projects', projectId, 'src'),
    openspecPath: path.join(ROOT, 'projects', projectId, 'openspec')
  };

  // 获取 workspace 路径
  const workspacePath = context.workspacePath;
  
  // 加载前面角色的输出
  for (let i = 0; i < roleIndex; i++) {
    const prevIteration = sprint.iterations[i];
    if (prevIteration?.output) {
      if (prevIteration.role === 'product') {
        context.prdOutput = prevIteration.output;
      } else if (prevIteration.role === 'architect') {
        context.openspec = prevIteration.output;
        // 扫描 OpenSpec change 目录
        context.openspecChangeDir = await findOpenSpecChangeDir(context.projectPath);
      } else if (prevIteration.role === 'developer') {
        context.developerOutput = prevIteration.output;
      }
      context.previousOutput = prevIteration.output;
    }
  }

  const iteration = sprint.iterations[roleIndex];
  const role = iteration?.role;
  
  // 收集测试环境信息（如果是 tester 角色）
  if (role === 'tester') {
    context.testEnvironmentUrl = iteration?.testEnvironmentUrl || null;
  }
  
  // 获取当前步骤索引 - 处理 NaN 情况
  let stepIdx = null;
  if (startStep !== undefined && startStep !== null) {
    const parsed = parseInt(startStep);
    stepIdx = isNaN(parsed) ? 0 : parsed;
  }
  console.log(`   📊 startStep: ${startStep}, parsed: ${stepIdx}, role: ${role}`);
  
  // 收集所有执行过的步骤（用于执行记录）
  const allSteps = [];
  for (let i = 0; i <= (stepIdx !== null ? stepIdx : (ROLE_STEPS[role] || 1) - 1); i++) {
    const stepName = getStepGuidance(role, i)?.split('\n')[0] || `步骤 ${i + 1}`;
    allSteps.push({ id: i + 1, name: stepName });
  }
  
  if (!role) {
    console.error('❌ 角色不存在');
    return;
  }

  const info = ROLE_INFO[role] || { icon: '🤖', name: role };
  console.log(`\n${info.icon} ${info.name}`);
  console.log(`   状态: ${iteration?.status}`);
  
  // 生成 Prompt
  let prompt;
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
        sprintId,
        rawInput: context.rawInput,
        workspacePath,
        prd: context.prdOutput,
        stepIndex: stepIdx
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
        sprintId,
        rawInput: context.rawInput,
        workspacePath,
        openspec: context.openspec,
        openspecChangeDir: context.openspecChangeDir,
        techCoachOutput: context.techCoachOutput,
        stepIndex: stepIdx
      });
      break;
    case 'tester':
      prompt = generateTesterPrompt({
        sprintId,
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
   
  // 如果指定了 stepIndex，添加步骤指示
  console.log(`   📊 startStep: ${startStep}, parsed: ${stepIdx}, role: ${role}`);
  if (stepIdx !== null) {
    const stepGuidance = getStepGuidance(role, stepIdx);
    prompt = `${prompt}\n\n## 当前执行步骤\n${stepGuidance}`;
    console.log(`   📝 步骤指示: ${stepGuidance ? stepGuidance.split('\n')[0] : '无'}`);
  } else {
    console.log(`   📝 步骤指示: 未指定步骤`);
  }
   
  console.log(`   📋 Prompt 长度: ${prompt.length} 字符`);
  
  // 更新状态为运行中
  await axios.put(`${API_BASE}/api/sprints/${sprintId}/iterations/${roleIndex}/output`, {
    output: '正在执行...'
  });
  
  try {
    // 执行 OpenCode - 优先使用传入的模型，否则使用环境变量，最后用默认
    const model = customModel || process.env.AGENT_MODEL || AGENT_MODELS[role] || 'opencode/big-pickle';
    console.log(`   🎯 使用模型: ${model}`);
    
    // 根据角色和步骤确定需要加载的 skill
    const stepSkills = ROLE_STEP_SKILLS[role];
    const currentSkill = (stepIdx !== null && stepSkills && stepSkills[stepIdx]) || null;
    if (currentSkill) {
      console.log(`   📦 步骤 ${stepIdx + 1} 使用 Skill: ${currentSkill}`);
    } else if (stepIdx !== null) {
      console.log(`   📦 步骤 ${stepIdx + 1} 不需要 Skill`);
    }
    
    // Tester 角色：根据是否有测试环境决定执行方式
    const hasTestEnv = role === 'tester' && context.testEnvironmentUrl;
    const rawOutput = await runOpenCode(prompt, {
      model: model,
      agentName: role,
      skillName: currentSkill,
      usePure: role !== 'tester' || !hasTestEnv,  // 无环境时使用 --pure，有环境时保留 gstack 插件
      qaInstruction: (role === 'tester' && hasTestEnv) ? QA_INSTRUCTION : null  // 有环境时注入轻量 QA 指令
    });
    
    console.log(`   ✅ 执行完成，输出长度: ${rawOutput.length} 字符`);
    
    // 解析输出 - product 角色需要解析 JSON，其他角色直接保存
    let output = rawOutput;
    if (role === 'product') {
      const parsed = parseOpenCodeOutput(rawOutput);
      output = parsed.text || rawOutput;
    }
    
    // 确保输出不为空
    if (!output || output.trim() === '') {
      output = `${role} 执行完成，但未生成有效输出`;
    }
    
    // 保存输出
    await axios.put(`${API_BASE}/api/sprints/${sprintId}/iterations/${roleIndex}/output`, {
      output
    });
    
    console.log(`   ✅ 输出已保存`);
    
    // 检查是否需要继续执行后续步骤
    const totalSteps = ROLE_STEPS[role] || 1;
    const currentStep = stepIdx !== null ? stepIdx + 1 : totalSteps;
    
    if (stepIdx !== null && currentStep < totalSteps) {
      // 继续执行下一步骤
      console.log(`\n   🔄 步骤 ${currentStep + 1}/${totalSteps} 准备中...`);
      
      // 等待 2 秒后继续执行下一步
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 递归执行下一步骤
      return await runIteration(sprintId, roleIndex, customModel, currentStep);
    }
    
    console.log(`\n   ✅ 所有步骤执行完成 (共 ${totalSteps} 步骤)`);
    
    // 保存最终输出到 iteration
    await axios.put(`${API_BASE}/api/sprints/${sprintId}/iterations/${roleIndex}/output`, {
      output: output || `${role} 执行完成`
    });
    
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
      output: `执行失败: ${error.message}`
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
  const customModel = args[2]; // 可选的模型参数
  const stepIndex = args[3] !== undefined ? parseInt(args[3]) : null;
  
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
  
  // 获取角色名称和步骤数
  const roleName = ['ba', 'product', 'architect', 'tech_coach', 'developer', 'tester', 'ops', 'evolver', 'ghost', 'creative'][roleIndex] || 'unknown';
  const totalSteps = ROLE_STEPS[roleName] || 1;
  
  // 如果没有指定 stepIndex，从第 0 步开始（会连续执行所有步骤）
  const startStep = stepIndex !== undefined ? stepIndex : 0;
  console.log(`🎯 执行角色: ${roleName}, 步骤: ${startStep + 1}-${totalSteps} (共${totalSteps}步)`);

  try {
    await runIteration(sprintId, roleIndex, customModel, startStep);
  } catch (error) {
    console.error('❌ 执行失败:', error);
    process.exit(1);
  }
}

main();
