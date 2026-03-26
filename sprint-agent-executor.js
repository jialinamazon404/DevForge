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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const WORKSPACE = path.join(ROOT, 'workspace');

// 从命令行参数获取 API_BASE，或使用默认值
const API_BASE = process.argv.find(arg => arg.startsWith('API_BASE='))?.split('=')[1] || 'http://localhost:3000';

// Skill 路径映射
const SKILL_PATHS = {
  brainstorming: '/Users/jialin.chen/.cache/opencode/node_modules/superpowers/skills/brainstorming/SKILL.md',
  'plan-eng-review': '/Users/jialin.chen/.claude/skills/gstack/plan-eng-review/SKILL.md',
  qa: '/Users/jialin.chen/.claude/skills/gstack/qa/SKILL.md',
  'test-driven-development': '/Users/jialin.chen/.cache/opencode/node_modules/superpowers/skills/test-driven-development/SKILL.md',
  ship: '/Users/jialin.chen/.claude/skills/gstack/ship/SKILL.md',
  cso: '/Users/jialin.chen/.claude/skills/gstack/cso/SKILL.md'
};

// 角色与 Skill 映射
const ROLE_SKILLS = {
  product: 'brainstorming',
  architect: 'plan-eng-review',
  tester: 'qa',
  developer: 'test-driven-development',
  ops: 'ship',
  ghost: 'cso'
};

// Agent 模型配置 - 使用实际可用的模型
const AGENT_MODELS = {
  product: 'opencode/big-pickle',
  architect: 'opencode/big-pickle',
  developer: 'opencode/big-pickle',
  tester: 'opencode/big-pickle',
  scout: 'opencode/gpt-5-nano',
  ops: 'opencode/gpt-5-nano',
  ghost: 'opencode/gpt-5-nano',
  creative: 'opencode/big-pickle',
  evolver: 'opencode/gpt-5-nano'
};

// 超时配置 (毫秒)
const TIMEOUT_CONFIG = {
  product: 120000,      // 2分钟
  architect: 120000,   // 2分钟
  developer: 600000,    // 10分钟（代码实现更复杂）
  tester: 180000,
  scout: 90000,
  ops: 90000
};

// 最大重试次数
const MAX_RETRIES = 2;

// 角色图标和名称
const ROLE_INFO = {
  product: { icon: '📋', name: '产品经理', name_en: 'Product Manager' },
  architect: { icon: '🏗️', name: '架构师', name_en: 'Architect' },
  scout: { icon: '🔍', name: '侦察兵', name_en: 'Scout' },
  developer: { icon: '💻', name: '开发者', name_en: 'Developer' },
  tester: { icon: '🧪', name: '测试工程师', name_en: 'Tester' },
  ops: { icon: '⚙️', name: '运维工程师', name_en: 'DevOps' },
  ghost: { icon: '👻', name: '安全幽灵', name_en: 'Security Ghost' },
  creative: { icon: '🎨', name: '创意总监', name_en: 'Creative Director' },
  evolver: { icon: '🔄', name: '进化顾问', name_en: 'Evolver' }
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
  const order = ['product', 'architect', 'scout', 'developer', 'tester', 'ops', 'ghost', 'creative', 'evolver'];
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
    case 'product': fileName = 'prd.md'; break;
    case 'architect': fileName = 'openspec.md'; break;
    case 'scout': fileName = 'scout-report.md'; break;
    case 'developer': fileName = 'dev-summary.md'; break;
    case 'tester': fileName = 'test-report.md'; break;
    case 'ops': fileName = 'ops-config.md'; break;
    case 'ghost': fileName = 'security-report.md'; break;
    case 'creative': fileName = 'design-review.md'; break;
    case 'evolver': fileName = 'evolver-report.md'; break;
    default: fileName = `${role}-output.md`;
  }
  
  const filePath = path.join(dir, fileName);
  const content = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  await fs.writeFile(filePath, content, 'utf-8');
  console.log(`   📄 输出已保存: ${fileName}`);
  return filePath;
}

/**
 * 执行 OpenCode 并获取输出（带超时和重试）
 */
