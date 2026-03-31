# DevForge - AI 开发舰队

> 多角色 AI 软件开发团队编排系统 — 基于 OpenCode CLI + Superpowers Skills + gstack + OpenSpec

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Version](https://img.shields.io/badge/Version-2.0.0-red.svg)](package.json)

---

## 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [前置要求](#前置要求)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [使用指南](#使用指南)
- [核心架构](#核心架构)
- [角色定义](#角色定义)
- [决策路由](#决策路由)
- [执行器对比](#执行器对比)
- [Skills 映射](#skills-映射)
- [场景化工作流](#场景化工作流)
- [输出文件规范](#输出文件规范)
- [API 端点](#api-端点)
- [目录结构](#目录结构)
- [扩展指南](#扩展指南)
- [故障排除](#故障排除)
- [贡献指南](#贡献指南)
- [License](#license)

---

## 项目简介

DevForge（代号 "Moby Dick"）是一个**多角色 AI 软件开发团队编排系统**。它将传统软件开发团队中的角色（产品经理、架构师、开发者、测试工程师、运维工程师等）抽象为独立的 AI Agent，通过结构化流水线协同完成从需求分析到部署上线的完整软件交付流程。

### 解决什么问题

- **需求到代码的自动化**：用户用自然语言描述需求，系统自动拆解为 PRD → 架构设计 → 代码实现 → 测试 → 部署
- **多角色协同**：不同 Agent 各司其职，上游产出自动传递为下游输入，减少上下文丢失
- **可观测的执行过程**：每个 Agent 的思考过程、决策依据、交付物均可追溯和审查
- **灵活的路由策略**：根据任务复杂度自动选择执行路径（完整构建、快速审查、安全审计等）

### 适用场景

| 场景 | 路由 | 说明 |
|------|------|------|
| 从零构建新功能 | `BUILD` | 产品 → 架构 → 侦察 → 开发 → 测试 → 运维 → 进化 |
| 核心/高风险功能 | `CRITICAL` | 产品 → 架构 → 设计评审 → 开发 → 测试 → 进化 |
| 代码/设计审查 | `REVIEW` | 创意评审 → 安全审计 → 测试验证 |
| 技术可行性调研 | `QUERY` | 侦察兵快速评估 |
| 安全检查 | `SECURITY` | 安全审计 → 架构评估 |

---

## 核心特性

- **10+ 专业角色**：守门人、产品经理、架构师、开发教练、开发者、测试工程师、运维工程师、安全幽灵、创意总监、进化顾问
- **分步 Skill 注入**：每个角色在每个步骤只加载所需 Skill，避免上下文膨胀（≤30KB 注入，超过按需加载）
- **实时 Dashboard**：Vue 3 前端，支持项目管理、冲刺执行、实时进度推送（WebSocket）
- **双数据模型**：支持 Pipeline（旧版）和 Sprint（新版）两种执行模式
- **模型灵活配置**：每个角色可独立配置 AI 模型，通过 `model-config.json` 管理
- **多执行器**：提供 CLI、API、Sprint 三种执行方式，适配不同使用场景

---

## 前置要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 18.0 | 运行环境 |
| npm | ≥ 9.0 | 包管理（随 Node.js 安装） |
| OpenCode CLI | 最新版 | AI Agent 编排引擎 |
| gstack Skills | 最新版 | 浏览器测试 + QA 技能集 |
| Superpowers Skills | 最新版 | 通用技能库 |

### 安装 OpenCode CLI

```bash
npm install -g opencode
```

### 配置 gstack

```bash
cd ~/.claude/skills/gstack && ./setup
```

### API Key 配置

确保已配置 OpenCode 所需的 API Key（Anthropic / OpenAI 等），具体取决于 `model-config.json` 中配置的模型提供商。

---

## 快速开始

### 一键启动

```bash
cd /Users/jialin.chen/WorkSpace/DevForge
./start.sh
```

启动后访问：

- **Dashboard**: http://localhost:5173
- **API Server**: http://localhost:3000
- **WebSocket**: ws://localhost:3000

### 分步启动

```bash
# 1. 安装依赖
npm install
cd dashboard/server && npm install
cd ../.. && cd dashboard && npm install && cd ..

# 2. 启动 API Server（终端 1）
npm run api

# 3. 启动 Dashboard（终端 2）
npm run web
```

### 停止 / 重启

```bash
./stop.sh      # 停止所有服务（端口 3000 + 5173）
./restart.sh   # 停止并重新启动
```

### 默认登录

| 用户名 | 密码 |
|--------|------|
| `admin` | `admin` |

可通过环境变量 `ADMIN_USER` 和 `ADMIN_PASSWORD` 自定义。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | API Server 端口 |
| `HOST` | `0.0.0.0` | API Server 绑定地址 |
| `ADMIN_USER` | `admin` | 管理员用户名 |
| `ADMIN_PASSWORD` | `admin` | 管理员密码 |
| `API_BASE` | `http://localhost:3000` | Agent 执行器连接的 API 地址 |
| `AGENT_MODEL` | - | 覆盖默认模型配置 |

---

## 使用指南

### Dashboard 操作流程

1. **登录** — 使用默认凭据 `admin/admin` 登录
2. **创建项目** — 填写项目名称和描述
3. **创建冲刺 (Sprint)** — 在项目中创建冲刺，填写原始需求描述（`rawInput`）
4. **执行角色迭代** — 依次执行每个角色的迭代：
   - 点击角色卡片进入详情
   - 确认/编辑用户输入
   - 点击"执行"启动 Agent（系统自动调用 `sprint-agent-executor.js`）
   - 等待 Agent 完成，查看输出
   - 确认后进入下一个角色
5. **查看交付物** — 在 `workspace/{sprintId}/output/` 下查看各角色产出
6. **设置测试环境**（可选）— 为 Tester 角色配置测试环境 URL

### CLI 使用

```bash
# 交互式编排器
npm run orchestrator

# 通过 Agent Runner 执行流水线
npm run run

# 轮询模式执行所有待处理流水线
npm run run:all

# 单独启动 API 或 Web
npm run api    # 仅 API Server
npm run web    # 仅 Dashboard
```

### 查看输出

每个冲刺执行完成后，产出文件位于：

```
workspace/{sprintId}/              # 冲刺执行记录
├── output/              # 各角色交付物
│   ├── prd.md
│   ├── test-report.md
│   ├── user-stories.md
│   └── ...
├── product/             # 产品文档
├── architect/           # 架构文档
├── tech-coach/          # 技术教练文档
├── tester/              # 测试文档
└── thinking/            # Agent 思考过程

projects/{projectId}/              # 项目根目录（持续演进）
├── openspec/            # 共享 OpenSpec 仓库
│   └── changes/         # 每次 sprint 追加新 change
└── src/                 # 共享代码库（增量更新）
    ├── frontend/
    └── backend/
```

---

## 核心架构

```
用户请求 → Gatekeeper (路由决策)
              ↓
    ┌─────────┼─────────┐
    ↓         ↓         ↓
   BA      Product    Architect
    ↓         ↓         ↓
  Scout   Developer   Tester    Ops
              ↓         ↓
           Creative   Evolver
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 编排层 | OpenCode CLI |
| 模型 | `opencode/qwen3.6-plus`, `opencode/big-pickle`, `opencode/gpt-5-nano` |
| Skills | Superpowers Skills + gstack Skills |
| 前端 | Vue 3 + Vite + Tailwind CSS + Pinia + Vue Router |
| 后端 | Express.js + Socket.io |
| 数据 | JSON 文件存储（内存 Map + 持久化） |

---

## 角色定义

| 角色 | 图标 | 目标 | 输出 |
|------|------|------|------|
| **Gatekeeper** | 🚪 | 路由决策 | 路由决策 + Pipeline 配置 |
| **BA** | 📝 | 业务分析 | 业务分析报告 |
| **Product** | 📋 | 需求分析 | PRD (JSON) |
| **Architect** | 🏗️ | 架构设计 | OpenSpec Change Proposal |
| **Tech Coach** | 🔍 | 技术翻译 | 技术实现文档、用户故事、可行性分析 |
| **Tech Coach** | 🔍 | 技术实现指导 | 技术实现文档 |
| **Scout** | 🔍 | 技术可行性 | 风险评估报告 |
| **Developer** | 💻 | 代码实现 | 前端/后端代码 |
| **Tester** | 🧪 | 功能+安全测试 | 测试报告 |
| **Ops** | ⚙️ | 部署配置 | Dockerfile/部署配置 |
| **Evolver** | 🔄 | 重构优化 | 重构建议报告 |
| **Ghost** | 👻 | 安全审计 | 安全报告 |
| **Creative** | 🎨 | 设计评审 | 评审意见 |

---

## 决策路由

| 路由 | 执行顺序 | 适用场景 |
|------|----------|----------|
| `CRITICAL` | product → architect → creative → developer → tester → evolver | 核心/高风险功能 |
| `BUILD` | product → architect → tech_coach → developer → tester → ops → evolver | 从零构建新功能 |
| `REVIEW` | creative → ghost → tester | 代码/设计审查 |
| `QUERY` | tech_coach | 技术可行性调研 |
| `SECURITY` | ghost → architect | 安全检查 |

---

## 执行器对比

项目提供三种 Agent 执行器，适用于不同场景：

| 执行器 | 文件 | 特点 | 适用场景 |
|--------|------|------|----------|
| **Agent Runner** | `agent-runner.js` | 基于 OpenCode CLI 子进程，每个角色一个独立 `opencode run` 调用，支持轮询模式 | CLI 批量执行、旧版 Pipeline 模式 |
| **AI Agent Executor** | `ai-agent-executor.js` | 分步执行模式，每个角色拆分为多个步骤，逐步注入 Skill prompt | 精细控制执行流程、API 触发 |
| **Sprint Agent Executor** | `sprint-agent-executor.js` | 最新版，支持 WebSocket 实时进度推送、僵尸进程清理、QA 指令注入、完整的角色-步骤 Skill 映射 | Dashboard 冲刺执行（推荐） |

### 执行器选择建议

- **Dashboard 使用** → `sprint-agent-executor.js`（API 自动调用）
- **CLI 批量处理** → `agent-runner.js --poll`
- **调试单角色** → `ai-agent-executor.js`

---

## Skills 映射

### 步骤级 Skill 映射（按需加载，减少上下文）

每个角色在每个步骤只加载 **一个** 所需 skill，而非全部声明。大 skill（>30KB）不注入 prompt，避免上下文膨胀。

| 角色 | 步骤 | Skill | 大小 | 注入 | 用途 |
|------|------|-------|------|------|------|
| **Product** | 1/5 用户画像 | `brainstorming` | 10KB | ✅ | 需求分析与用户痛点探索 |
| | 2/5 用户故事 | `user-story` | 10KB | ✅ | 标准化用户故事拆解 |
| | 3/5 功能清单 | `product-spec-kit` | 3.8KB | ✅ | 产品规格文档生成 |
| | 4/5 界面布局 | `tailwind-design-system` | 15KB | ✅ | 设计系统与组件规范 |
| | 5/5 汇总 PRD | *(无)* | - | - | 整合所有产出 |
| **Architect** | 1/4 系统架构 | `system-design` | 1.3KB | ✅ | 系统架构设计 |
| | 2/4 API 设计 | `api-design` | 13KB | ✅ | RESTful API 规范 |
| | 3/4 数据库设计 | `database-design` | 1.6KB | ✅ | 数据模型设计 |
| | 4/4 OpenSpec | *(OpenSpec CLI)* | - | - | 使用 CLI 创建 change proposal |
| **Developer** | 1/8 项目结构 | *(无)* | - | - | 目录初始化 |
| | 2/8 后端配置 | *(无)* | - | - | 依赖安装 |
| | 3/8 用户 API | `api-design` | 13KB | ✅ | 接口规范参考 |
| | 4/8 角色 API | `api-design` | 13KB | ✅ | 接口规范参考 |
| | 5/8 前端配置 | *(无)* | - | - | 依赖安装 |
| | 6/8 用户页面 | *(无)* | - | - | 组件开发 |
| | 7/8 内容页面 | *(无)* | - | - | 组件开发 |
| | 8/8 开发文档 | `test-driven-development` | 9.8KB | ✅ | TDD 工作流 |
| **Tester** | 1/4 用例设计 | *(无)* | - | - | 测试用例规划 |
| | 2/4 功能测试 | *(gstack /qa)* | - | - | 使用 gstack 执行功能测试 |
| | 3/4 安全扫描 | *(gstack /qa-only)* | - | - | 安全回归验证（只报告） |
| | 4/4 测试报告 | *(gstack /qa-only)* | - | - | 回归验证 + 整理报告到 output/ |
| **Ops** | 1/4 环境分析 | `docker-helper` | 1KB | ✅ | 容器化指导 |
| | 2/4 Dockerfile | `docker-helper` | 1KB | ✅ | Docker 配置 |
| | 3/4 CI/CD | `azure-deploy` | 6KB | ✅ | 部署流水线 |
| | 4/4 部署脚本 | `docker-helper` | 1KB | ✅ | 脚本生成 |

> **注入规则**：skill 大小 ≤ 30KB 时注入 prompt；超过阈值则跳过注入，由 opencode 按需加载。
> **大 skill**：`plan-eng-review` (56KB)、`ship` (80KB) 不注入 prompt。
> **Tester**：不使用 `--pure` 模式，保留 gstack 插件加载。有测试环境时使用 `/qa` 和 `/qa-only` 命令执行实际测试。

### gstack Skills

| Skill | 用途 |
|-------|------|
| `/browse` | 页面交互测试 |
| `/qa` | QA 测试 → 修复 → 验证 |
| `/qa-only` | 只报告模式（不修复） |
| `/canary` | 部署后健康检查 |
| `/benchmark` | 性能回归测试 |

---

## 场景化工作流

### Architect 场景

| 场景 | Skills 工作流 |
|------|---------------|
| 新系统架构设计 | system-design → api-design → database-design → OpenSpec CLI |
| 现有系统优化 | tech-debt → architecture-review |
| 高并发改造 | event-driven → api-design |

### Developer 场景

| 场景 | Skills 工作流 |
|------|---------------|
| 日常功能开发 | api-design → TDD → document |
| 复杂 Bug 排查 | systematic-debugging → log-analyzer |
| 专项技术开发 | 脚手架 → unit-test-generator |

### Ops 场景

| 场景 | Skills 工作流 |
|------|---------------|
| 容器部署 | docker-helper → kubernetes |
| 多云部署 | azure-deploy → AWS/阿里云/火山云 |
| 日常运维 | ship → docker-compose |

---

## 输出文件规范

所有角色输出使用 **Markdown (.md)** 格式：

| 角色 | 输出文件 |
|------|---------|
| Product | `output/prd.md`, `output/product-spec.md`, `output/user-stories.md`, `output/ui-layout.md`, `output/user-journey.md` |
| Architect | `openspec/changes/<name>/` (proposal.md, design.md, tasks.md) |
| Tech Coach | `tech-coach/tech-implementation.md`, `output/user-stories.md`, `output/tech-feasibility.md` |
| Developer | `developer/README.md`, `developer/API.md`, `developer/dev-summary.md`, `developer/frontend/`, `developer/backend/` |
| Tester | `output/test-report.md`, `output/security-report.md` |
| Ops | `output/ops-config.md`, `output/Dockerfile`, `output/docker-compose.yml`, `output/.github/workflows/deploy.yml` |
| Ghost | `output/security-report.md` |
| Creative | `output/design-review.md` |
| Evolver | `output/evolver-report.md` |

---

## API 端点

### 认证

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 用户登录 |
| `/api/auth/verify` | GET | 验证 Token |

### 项目

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/projects` | POST/GET | 创建/列出所有项目 |
| `/api/projects/:id` | GET/PUT/DELETE | 获取/更新/删除项目 |

### 冲刺

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/projects/:projectId/sprints` | POST/GET | 创建/列出项目冲刺 |
| `/api/sprints/:id` | GET/PUT/DELETE | 获取/更新/删除冲刺 |
| `/api/sprints/:id/start` | POST | 启动冲刺 |
| `/api/sprints/:id/logs` | GET | 获取冲刺日志 |

### 迭代

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sprints/:sprintId/iterations/:roleIndex/input` | PUT | 设置用户输入 |
| `/api/sprints/:sprintId/iterations/:roleIndex/output` | PUT | 更新 Agent 输出 |
| `/api/sprints/:sprintId/iterations/:roleIndex/execute` | POST | 触发 Agent 执行 |
| `/api/sprints/:sprintId/iterations/:roleIndex/confirm` | PUT | 确认输出，进入下一角色 |
| `/api/sprints/:sprintId/iterations/:roleIndex/rerun` | POST | 重新执行角色 |
| `/api/sprints/:sprintId/iterations/:roleIndex/environment` | PUT | 设置测试环境 URL |

### 文件预览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sprints/:sprintId/file?file=prd.md` | GET | 读取输出文件内容 |
| `/api/sprints/:sprintId/files` | GET | 列出所有输出文件 |

### 配置

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/config/models` | GET/PUT | 获取/更新模型配置 |

### 本地项目

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/local-project/validate?path=...` | GET | 验证本地项目路径 |
| `/api/local-project/files?path=...` | GET | 获取项目文件树 |
| `/api/local-project/content?path=...&file=...` | GET | 读取文件内容 |

### WebSocket 事件

| 事件 | 方向 | 说明 |
|------|------|------|
| `subscribe` | Client → Server | 订阅冲刺/项目 |
| `unsubscribe` | Client → Server | 取消订阅 |
| `agent:progress` | Server → Client | Agent 执行进度 |
| `agent:output` | Server → Client | Agent 输出日志 |
| `iteration:execution:started` | Server → Client | 迭代开始执行 |
| `iteration:completed` | Server → Client | 迭代完成 |
| `iteration:confirmed` | Server → Client | 用户确认完成 |
| `sprint:started` | Server → Client | 冲刺启动 |

---

## 目录结构

```
DevForge/
├── package.json                      # 项目配置
├── model-config.json                 # AI 模型配置
├── CLAUDE.md                         # AI 团队配置文档
├── README.md                         # 项目文档
│
├── start.sh / stop.sh / restart.sh   # 启停脚本
│
├── orchestrator.js                   # CLI 编排器（交互式）
├── gatekeeper.js                     # 路由决策 + 阶段执行
├── agent-runner.js                   # Agent 执行器（OpenCode CLI）
├── ai-agent-executor.js              # AI Agent 分步执行器
├── sprint-agent-executor.js          # Sprint Agent 执行器（最新版）
│
├── agents/                           # Agent 角色定义
│   ├── definitions.json              # 完整角色定义 JSON
│   ├── team-config.json              # 团队配置
│   ├── gatekeeper.md
│   ├── product.md
│   ├── architect.md
│   ├── developer.md
│   ├── tester.md
│   ├── ops.md
│   └── ...
│
├── config/                           # 配置文件
│   └── pipelineConfig.js
│
├── dashboard/                        # Web 前端
│   ├── server/
│   │   ├── server.js                 # Express API Server
│   │   └── state-manager.js          # 状态管理
│   ├── src/
│   │   ├── App.vue
│   │   ├── views/
│   │   │   ├── Login.vue
│   │   │   ├── ProjectList.vue
│   │   │   ├── ProjectDetail.vue
│   │   │   └── SprintDetail.vue
│   │   └── ...
│   └── package.json
│
├── workspace/                        # 冲刺执行记录（按 sprintId）
│   └── {sprintId}/
│       ├── output/                   # 角色交付物（PRD、架构文档、测试报告等）
│       ├── thinking/                 # Agent 思考过程
│       ├── execution-log/            # 执行记录
│       ├── product/                  # 产品文档
│       ├── architect/                # 架构文档
│       ├── tech-coach/               # 技术教练文档
│       ├── tester/                   # 测试文档
│       └── ops/                      # 运维文档
│
├── projects/                         # 项目根目录（持续演进）
│   └── {projectId}/
│       ├── project.json              # 项目元数据
│       ├── sprints.json              # 冲刺列表
│       ├── openspec/                 # 共享 OpenSpec 仓库
│       │   └── changes/              # 每次 sprint 追加新 change
│       │       ├── sprint-1-xxx/
│       │       └── sprint-2-xxx/
│       └── src/                      # 共享代码库（增量更新）
│           ├── frontend/
│           ├── backend/
│           ├── README.md
│           └── API.md
│
├── docs/                             # 附加文档
│   └── gstack-integration.md
│
├── evolutions/                       # 进化报告
├── ops/                              # 运维配置
├── scripts/                          # 辅助脚本
├── utils/                            # 工具函数
├── src/                              # 生成的源代码
├── calculator/                       # 计算器示例项目
└── web-calculator/                   # Web 计算器示例项目
```

---

## 扩展指南

### 新增角色

1. 在 `agents/definitions.json` 的 `agents` 对象中添加角色定义：

```json
"new_role": {
  "name": "角色名",
  "name_en": "RoleName",
  "icon": "🔧",
  "goal": "角色目标",
  "tools": ["read", "write"],
  "steps": [...],
  "output_files": {...}
}
```

2. 在 `agents/new-role.md` 中编写详细角色提示词
3. 在 `model-config.json` 中配置模型
4. 在 `dashboard/server/server.js` 的 `ROLE_INFO` 中添加角色信息
5. 将角色加入需要的路由中

### 自定义路由

编辑 `agents/definitions.json` 中的 `routes` 对象：

```json
"routes": {
  "CUSTOM": ["product", "architect", "developer", "tester"]
}
```

### 切换模型

编辑 `model-config.json`，为每个角色指定模型：

```json
{
  "product": "opencode/qwen3.6-plus",
  "architect": "opencode/qwen3.6-plus",
  "developer": "opencode/qwen3.6-plus",
  "ops": "opencode/gpt-5-nano"
}
```

也可通过 Dashboard 的 `/api/config/models` 端点动态修改。

### 添加新 Skill

将 Skill 文件放入 `~/.agents/skills/` 或 `~/.claude/skills/` 目录，然后在角色定义的 `step_skills` 中引用即可。

---

## 故障排除

### 启动失败

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `node: command not found` | 未安装 Node.js | `brew install node` 或从 nodejs.org 下载 |
| 端口 3000 被占用 | 其他服务占用端口 | `lsof -i :3000` 查看并 kill，或设置 `PORT=3001` |
| 端口 5173 被占用 | Vite 端口冲突 | `lsof -i :5173` 查看并 kill |
| 依赖安装失败 | 网络问题 | 使用国内镜像：`npm config set registry https://registry.npmmirror.com` |

### Agent 执行问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| Agent 执行超时 | 模型响应慢或任务复杂 | 检查 `model-config.json`，尝试切换更快的模型 |
| 输出为空 | API Key 未配置 | 确认 OpenCode CLI 已正确配置 API Key |
| 僵尸进程残留 | Agent 进程未正常退出 | 运行 `./stop.sh` 自动清理，或手动 `kill` |

### Dashboard 问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 登录后 401 | 密码错误 | 默认 `admin/admin`，检查环境变量覆盖 |
| WebSocket 断开 | 网络不稳定 | 刷新页面重新连接 |
| 冲刺状态不更新 | Agent 进程异常 | 检查终端日志，确认 `sprint-agent-executor.js` 正常运行 |

### 常见问题

**Q: 三个执行器应该用哪个？**
A: Dashboard 自动使用 `sprint-agent-executor.js`（推荐）。CLI 批量处理用 `agent-runner.js`。调试用 `ai-agent-executor.js`。

**Q: 如何查看 Agent 的思考过程？**
A: 查看 `workspace/{sprintId}/thinking/` 目录下的 JSON 文件，或通过 Dashboard 展开角色卡片的"思考过程"区域。

**Q: 测试环境如何配置？**
A: 在 Dashboard 的 Tester 角色页面设置测试环境 URL，Agent 会自动使用该地址进行 `/qa` 测试。

**Q: 如何清理旧数据？**
A: 删除 `workspace/` 和 `projects/` 下的对应目录即可。Dashboard 也支持删除项目和冲刺。

---

## 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

### 开发规范

- 使用 ES Module (`"type": "module"`)
- 遵循现有代码风格
- 新增 API 端点需同步更新本文档
- 角色定义变更需同步更新 `definitions.json` 和对应的 `.md` 文件

---

## License

MIT
