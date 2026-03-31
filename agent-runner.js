#!/usr/bin/env node
/**
 * AI Team Pipeline Agent Executor
 * 
 * 集成 OpenCode + Superpowers Skills
 * - 产品经理 → brainstorming skill
 * - 架构师 → plan-eng-review skill
 * - 测试 → qa skill
 * - 开发 → TDD workflow
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const WORKSPACE = path.join(ROOT, 'workspace');
const API_BASE = 'http://localhost:3000';

// 验证工作目录
console.log(`📁 ROOT: ${ROOT}`);
console.log(`📁 WORKSPACE: ${WORKSPACE}`);

// 保存文件到 workspace
async function saveToWorkspace(pipelineId, role, files) {
  const roleDir = path.join(WORKSPACE, pipelineId, role);
  console.log(`   📂 创建目录: ${roleDir}`);
  await fs.mkdir(roleDir, { recursive: true });
  
  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(roleDir, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    
    if (typeof content === 'object') {
      await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf-8');
    } else {
      await fs.writeFile(filePath, content, 'utf-8');
    }
    console.log(`   📁 已保存: ${role}/${filename} (${Buffer.byteLength(JSON.stringify(content), 'utf-8')} bytes)`);
  }
  
  // 验证文件
  const savedFiles = await fs.readdir(roleDir);
  console.log(`   ✅ ${role} 目录文件: ${savedFiles.join(', ')}`);
}

// 根据角色保存文件
async function saveAgentFiles(pipelineId, agentName, rawText, structured) {
  const pipeline = await getPipeline(pipelineId);
  const workspacePath = path.join(WORKSPACE, pipelineId);
  
  switch (agentName) {
    case 'product':
      // 提取并保存 PRD
      const prdMatch = rawText.match(/```json\n?([\s\S]*?)\n?```/) || 
                       rawText.match(/```\n?([\s\S]*?)\n?```/);
      if (prdMatch) {
        try {
          const prd = JSON.parse(prdMatch[1]);
          await saveToWorkspace(pipelineId, 'product', {
            'prd.json': prd,
            'prd.md': `# ${prd.title || '产品需求文档'}\n\n${prd.summary || ''}\n\n## 用户故事\n${(prd.userStories || []).map(s => `- **${s.id}**: ${s.iWant}`).join('\n')}\n\n## 功能清单\n${(prd.features || []).map(f => `- **${f.id}**: ${f.name} (${f.priority})`).join('\n')}`
          });
        } catch (e) {
          console.log(`   ⚠️ PRD 解析失败，保存原始文本`);
          await saveToWorkspace(pipelineId, 'product', { 'output.txt': rawText });
        }
      } else {
        // 没有 JSON，保存原始输出
        await saveToWorkspace(pipelineId, 'product', { 'output.txt': rawText });
      }
      break;
      
    case 'architect':
      // 提取并保存架构文档
      const yamlMatch = rawText.match(/```yaml\n?([\s\S]*?)\n?```/i) || 
                        rawText.match(/```openapi\n?([\s\S]*?)\n?```/i);
      const mdMatch = rawText.match(/```mermaid\n?([\s\S]*?)\n?```/g);
      
      const files = {};
      
      // OpenSpec
      if (yamlMatch) {
        files['openspec.yaml'] = yamlMatch[1];
      }
      
      // Architecture diagram
      if (mdMatch) {
        files['architecture.md'] = '# 架构图\n\n' + mdMatch.join('\n\n');
      }
      
      // User selection
      if (structured.options) {
        files['selection-options.json'] = structured;
      }
      if (pipeline.context?.userSelection) {
        files['selection.json'] = pipeline.context.userSelection;
      }
      
      // General architecture doc
      if (Object.keys(files).length === 0 || rawText.length > 500) {
        files['architecture.md'] = rawText.slice(0, 10000);
      }
      
      await saveToWorkspace(pipelineId, 'architect', files);
      break;
      
    case 'developer':
      // 开发者文件 - 提取代码块
      const codeBlocks = rawText.match(/```(?:javascript|js|typescript|ts|html|css|jsx|tsx|json|py|python|bash|sh)\n?([\s\S]*?)\n?```/g) || [];
      const codeFiles = {};
      
      for (const block of codeBlocks) {
        const langMatch = block.match(/```(\w+)/);
        const codeMatch = block.match(/```\w+\n?([\s\S]*?)\n?```/);
        
        if (codeMatch) {
          const lang = langMatch?.[1] || 'txt';
          const ext = { 
            javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts',
            html: 'html', css: 'css', jsx: 'jsx', tsx: 'tsx',
            json: 'json', python: 'py', py: 'py', bash: 'sh', sh: 'sh'
          }[lang] || 'txt';
          
          // 生成文件名
          const existingFiles = Object.keys(codeFiles).filter(k => k.startsWith('generated-')).length;
          const filename = `generated-${existingFiles + 1}.${ext}`;
          codeFiles[filename] = codeMatch[1].trim();
        }
      }
      
      // 提取 README（如果有）
      const readmeMatch = rawText.match(/```markdown\n?([\s\S]*?)\n?```/i) || 
                          rawText.match(/```md\n?([\s\S]*?)\n?```/i);
      if (readmeMatch) {
        codeFiles['README.md'] = readmeMatch[1];
      } else {
        // 提取普通文本中的 README 内容
        const readmeTextMatch = rawText.match(/#+\s*README[\s\S]*?(?=\n```|\n#|\n\n\n|$)/i);
        if (readmeTextMatch) {
          codeFiles['README.md'] = readmeTextMatch[0];
        }
      }
      
      // 保存完整的原始输出（包含所有内容）
      codeFiles['full-output.md'] = rawText;
      
      // 如果没有生成任何文件，至少保存原始输出
      if (Object.keys(codeFiles).length === 1 && codeFiles['full-output.md']) {
        codeFiles['README.md'] = `# 开发文档\n\nPipeline: ${pipelineId}\n需求: ${pipeline.rawInput}\n\n生成时间: ${new Date().toISOString()}\n\n---\n\n${rawText.slice(0, 5000)}`;
      }
      
      await saveToWorkspace(pipelineId, 'developer', codeFiles);
      break;
      
    case 'tester':
      // 测试报告
      const testMatch = rawText.match(/```json\n?([\s\S]*?)\n?```/);
      if (testMatch) {
        try {
          const report = JSON.parse(testMatch[1]);
          await saveToWorkspace(pipelineId, 'tester', {
            'report.json': report,
            'bugs': report.bugs || []
          });
        } catch (e) {
          await saveToWorkspace(pipelineId, 'tester', { 'report-raw.txt': rawText });
        }
      } else {
        await saveToWorkspace(pipelineId, 'tester', { 'test-report.md': rawText });
      }
      break;
      
    case 'ops':
      // 运维配置
      const dockerMatch = rawText.match(/```dockerfile\n?([\s\S]*?)\n?```/i);
      const composeMatch = rawText.match(/```yaml\n?([\s\S]*?)\n?```/i);
      
      const opsFiles = {};
      if (dockerMatch) opsFiles['Dockerfile'] = dockerMatch[1];
      if (composeMatch) opsFiles['docker-compose.yml'] = composeMatch[1];
      
      await saveToWorkspace(pipelineId, 'ops', opsFiles);
      break;
      
    case 'ghost':
      await saveToWorkspace(pipelineId, 'ghost', { 'security-audit.md': rawText });
      break;
      
    case 'creative':
      await saveToWorkspace(pipelineId, 'creative', { 'design-review.md': rawText });
      break;
      
    case 'evolver':
      await saveToWorkspace(pipelineId, 'evolver', { 'refactor-report.md': rawText });
      break;
      
    case 'tech_coach':
      await saveToWorkspace(pipelineId, 'tech_coach', { 'tech-implementation.md': rawText });
      break;
  }
}

// Superpowers Skill 映射
const ROLE_SKILLS = {
  product: 'brainstorming',
  architect: 'plan-eng-review',
  tester: 'qa',
  developer: 'test-driven-development',
  ops: 'ship',
  ghost: 'cso'
};

// Agent 配置
const AGENT_CONFIG = {
  product: { model: 'opencode/big-pickle' },
  architect: { model: 'opencode/big-pickle' },
  developer: { model: 'opencode/big-pickle' },
  tester: { model: 'opencode/big-pickle' },
  tech_coach: { model: 'opencode/gpt-5-nano' },
  ops: { model: 'opencode/gpt-5-nano' },
  ghost: { model: 'opencode/gpt-5-nano' },
  creative: { model: 'opencode/big-pickle' },
  evolver: { model: 'opencode/gpt-5-nano' }
};

// Agent 提示词
const AGENT_PROMPTS = {
  product: (ctx) => `
# 角色：产品经理 (Product Manager)
# 使用 brainstorming skill 进行需求分析

用户需求: ${ctx.rawInput}

## 你的任务
1. 使用 brainstorming skill 分析需求
2. 生成 PRD 文档
3. 保存到: ${WORKSPACE}/${ctx.pipelineId}/product/prd.json

## PRD 格式
{
  "title": "产品名称",
  "summary": "一句话描述",
  "userStories": [
    {"id": "US-001", "asA": "角色", "iWant": "功能", "soThat": "价值", "priority": "HIGH", "acceptanceCriteria": []}
  ],
  "features": [
    {"id": "F-001", "name": "功能名称", "description": "描述", "priority": "HIGH"}
  ]
}
`,

  architect: (ctx) => `
# 角色：架构师 (System Architect)
# 使用 plan-eng-review skill 进行架构设计

## 用户需求
${ctx.rawInput}

## PRD 位置
${WORKSPACE}/${ctx.pipelineId}/product/prd.json

## 你的任务
1. 读取 PRD 文件（如果存在）
2. 根据需求设计架构方案
3. 输出技术选型选项供用户选择

## 技术选型选项
请提供 2-3 个技术栈方案，用清晰的文字描述：

**方案 A：简约轻量**
- 前端: React + Vite
- 后端: Node.js + Express
- 数据库: SQLite
- 部署: Vercel / Netlify
- 优点: 开发快、成本低、易于维护
- 适用场景: 小型项目、个人项目、原型验证
- 预估时间: 1-2周

**方案 B：标准全栈**
- 前端: Next.js (React 全家桶)
- 后端: Express / Fastify
- 数据库: PostgreSQL
- 部署: AWS / 阿里云
- 优点: 全栈统一、生态完善、可扩展
- 适用场景: 中型项目、SaaS产品
- 预估时间: 2-4周

**方案 C：企业级**
- 前端: React + TypeScript
- 后端: Spring Boot (Java)
- 数据库: MySQL
- 部署: Kubernetes
- 优点: 高并发、企业级安全、微服务架构
- 适用场景: 大型项目、企业应用
- 预估时间: 1-2月

**推荐方案**: B（标准全栈）

请回复 A、B 或 C 选择方案，我将继续生成详细的架构设计文档。

## 用户选择后（等用户回复 A/B/C）
生成架构图并保存到 ${WORKSPACE}/${ctx.pipelineId}/architect/:
- openspec.yaml (OpenAPI 规范)
- architecture.md (包含 Mermaid 架构图)
- selection.json (用户选择信息)
`,

  developer: (ctx) => `
# 角色：开发工程师 (Software Developer)
# 使用 test-driven-development skill 进行开发

## 用户需求
${ctx.rawInput}

## 参考文档
- PRD: ${WORKSPACE}/${ctx.pipelineId}/product/prd.json
- 架构设计: ${WORKSPACE}/${ctx.pipelineId}/architect/architecture.md

## 你的任务
1. 读取上述参考文档
2. 创建项目结构到: ${WORKSPACE}/${ctx.pipelineId}/developer/
3. 生成实际可运行的代码文件

## 必须完成的工作

### 1. 核心代码开发
- 根据需求开发完整功能代码
- 确保代码可运行、可测试
- 遵循选择的技術栈方案

### 2. 开发文档 (必须包含以下内容)

**文件: ${WORKSPACE}/${ctx.pipelineId}/developer/README.md**
必须包含:

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
必须列出所有开发的接口，例如:
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

**重要**: 
1. 必须生成真实可运行的代码
2. README.md 必须完整包含上述所有章节
3. API 接口文档必须详细列出每个接口的用途
`,

  tester: (ctx) => `
# 角色：测试工程师 (QA Tester)
# 使用 qa skill 进行测试

## 代码位置
${WORKSPACE}/${ctx.pipelineId}/developer/

## 你的任务
1. 使用 qa skill 进行自动化测试
2. 生成测试报告
3. 保存到: ${WORKSPACE}/${ctx.pipelineId}/tester/report.json

## 测试报告格式
{
  "summary": {"total": 10, "passed": 8, "failed": 2},
  "bugs": [
    {"id": "BUG-001", "title": "...", "severity": "HIGH", "description": "..."}
  ]
}
`
};

// 解析 OpenCode JSON 输出
function parseOutput(rawOutput) {
  const lines = rawOutput.split('\n').filter(l => l.trim());
  const events = [];
  const texts = [];
  
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      events.push(event);
      
      // 提取文本内容 - 多种格式支持
      let content = null;
      
      // 格式1: event.part?.text (OpenCode 标准格式)
      if (event.part?.text) {
        content = event.part.text;
      }
      // 格式2: event.part?.content
      else if (event.part?.content) {
        content = event.part.content;
      }
      // 格式3: event.message?.content
      else if (event.message?.content) {
        content = event.message.content;
      }
      // 格式4: event.content
      else if (event.content) {
        content = event.content;
      }
      // 格式5: event.text
      else if (event.text) {
        content = event.text;
      }
      
      if (content) {
        texts.push(content);
      }
    } catch (e) {
      // 如果不是 JSON，添加到文本
      if (line.trim()) {
        texts.push(line);
      }
    }
  }
  
  console.log(`   📝 提取的文本数量: ${texts.length}`);
  
  return {
    events,
    text: texts.join('\n\n'),
    toolCalls: events.filter(e => e.type === 'tool_use')
  };
}

// 提取 JSON 数据
function extractJSON(text) {
  const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ||
                   text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {}
  }
  return null;
}

// 执行 OpenCode
async function runOpenCode(message, options = {}) {
  const { model = 'opencode/big-pickle', skill = null, timeout = 180000 } = options;
  
  // 写入临时文件
  const tmpFile = `/tmp/opencode-msg-${Date.now()}.txt`;
  await fs.writeFile(tmpFile, message, 'utf-8');
  
  return new Promise((resolve, reject) => {
    console.log(`   🚀 OpenCode: run --format json --model ${model}`);
    console.log(`   📝 Message length: ${message.length} chars`);
    
    // 使用 bash heredoc 方式
    const cmd = `bash -c 'opencode run --format json --model ${model} --dir "${ROOT}"' < "${tmpFile}"`;
    
    const proc = spawn('bash', ['-c', cmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: ROOT
    });
    
    console.log(`   ⚙️ Process PID: ${proc.pid}`);
    
    let stdout = '', stderr = '';
    let closed = false;
    
    proc.stdout.on('data', d => { 
      stdout += d.toString();
    });
    proc.stderr.on('data', d => {
      stderr += d.toString();
    });
    
    proc.on('close', async (code) => {
      // 删除临时文件
      try {
        await fs.unlink(tmpFile);
      } catch (e) {}
      
      if (closed) return;
      closed = true;
      console.log(`   📤 OpenCode 进程关闭: ${code}`);
      console.log(`   📊 stdout 长度: ${stdout.length}, stderr 长度: ${stderr.length}`);
      
      const output = stdout || stderr;
      if (output.length > 0) {
        console.log(`   📄 输出预览: ${output.slice(0, 200)}...`);
      }
      resolve(output);
    });
    
    proc.on('error', async (e) => {
      try {
        await fs.unlink(tmpFile);
      } catch (err) {}
      console.error(`   ❌ OpenCode 进程错误: ${e.message}`);
      reject(e);
    });
    
    // 超时处理
    const timeoutId = setTimeout(async () => {
      if (!closed) {
        console.log(`   ⏰ OpenCode 超时 (${timeout}ms)`);
        proc.kill('SIGKILL');
        try {
          await fs.unlink(tmpFile);
        } catch (e) {}
      }
    }, timeout);
    
    proc.on('close', () => clearTimeout(timeoutId));
  });
}

// API 辅助函数
async function getPipeline(id) {
  const { data } = await axios.get(`${API_BASE}/api/pipelines/${id}`);
  return data;
}

async function submitOutput(pipelineId, agent, output, status = 'completed') {
  await axios.post(`${API_BASE}/api/agent/${agent}/submit`, {
    pipelineId, output, status
  });
}

// 验证 Agent 输出完整性
async function validateAgentOutput(agentName, output, pipelineId) {
  const text = output.text || '';
  const issues = [];
  
  switch (agentName) {
    case 'product':
      // PRD 需要包含：用户故事、功能清单
      const hasUserStories = /用户故事|user story|US-\d+/i.test(text);
      const hasFeatures = /功能清单|feature|F-\d+/i.test(text);
      const hasAcceptance = /验收标准|acceptance|acceptance criteria/i.test(text);
      
      if (!hasUserStories) issues.push('缺少用户故事 (userStories)');
      if (!hasFeatures) issues.push('缺少功能清单 (features)');
      if (!hasAcceptance) issues.push('缺少验收标准 (acceptance criteria)');
      
      // 检查是否只是询问问题而没有生成 PRD
      if (/请选择|哪个|是什么\?/.test(text) && !hasFeatures) {
        issues.push('产品经理只提出了问题，未生成 PRD');
      }
      break;
      
    case 'architect':
      // 架构设计需要包含：技术选型、组件设计、API设计
      const hasTechSelection = /技术选型|tech stack|方案[ABC]/i.test(text);
      const hasComponent = /组件|component|架构图/i.test(text);
      const hasAPI = /API|接口|endpoint/i.test(text);
      
      if (!hasTechSelection) issues.push('缺少技术选型');
      if (!hasComponent) issues.push('缺少组件设计');
      if (!hasAPI) issues.push('缺少 API 设计');
      
      // 检查是否需要用户选择
      if (/请选择|A\)|B\)|C\)/.test(text) && !/用户已选择/.test(text)) {
        issues.push('架构师等待用户选择技术方案');
      }
      break;
      
    case 'tech_coach':
      // 侦察报告需要包含：可行性分析、风险识别
      const hasFeasibility = /可行|feasibility|风险|risk/i.test(text);
      const hasRecommendations = /建议|recommendation|路线/i.test(text);
      
      if (!hasFeasibility) issues.push('缺少可行性分析');
      if (!hasRecommendations) issues.push('缺少建议');
      break;
      
    case 'developer':
      // 开发需要包含：代码文件、README
      const hasCode = /src\/|components|App\.|package\.json/i.test(text);
      const hasReadme = /README|项目结构|快速启动/i.test(text);
      
      if (!hasCode) issues.push('缺少代码文件');
      if (!hasReadme) issues.push('缺少 README 文档');
      break;
      
    case 'tester':
      // 测试报告需要包含：测试结果、bug 列表
      const hasSummary = /passed|failed|total|测试结果/i.test(text);
      const hasBugs = /bug|issue|问题/i.test(text);
      
      if (!hasSummary) issues.push('缺少测试结果摘要');
      if (!hasBugs) issues.push('缺少 Bug 列表');
      break;
      
    case 'ops':
      // 运维配置需要包含：Dockerfile 或部署配置
      const hasDocker = /Dockerfile|Docker|docker/i.test(text);
      const hasDeploy = /部署|deploy|CI\/CD/i.test(text);
      
      if (!hasDocker && !hasDeploy) issues.push('缺少部署配置');
      break;
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
}

// 处理验证失败的情况
async function handleValidationFailure(pipelineId, agentName, issues, output) {
  console.log(`   ⚠️ ${agentName} 输出验证失败:`);
  issues.forEach(issue => console.log(`      - ${issue}`));
  
  // 标记状态为需要用户输入
  await axios.put(`${API_BASE}/api/pipelines/${pipelineId}`, {
    status: 'waiting_input',
    context: {
      waitingFor: agentName,
      issues: issues,
      lastOutput: output.textSummary || output.text?.slice(0, 500)
    }
  });
  
  console.log(`   ⏳ 流水线已暂停，等待修复或用户输入...`);
  return true;
}

// 执行单个 Agent
async function executeAgent(pipelineId, agentName) {
  const pipeline = await getPipeline(pipelineId);
  const config = AGENT_CONFIG[agentName];
  const skill = ROLE_SKILLS[agentName];
  
  if (!config) {
    console.log(`   ⚠️ 未知角色: ${agentName}`);
    return null;
  }
  
  const context = {
    pipelineId: pipeline.id,
    rawInput: pipeline.rawInput,
    userSelection: pipeline.context?.userSelection
  };
  
  let message = AGENT_PROMPTS[agentName]?.(context) || `执行 ${agentName} 任务`;
  
  // 如果是架构师且有用户选择
  if (agentName === 'architect' && context.userSelection) {
    message += `\n\n用户已选择: ${context.userSelection.option}\n请根据选择继续生成架构图。`;
  }
  
  console.log(`\n🤖 执行 ${agentName}...`);
  console.log(`   Skill: ${skill || '无'}`);
  console.log(`   Model: ${config.model}`);
  
  try {
    const rawOutput = await runOpenCode(message, {
      model: config.model,
      skill: skill
    });
    
    console.log(`   📊 Raw output length: ${rawOutput.length}`);
    
    const parsed = parseOutput(rawOutput);
    console.log(`   📊 Parsed text length: ${parsed.text.length}`);
    console.log(`   📊 Events count: ${parsed.events.length}`);
    
    const structured = extractJSON(parsed.text) || { text: parsed.text };
    
    structured.textSummary = parsed.text.slice(0, 2000);
    structured.fullOutput = parsed.text;
    structured.toolCalls = parsed.toolCalls.length;
    structured.savedFiles = [];
    
    console.log(`   📊 Structured text length: ${(structured.textSummary || '').length}`);
    
    // 验证输出完整性
    const validation = await validateAgentOutput(agentName, structured, pipelineId);
    console.log(`   🔍 验证结果: ${validation.isValid ? '通过' : '失败'}`);
    
    if (!validation.isValid) {
      // 验证失败，暂停流水线
      const shouldPause = await handleValidationFailure(pipelineId, agentName, validation.issues, structured);
      if (shouldPause) {
        await submitOutput(pipelineId, agentName, structured, 'needs_input');
        return structured;
      }
    }
    
    // 保存文件到 workspace
    try {
      await saveAgentFiles(pipelineId, agentName, parsed.text, structured);
      structured.savedFiles = [`workspace/${pipelineId}/${agentName}/`];
    } catch (e) {
      console.error(`   ❌ 保存文件失败:`, e.message);
      structured.saveError = e.message;
    }
    
    structured.validation = validation;
    await submitOutput(pipelineId, agentName, structured);
    
    // 如果是架构师且有 options，需要等待选择
    if (agentName === 'architect' && structured.options) {
      console.log(`   ⏳ 等待用户选择技术栈...`);
      await axios.put(`${API_BASE}/api/pipelines/${pipelineId}`, {
        status: 'waiting_selection'
      });
      return structured;
    }
    
    console.log(`   ✅ ${agentName} 完成`);
    return structured;
    
  } catch (e) {
    console.error(`   ❌ ${agentName} 失败:`, e.message);
    await submitOutput(pipelineId, agentName, { error: e.message }, 'failed');
    return null;
  }
}

// 流水线主循环
async function runPipeline(pipelineId) {
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`   流水线: ${pipelineId.slice(0, 8)}`);
  console.log(`═══════════════════════════════════════════════`);
  
  while (true) {
    const pipeline = await getPipeline(pipelineId);
    
    // 检查终止状态
    if (pipeline.status === 'abandoned') {
      console.log(`\n❌ 流水线已放弃: ${pipeline.abandonedReason || ''}`);
      break;
    }
    
    if (pipeline.status === 'completed' || pipeline.status === 'failed') {
      console.log(`\n✅ 流水线结束: ${pipeline.status}`);
      break;
    }
    
    // 暂停状态 - 持续等待直到用户恢复
    if (pipeline.status === 'paused') {
      console.log(`\n⏸️ 流水线已暂停，等待恢复...`);
      await new Promise(r => setTimeout(r, 5000));
      
      // 检查是否恢复运行
      const refreshed = await getPipeline(pipelineId);
      if (refreshed.status === 'running') {
        console.log(`\n▶️ 流水线恢复运行`);
        continue;
      }
      if (refreshed.status === 'abandoned') {
        console.log(`\n❌ 流水线已放弃`);
        break;
      }
      continue;
    }
    
    if (pipeline.status === 'waiting_selection') {
      // 检查是否有用户选择
      try {
        const { data: selection } = await axios.get(`${API_BASE}/api/pipelines/${pipelineId}/selection`);
        if (selection) {
          console.log(`\n📋 检测到选择: ${selection.option}`);
          await axios.put(`${API_BASE}/api/pipelines/${pipelineId}`, { status: 'running' });
          await executeAgent(pipelineId, 'architect');
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    
    // 验证失败等待输入状态
    if (pipeline.status === 'waiting_input') {
      const ctx = pipeline.context || {};
      console.log(`\n⏸️ 验证失败，流水线等待输入...`);
      console.log(`   等待角色: ${ctx.waitingFor}`);
      console.log(`   问题: ${(ctx.issues || []).join(', ')}`);
      
      // 检查是否恢复运行（用户手动修复后继续）
      const refreshed = await getPipeline(pipelineId);
      if (refreshed.status === 'running') {
        console.log(`\n▶️ 检测到恢复信号，重新执行当前阶段`);
        const currentStage = refreshed.currentStage;
        if (currentStage) {
          await executeAgent(pipelineId, currentStage);
        }
        continue;
      }
      if (refreshed.status === 'abandoned') {
        console.log(`\n❌ 流水线已放弃`);
        break;
      }
      
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    
    if (pipeline.status === 'pending') {
      await axios.post(`${API_BASE}/api/pipelines/${pipelineId}/start`);
      console.log(`\n▶️ 启动流水线`);
      continue;
    }
    
    const currentStage = pipeline.currentStage;
    if (!currentStage || currentStage === 'pending') break;
    
    await executeAgent(pipelineId, currentStage);
    await new Promise(r => setTimeout(r, 1000));
  }
}

// 主入口
async function main() {
  const [,, pipelineId] = process.argv;
  
  if (!pipelineId) {
    console.log(`
🤖 AI Team Pipeline Executor

用法: node agent-runner.js <pipeline-id>
    `);
    process.exit(1);
  }
  
  await runPipeline(pipelineId);
}

main().catch(console.error);