async function runOpenCode(prompt, options = {}) {
  const { model = 'opencode/big-pickle', agentName = 'developer', retryCount = 0 } = options;
  
  // 获取对应角色的超时配置
  const timeout = TIMEOUT_CONFIG[agentName] || 180000;
  
  return new Promise((resolve, reject) => {
    // 创建临时文件存储 prompt
    const tmpFile = `/tmp/opencode-prompt-${Date.now()}.txt`;
    
    fs.writeFile(tmpFile, prompt, 'utf-8').then(() => {
      // 使用 OpenCode run 命令
      const cmd = `opencode run --format json --model "${model}" --dir "${ROOT}"`;
      
      console.log(`   🚀 启动 OpenCode: ${model}`);
      
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
 */
function parseOpenCodeOutput(rawOutput) {
  const lines = rawOutput.split('\n').filter(l => l.trim());
  const events = [];
  const texts = [];
  
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      events.push(event);
      
      // 提取文本内容
      let content = null;
      if (event.part?.text) content = event.part.text;
      else if (event.part?.content) content = event.part.content;
      else if (event.message?.content) content = event.message.content;
      else if (event.content) content = event.content;
      else if (event.text) content = event.text;
      
      if (content) {
        texts.push(typeof content === 'string' ? content : JSON.stringify(content));
      }
    } catch (e) {
      // 非 JSON 行当作文本处理
      if (line.trim()) {
        texts.push(line);
      }
    }
  }
  
  return {
    events,
    text: texts.join('\n\n'),
    toolCalls: events.filter(e => e.type === 'tool_use')
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
  const { pipelineId, rawInput, workspacePath } = context;
  
  return `# 角色：产品经理 (Product Manager)

## 用户需求
${rawInput}

## 工作目录
${workspacePath || `workspace/${pipelineId}`}

## 你的任务
**直接分析需求并生成完整的 PRD 文档**，不要向用户提问。

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
  "userPersonas": [
    {
      "id": "UP-001",
      "name": "用户群体名称",
      "age": "年龄范围",
      "description": "用户描述",
      "painPoints": ["痛点1", "痛点2"],
      "needs": "用户需求"
    }
  ],
  "userStories": [
    {
      "id": "US-001",
      "asA": "作为...",
      "iWant": "我想要...",
      "soThat": "以便...",
      "priority": "HIGH|MEDIUM|LOW",
      "acceptanceCriteria": ["Given... When... Then..."]
    }
  ],
  "functionalRequirements": [
    {
      "id": "FR-001",
      "name": "功能名称",
      "description": "功能描述",
      "priority": "HIGH|MEDIUM|LOW",
      "dependencies": [],
      "acceptanceCriteria": ["验收标准1", "验收标准2"]
    }
  ],
  "nonFunctionalRequirements": [
    {
      "id": "NFR-001",
      "name": "性能",
      "description": "性能要求描述"
    }
  ],
  "milestones": [
    {
      "id": "M1",
      "name": "里程碑名称",
      "description": "完成内容",
      "estimatedDuration": "预计工期"
    }
  ]
}
\`\`\`

## 输出文件
保存为 JSON 到: ${workspacePath || `workspace/${pipelineId}`}/product/prd.json

同时生成 Markdown 版本到: ${workspacePath || `workspace/${pipelineId}`}/product/prd.md

## 重要提醒
- 直接分析和生成，不要提问
- 用户故事要具体、可测试
- 验收标准使用 Given-When-Then 格式
- 必须生成真实的内容，不是模板
`;
}

/**
 * 生成 Architect Agent 的提示词 - 直接选择方案并生成架构，不提问
 */
function generateArchitectPrompt(context) {
  const { pipelineId, rawInput, workspacePath, prd } = context;
  
  let prdContext = '';
  if (prd) {
    prdContext = `
## PRD 文档（产品经理产出）
${typeof prd === 'string' ? prd : JSON.stringify(prd, null, 2)}
`;
  }
  
  return `# 角色：架构师 (System Architect)

## 用户原始需求
${rawInput}
${prdContext}

## 工作目录
${workspacePath || `workspace/${pipelineId}`}

## 你的任务
**直接选择一个技术方案并生成完整的架构设计文档**，不要向用户提问选择哪个方案。

## 技术选型决策规则
根据需求复杂度自动选择最合适的方案：

- **简单需求**（工具类、个人项目、原型验证、无复杂后端需求）：
  - 技术栈：原生 HTML + CSS + JavaScript
  - 部署：静态文件托管（GitHub Pages / Vercel / Netlify）
  - 特点：零依赖、快速开发
  
- **标准需求**（中小型项目、需要后端、有限的用户量）：
  - 技术栈：Vue 3 + Vite (前端) + Express.js (后端) + SQLite/PostgreSQL
  - 部署：Vercel + Railway / Render
  - 特点：全栈统一、生态完善
  
- **复杂需求**（企业级、大用户量、微服务架构）：
  - 技术栈：React + TypeScript + Spring Boot + MySQL + Redis
  - 部署：Kubernetes + AWS
  - 特点：高并发、企业级安全

## 输出要求

生成完整的架构文档，必须包含：

### 1. 系统架构图（使用 Mermaid）
\`\`\`mermaid
graph TD
    A[用户] --> B[前端]
    B --> C[API]
    C --> D[业务逻辑]
    D --> E[(数据库)]
\`\`\`

### 2. 技术选型（明确选定的方案）
- 选定方案名称和版本
- 每个组件的技术选型理由
- 优点和潜在风险

### 3. 组件设计
- 核心组件列表
- 每个组件的职责
- 组件间的接口

### 4. API 设计
每个 API 端点包含：
- HTTP 方法和路径
- 请求参数和类型
- 响应格式
- 错误码定义

### 5. 数据模型
- 实体定义
- 字段类型和约束
- 关系（1:1, 1:N, N:M）

### 6. 目录结构
\`\`\`
项目/
├── src/
│   ├── components/
│   ├── pages/
│   ├── api/
│   └── utils/
├── tests/
└── package.json
\`\`\`

## 输出格式

1. 保存为 YAML 格式到: ${workspacePath || `workspace/${pipelineId}`}/architect/openspec.yaml
2. 保存架构图到: ${workspacePath || `workspace/${pipelineId}`}/architect/architecture.md
3. 输出完整的架构设计文档

## 重要提醒
- 直接选择最合适的方案并生成设计，不要询问用户
- 架构图要清晰展示数据流和组件关系
- 必须生成真实的内容，不是模板
`;
}

/**
 * 生成 Scout Agent 的提示词
 */
function generateScoutPrompt(context) {
  const { pipelineId, rawInput, workspacePath } = context;
  
  return `# 角色：侦察兵 (Scout)

## 用户需求
${rawInput}

## 工作目录
${workspacePath || `workspace/${pipelineId}`}

## 你的任务

1. **理解技术要求** - 分析 OpenSpec 中的技术栈需求
2. **探索代码库** - 检查 workspace 中是否有可复用的代码
3. **分析依赖** - 识别需要新增的依赖包
4. **验证可行性** - 确认技术选型是否可行
5. **识别风险** - 发现潜在的技术风险

## 输出要求

生成侦察报告，包含：

1. **发现列表** - 代码复用机会、技术债等
2. **相似实现参考** - 找到的类似实现
3. **依赖分析** - 现有依赖 vs 需要新增
4. **可行性评估** - 技术难度评估
5. **风险识别** - 主要风险点和缓解措施
6. **建议** - 具体的实施建议

## 输出格式

保存为 Markdown 到: ${workspacePath || `workspace/${pipelineId}`}/scout/scout-report.md
`;
}

/**
 * 生成 Developer Agent 的提示词 - 必须生成开发文档和API接口文档
 */
function generateDeveloperPrompt(context) {
  const { pipelineId, rawInput, workspacePath, openspec } = context;
  
  let specContext = '';
  if (openspec) {
    specContext = `
## OpenSpec（架构师产出）
${typeof openspec === 'string' ? openspec : JSON.stringify(openspec, null, 2)}
`;
  }
  
  return `# 角色：开发者 (Software Developer)

## 用户需求
${rawInput}
${specContext}

## 工作目录
${workspacePath || `workspace/${pipelineId}`}/developer

## 你的任务

1. **创建项目结构** - 按照 OpenSpec 创建合理的目录结构
2. **实现核心功能** - 根据功能清单实现代码
3. **编写测试** - 使用 TDD 方式编写单元测试
4. **生成开发文档** - 必须包含 README.md 和 API 接口文档

## 必须生成的文档（重要）

### 1. README.md（开发文档）
必须包含以下所有章节：

\`\`\`markdown
# 项目名称

## 📋 项目概述
- 项目名称
- 功能简介
- 技术栈

## 🚀 快速启动
\`\`\`bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 生产构建
npm run build
\`\`\`

## 📡 API 接口文档
| 方法 | 路径 | 描述 | 请求参数 | 响应格式 |
|------|------|------|----------|----------|
| GET | /api/users | 获取用户列表 | page, limit | {data: [], total: 0} |
| POST | /api/users | 创建用户 | {name, email} | {id, name, email} |

## 📁 项目结构
\`\`\`
src/
├── components/    # 组件
├── pages/         # 页面
├── api/           # API 请求
└── utils/         # 工具函数
\`\`\`

## ⚙️ 环境变量
\`\`\`
DATABASE_URL=...
API_KEY=...
\`\`\`

## 📝 开发记录
- 开发的日期和时间
- 完成的功能清单
- 遇到的问题和解决方案
\`\`\`

### 2. API.md（详细的接口文档）
如果项目有后端 API，必须生成详细的 API 文档，包含：
- 每个端点的详细说明
- 请求参数详情
- 响应示例
- 错误码说明

### 3. 源代码
- 实现 OpenSpec 中定义的所有功能
- 确保代码可运行、可测试
- 遵循选择的技術栈方案
- 不要使用占位符或 TODO 注释

## 输出格式

将所有代码和文档保存到: ${workspacePath || `workspace/${pipelineId}`}/developer/
  - README.md（必须）
  - API.md（如果有 API）
  - src/（源代码）

## 重要提醒
- README.md 必须完整包含所有章节，不能省略
- API 接口文档必须详细列出每个接口
- 必须生成真实可运行的代码，不是伪代码
`;
}

/**
 * 生成 Tester Agent 的提示词
 */
function generateTesterPrompt(context) {
  const { pipelineId, rawInput, workspacePath } = context;
  
  return `# 角色：测试工程师 (QA Tester)

## 用户需求
${rawInput}

## 代码位置
${workspacePath || `workspace/${pipelineId}`}/developer

## 你的任务

1. **阅读代码** - 理解开发者产出的代码
2. **设计测试用例** - 基于功能需求设计测试用例
3. **执行测试** - 运行测试并记录结果
4. **报告 Bug** - 发现的问题要详细记录

## 环境说明

如果后端服务需要特定环境才能启动（如数据库依赖、端口占用等），
可以先进行代码审查和静态分析，在报告中说明：
- "无法启动后端服务（缺少环境），进行静态代码审查"
- 列出代码中发现的问题

## 输出要求

生成测试报告，包含：

1. **测试摘要**
   - 总用例数
   - 通过数
   - 失败数
   - 跳过数

2. **Bug 列表**
   - Bug ID
   - 标题
   - 严重程度 (CRITICAL/HIGH/MEDIUM/LOW)
   - 复现步骤
   - 截图（如有）

3. **性能数据**
   - LCP
   - FID
   - CLS
   - 加载时间

## 输出格式

保存为 JSON 格式到: ${workspacePath || `workspace/${pipelineId}`}/tester/report.json
`;
}

/**
 * 生成 Ops Agent 的提示词
 */
function generateOpsPrompt(context) {
  const { pipelineId, rawInput, workspacePath, developerOutput } = context;
  
  return `# 角色：运维工程师 (DevOps)

## 用户需求
${rawInput}

## 开发者产出位置
${workspacePath || `workspace/${pipelineId}`}/developer

## 你的任务

1. **读取启动命令** - 在开发者产出目录中找到启动命令（通常在 README.md 或 package.json 中）
2. **生成 Dockerfile** - 为前端和后端分别生成 Dockerfile
3. **生成部署脚本** - 创建 docker-compose.yml 或 Kubernetes 配置
4. **生成 CI/CD** - 创建 GitHub Actions 工作流

## 输出要求

生成以下文件：
- Dockerfile (前端)
- Dockerfile (后端)
- docker-compose.yml
- .github/workflows/deploy.yml (可选)

保存到: ${workspacePath || `workspace/${pipelineId}`}/ops/
`;
}

/**
 * 执行单个 Agent
 */
async function executeAgent(pipelineId, agentName, context = {}) {
  const startTime = Date.now();
  const info = ROLE_INFO[agentName] || { icon: '🤖', name: agentName };
  const skill = ROLE_SKILLS[agentName];
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${info.icon} ${info.name} (${info.name_en})`);
  console.log(`${'='.repeat(60)}`);
  
  // 更新阶段状态为运行中
  await axios.put(`${API_BASE}/api/pipelines/${pipelineId}/stage/${agentName}`, {
    status: 'running',
    startedAt: new Date().toISOString()
  }).catch(() => {});
  
  try {
    // 生成提示词
    let prompt;
    switch (agentName) {
      case 'product':
        prompt = generateProductPrompt({
          pipelineId,
          rawInput: context.rawInput || context.request?.rawInput || '',
          workspacePath: `workspace/${pipelineId}`
        });
        break;
      case 'architect':
        prompt = generateArchitectPrompt({
          pipelineId,
          rawInput: context.rawInput || context.request?.rawInput || '',
          workspacePath: `workspace/${pipelineId}`,
          prd: context.prd
        });
        break;
      case 'scout':
        prompt = generateScoutPrompt({
          pipelineId,
          rawInput: context.rawInput || context.request?.rawInput || '',
          workspacePath: `workspace/${pipelineId}`
        });
        break;
      case 'developer':
        prompt = generateDeveloperPrompt({
          pipelineId,
          rawInput: context.rawInput || context.request?.rawInput || '',
          workspacePath: `workspace/${pipelineId}`,
          openspec: context.openspec
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
    
    // 加载并应用 Skill（如果有）
    if (skill) {
      const skillContent = await loadSkill(skill);
      if (skillContent) {
        // Skill 内容可以作为额外上下文
        console.log(`   ✅ Skill 已加载: ${skill}`);
      }
    }
    
    // 执行 OpenCode（带重试机制）
    let rawOutput;
    let retryCount = 0;
    
    while (retryCount <= MAX_RETRIES) {
      try {
        rawOutput = await runOpenCode(prompt, {
          model: AGENT_MODELS[agentName] || 'opencode/big-pickle',
          agentName
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
 * 执行 Sprint 迭代
 */
async function runIteration(sprintId, roleIndex) {
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
  const context = {
    sprintId,
    roleIndex,
    rawInput: sprint.rawInput,
    localProjectPath: sprint.localProjectPath || null,
    prdOutput: null,
    openspec: null,
    developerOutput: null,
    codePaths: null,
    previousOutput: null,
    workspacePath: path.join(ROOT, 'workspace', sprintId)
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
      } else if (prevIteration.role === 'developer') {
        context.developerOutput = prevIteration.output;
      }
      context.previousOutput = prevIteration.output;
    }
  }

  const iteration = sprint.iterations[roleIndex];
  const role = iteration?.role;
  
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
        workspacePath
      });
      break;
    case 'architect':
      prompt = generateArchitectPrompt({
        sprintId,
        rawInput: context.rawInput,
        workspacePath,
        prd: context.prdOutput
      });
      break;
    case 'scout':
      prompt = generateScoutPrompt({
        sprintId,
        rawInput: context.rawInput,
        workspacePath
      });
      break;
    case 'developer':
      prompt = generateDeveloperPrompt({
        sprintId,
        rawInput: context.rawInput,
        workspacePath,
        openspec: context.openspec
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
        codePaths: context.codePaths
      });
      break;
    case 'ops':
      prompt = generateOpsPrompt({
        sprintId,
        rawInput: context.rawInput,
        workspacePath,
        developerOutput: context.developerOutput
      });
      break;
    default:
      prompt = `执行 ${info.name} 任务\n\n用户需求: ${context.rawInput}`;
  }
  
  console.log(`   📋 Prompt 长度: ${prompt.length} 字符`);
  
  // 更新状态为运行中
  await axios.put(`${API_BASE}/api/sprints/${sprintId}/iterations/${roleIndex}/output`, {
    output: '正在执行...'
  });
  
  try {
    // 执行 OpenCode
    const rawOutput = await runOpenCode(prompt, {
      model: 'opencode/big-pickle',
      agentName: role
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
  
  if (!sprintId) {
    console.log(`
🤖 AI Agent Executor (Sprint 模式)

用法: node sprint-agent-executor.js <sprint-id> [role-index]
    `);
    process.exit(1);
  }

  if (roleIndex === null) {
    console.log('❌ 需要指定 roleIndex');
    process.exit(1);
  }

  try {
    await runIteration(sprintId, roleIndex);
  } catch (error) {
    console.error('❌ 执行失败:', error);
    process.exit(1);
  }
}

main();
