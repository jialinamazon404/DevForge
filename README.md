# DevForge - AI 开发舰队

> 多角色 AI 软件开发团队编排系统 — 基于 OpenCode CLI + Superpowers Skills + gstack + OpenSpec

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Version](https://img.shields.io/badge/Version-1.0.0-red.svg)](package.json)

---

## 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [OpenSpec 集成](#openspec-集成)
- [前置要求](#前置要求)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [使用指南](#使用指南)
- [核心架构](#核心架构)
- [Harness 与 Sprint 执行路径](#harness-与-sprint-执行路径)
- [角色定义](#角色定义)
- [决策路由](#决策路由)
- [执行器对比](#执行器对比)
- [Skills 映射](#skills-映射)
- [Skill 路径配置](#skill-路径配置)
- [冲刺场景与多角色节点](#冲刺场景与多角色节点)
- [场景化工作流](#场景化工作流)
- [输出文件规范](#输出文件规范)
- [代码开发（Developer）执行逻辑](#代码开发developer执行逻辑)
- [API 端点](#api-端点)
- [目录结构](#目录结构)
- [扩展指南](#扩展指南)
- [故障排除](#故障排除)
- [贡献指南](#贡献指南)
- [License](#license)

---

## 项目简介

DevForge（代号 "AI Coding PasS"）是一个**多角色 AI 软件开发团队编排系统**。它将传统软件开发团队中的角色（产品经理、架构师、开发者、测试工程师、运维工程师等）抽象为独立的 AI Agent，通过结构化流水线协同完成从需求分析到部署上线的完整软件交付流程。

### 解决什么问题

- **需求到代码的自动化**：用户用自然语言描述需求，系统自动拆解为 PRD → 架构设计 → 代码实现 → 测试 → 部署
- **多角色协同**：不同 Agent 各司其职，上游产出自动传递为下游输入，减少上下文丢失
- **可观测的执行过程**：每个 Agent 的思考过程、决策依据、交付物均可追溯和审查
- **灵活的路由策略**：根据任务复杂度自动选择执行路径（完整构建、快速审查、安全审计等）

### 适用场景

| 场景 | 路由 | 说明 |
|------|------|------|
| 从零构建新功能 | `BUILD` | 产品 → 技术主管 → 架构 → 开发 → 测试 → 运维 → 进化 |
| 核心/高风险功能 | `CRITICAL` | 产品 → 架构 → 设计评审 → 技术主管 → 开发 → 测试 → 进化 |
| 代码/设计审查 | `REVIEW` | 创意评审 → 安全审计 → 测试验证 |
| 技术可行性调研 | `QUERY` | 技术教练快速评估 |
| 安全检查 | `SECURITY` | 安全审计 → 架构评估 |

---

## 核心特性

- **10 专业角色**：守门人、产品经理、架构师、开发教练、开发者、测试工程师、运维工程师、安全幽灵、创意总监、进化顾问
- **分步 Skill 注入**：每个角色在每个步骤只加载所需 Skill，避免上下文膨胀（≤30KB 注入，超过按需加载）；路径由 `config/skillPaths.js` 统一管理，支持环境变量与仓库内 `skills/vendor/` 回退
- **实时 Dashboard**：Vue 3 前端，支持项目管理、冲刺执行、实时进度推送（WebSocket）
- **双数据模型**：支持 Pipeline（旧版）和 Sprint（新版）两种执行模式
- **模型灵活配置**：每个角色可独立配置 AI 模型，通过 `model-config.json` 管理
- **多执行器**：提供 CLI、API、Sprint 三种执行方式，适配不同使用场景
- **OpenSpec 集成**：结构化规范管理，Architect → Developer 无缝衔接

---

## OpenSpec 集成

### 什么是 OpenSpec

OpenSpec 是 Fission AI 开发的规范管理工具，为每个功能变更（Change）提供标准化的产出物结构。它是 **Architect → Developer** 的核心桥梁。

### 工作流

```
┌─────────────────────────────────────────────────────────────────┐
│                      Architect (6 步骤)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │proposal  │→│ design   │→│database  │→│ tasks    │          │
│  │  .md     │ │  .md     │ │  .md     │ │  .md     │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│                                                              ↓   │
│                                    projects/{projectId}/openspec │
│                                              /changes/{name}/   │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Developer (N 步骤，基于 tasks.md)              │
│  ┌──────────┐ ┌──────────────────────────┐ ┌──────────┐        │
│  │ Step 1   │→│ Step 2-N: 执行任务批次    │→│ 最后一步  │        │
│  │ 读取文件  │ │ 读取 tasks.md，按批次执行  │ │ 生成文档  │        │
│  │ 确认范围  │ │                          │ │          │        │
│  └──────────┘ └──────────────────────────┘ └──────────┘        │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Tester (QA 测试)                           │
│  验证 Developer 基于 OpenSpec 实现的代码质量                       │
└─────────────────────────────────────────────────────────────────┘
```

### Artifacts 说明

| 文件 | 生成者 | 用途 |
|------|--------|------|
| `proposal.md` | Architect | 变更提案：需求背景、目标、范围 |
| `design.md` | Architect | 技术设计：API 规范、数据模型、技术选型 |
| `database.md` | Architect | 数据模型：数据库表结构、ER 图 |
| `tasks.md` | Architect | **核心** - 实施任务清单，驱动 Developer 步骤数 |

### Developer 如何消费 OpenSpec

Developer 按以下顺序读取 OpenSpec artifacts：

1. **tasks.md**（首先读取）
   - 确认总任务数；Developer 将任务按**自上而下顺序**编号为第 1、2、3… 条（与 `- [ ]`、`1.1` 等具体写法无关）
   - 执行时按批次推进：第 1～10 条、11～20、…、第 41 条起直至全部完成（每步对应 `sprint-agent-executor` 中 developer 的步骤 2～6）

2. **design.md**（技术参考）
   - API 设计规范
   - 数据模型定义
   - 技术选型决策

3. **proposal.md**（需求背景）
   - 变更目的
   - 用户故事

---

## 代码开发（Developer）执行逻辑

本节解释 Dashboard 中「代码开发」阶段**到底如何执行**、如何按 `tasks.md` 推进，以及代码最终写到哪里。

### 一句话概括

- **OpenSpec 不会自动生成代码**：OpenSpec 提供规范与任务清单（`proposal.md` / `design.md` / `tasks.md`），Developer 负责读取这些 artifacts 并完成实现。
- **代码由 LLM 生成，落盘由执行器完成**：系统要求模型输出 ` ```file:...``` `“文件块”，由执行器解析并写入磁盘（只允许写 `backend/` 与 `frontend/`）。

### 执行链路图（含落盘）

```mermaid
flowchart TD
  sprintStart[Sprint执行: runIteration] --> loadSprint["读取Sprint: GET /api/sprints/:id"]
  loadSprint --> buildContext["构建context\n- projectPath\n- codePath(优先localProjectPath)\n- openspecChangeDir"]
  buildContext --> pickBackend{developerBackend?}

  pickBackend -->|opencode| devOpencode[Developer(opencode)]
  pickBackend -->|cursor_auto| devCursor[Developer(cursor_auto)]

  devOpencode --> stepIdx{stepIndex?}
  stepIdx -->|Step2..Step6| batchLoop["runDeveloperPerTaskBatch\n读取tasks.md->解析checkbox->分批执行"]
  batchLoop --> perTask["逐条task调用LLM\n要求输出```file:...```完整文件块"]
  perTask --> parseBlocks[extractFileBlocks]
  parseBlocks --> writeDisk["writeFileBlocks\n只写backend/或frontend/到codePath"]
  writeDisk --> updateUI["PUT iteration output\nDashboard展示进度/摘要"]
  updateUI --> batchLoop

  stepIdx -->|其它步骤| regularPrompt["runOpenCode\n生成该步输出(可能含文件块)"]
  regularPrompt --> maybeWrite1{输出含file blocks?}
  maybeWrite1 -->|是| writeDisk2[writeFileBlocks->落盘到codePath]
  maybeWrite1 -->|否| onlyText1[仅保存文本输出到iteration]

  devCursor --> cursorRun["runCursorAgent\ncwd=codePath\ncursor agent chat --print --force"]
  cursorRun --> parseOut[取文本输出]
  parseOut --> maybeWrite2{输出含file blocks?}
  maybeWrite2 -->|是| writeDisk3[writeFileBlocks->落盘到codePath]
  maybeWrite2 -->|否| onlyText2[仅保存文本输出到iteration]
  writeDisk3 --> updateUI2["PUT iteration output\n展示写入摘要"]
  onlyText2 --> updateUI2
```

### 如何“根据 tasks.md 去跑”（重点：opencode 后端）

在 `developerBackend=opencode` 且 Developer 处于 **Step 2～Step 6** 时，系统会：

1. 读取 `tasks.md`
2. 解析其中的 checkbox 任务（形如 `- [ ] ...`）
3. 按批次执行（每步 10 条任务，按文件自上而下顺序计数）：
   - Step 2：第 1～10 条
   - Step 3：第 11～20 条
   - Step 4：第 21～30 条
   - Step 5：第 31～40 条
   - Step 6：第 41 条起直至全部完成
4. 每条任务会单独调用一次模型，要求只实现这一条任务，并输出 ` ```file:...``` ` 文件块；执行器负责把文件写到磁盘。若确实无需改动，可输出 `NO_CHANGE: <reason>`。

### 落盘门禁（默认开启）

为了避免“界面有输出但本地无代码”这类假成功，Developer 执行器默认启用以下门禁：

- 代码任务必须满足 `fileBlocks > 0 && written > 0`
- 高风险任务（`high/core`）必须包含测试文件块（例如 `*.test.ts`、`*.spec.ts`、`tests/`）
- 中低风险任务未输出 `file:` 代码块时，默认输出 `[TASK_WARN]` 并继续；高风险任务默认仍会 `[TASK_FAIL]`
- 违反门禁的任务会输出 `[TASK_FAIL]`（或 `[TASK_WARN]`），并附带错误码：
  - `NO_FILE_BLOCKS`：未输出任何 `file:` 代码块（warning 或 high/core fail）
  - `NO_FILE_BLOCKS_NO_CHANGE`：任务声明无需改动（`NO_CHANGE: ...`），按 warning 继续
  - `CONSECUTIVE_NO_FILE_BLOCKS`：连续多个任务无代码块，触发保护性中断
  - `WRITE_ZERO`：解析到了 `file:` 代码块但未写入文件
  - `MISSING_TEST_FILE_BLOCKS`：高风险任务缺少测试文件块
  - `VERIFY_FAILED`：配置的 shell 验证失败
  - `TASK_ALIGNMENT_FAIL`：开启 `DEVFORGE_TASK_ALIGN_OPENCODE` 且对齐检查失败（受 `DEVFORGE_ALIGN_STRICT` 影响）

可通过环境变量关闭/调整门禁（见下方环境变量表）。

常用参数：

- `STRICT_FILE_BLOCK_GATE`（默认 `true`）：是否启用 file block 门禁
- `DEVFORGE_NO_FILE_BLOCKS_FAIL_HIGH_RISK`（默认 `true`）：高风险无 file blocks 是否失败
- `DEVFORGE_DEVELOPER_MAX_CONSECUTIVE_NO_BLOCKS`（默认 `3`）：连续无代码块的保护性中断阈值
- `DEVFORGE_DEVELOPER_DUMP_NO_BLOCKS_RAW`（默认 `true`）：无代码块时是否写调试日志到 `workspace/<sprintId>/debug/developer-no-blocks/`

### Developer 管道补充（单 task、TDD、验证、路径约束）

| 变量 | 默认 | 说明 |
|------|------|------|
| `DEVFORGE_DEVELOPER_SINGLE_TASK` | `false` | Dashboard 单 task 重跑时为 `true`；为 `true` 时**不链式**跑完 developer 全部步骤 |
| `DEVFORGE_DEVELOPER_SINGLE_TASK_CHAIN` | `false` | 为 `true` 时恢复「单 task 仍链式下一步」的旧行为 |
| `DEVFORGE_DEVELOPER_TASK_SKILL` | `test-driven-development` | 每条 `tasks.md` 子任务注入的 Skill；设为 `none`/`0`/`false` 关闭 |
| `DEVFORGE_VERIFY_ENABLED` | `true` | 是否执行 **shell** 验证（见下方 `codegen.verify` / 启发式） |
| `DEVFORGE_VERIFY_HEURISTICS` | `false` | 无 `codegen.verify` 时是否按目录猜测 `npm test` / `mvn test`（**不默认开启**，避免锁技术栈） |
| `DEVFORGE_VERIFY_STRICT` | `true` | shell 验证失败是否使任务失败 |
| `DEVFORGE_VERIFY_TIMEOUT_MS` | `300000` | 单条 shell 命令超时（毫秒） |
| `DEVFORGE_VERIFY_SKIP_NO_NODE_MODULES` | `true` | 启发式 npm 验证时若无 `node_modules` 则跳过并告警 |
| `DEVFORGE_TASK_ALIGN_OPENCODE` | `false` | 每条 task 后是否再跑一轮短 OpenCode 做「task↔产出」对齐检查 |
| `DEVFORGE_ALIGN_STRICT` | `false` | 对齐检查为 `fail` 时是否使任务失败 |

**`projects/{projectId}/project.json` 可选字段 `codegen`（不绑死技术栈）**

- `verify`：`[{ "cwd": "相对 src 目录", "cmd": "任意命令" }, ...]` — 每条 developer 子任务写盘成功后**顺序执行**（推荐用项目真实构建/测试命令）。
- `allowBackend` / `allowFrontend`：`false` 时禁止写入对应前缀。
- `allowedRoots`：如 `["frontend","backend"]`，仅允许这些顶层目录下的路径。
- `allowBackend: true` 或 `allowedRoots` 含 `backend` 时，允许在尚无 `backend/` 目录时**首次**创建后端文件。

**Tester**：步骤 1 会要求输出「需求与实现一致性摘要」与「一致性缺口」，便于对照 PRD / tasks 与 `src` 落盘代码。

**新增任务失败码**：`VERIFY_FAILED`（shell 验证失败）、`TASK_ALIGNMENT_FAIL`（可选对齐检查失败）。

### 代码写到哪里（codePath）

Developer 落盘目录由 `codePath` 决定：

- 如果 Sprint 创建时填写了 `localProjectPath`：**优先写入该本地项目路径**（期望其下生成 `backend/`、`frontend/`）。
- 否则写入 DevForge 的项目目录：`projects/{projectId}/src/`。

如果你看到“界面有输出但本地没有文件”，通常是以下两类原因之一：

- 模型输出里**没有** ` ```file:backend/...``` / ` ```file:frontend/...``` ` 文件块，因此执行器无法落盘
- `localProjectPath` 未设置或指向错误目录，导致写入发生在 DevForge 的默认目录而非你的本地项目

### 核对 tasks 与代码（可选）

脚本 [`scripts/check-tasks-vs-git.mjs`](scripts/check-tasks-vs-git.mjs) 对 `tasks.md` 中带 checkbox 的行做启发式统计，并打印指定目录下的 `git diff --stat`，**仅供人工核对**，不能替代代码审查。

```bash
node scripts/check-tasks-vs-git.mjs projects/<projectId>/openspec/changes/<change-name>/tasks.md projects/<projectId>
```

### 解析任务门禁指标（可选）

脚本 [`scripts/check-task-metrics.mjs`](scripts/check-task-metrics.mjs) 可从迭代输出（包含 `[TASK_END]` / `[TASK_FAIL]`）中提取结构化统计：

```bash
# 从文件读取
node scripts/check-task-metrics.mjs /path/to/iteration-output.txt

# 从标准输入读取
cat /path/to/iteration-output.txt | node scripts/check-task-metrics.mjs -
```

### CLI 依赖

```bash
npm install -g @fission-ai/openspec@latest
```

> **注意**：OpenSpec CLI 是可选的。CLI 不可用时，系统会自动降级为手动创建目录结构。

### 目录结构

```
projects/{projectId}/
├── openspec/
│   ├── spec.json                    # OpenSpec 主配置
│   └── changes/
│       └── {sprint-name}/
│           ├── proposal.md          # 变更提案
│           ├── design.md            # 技术设计
│           ├── database.md          # 数据模型
│           └── tasks.md            # 实施任务（Developer 核心输入）
└── src/                            # Developer 产出代码
    ├── frontend/
    ├── backend/
    └── ...
```

---

## 前置要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 20.0 | 运行环境 |
| npm | ≥ 9.0 | 包管理（随 Node.js 安装） |
| OpenCode CLI | 最新版 | AI Agent 编排引擎 |
| gstack Skills | 最新版 | 浏览器测试 + QA 技能集 |
| Superpowers Skills | 最新版 | 通用技能库 |

### 安装 OpenCode CLI

```bash
npm install -g opencode
```

### 安装 OpenSpec

```bash
npm install -g @fission-ai/openspec@latest
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
cd DevForge
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
| `DEVFORGE_SUPERPOWERS_SKILLS` | `~/.cache/opencode/node_modules/superpowers/skills` | Superpowers 技能根目录（`brainstorming` 等） |
| `DEVFORGE_AGENTS_SKILLS` | `~/.agents/skills` | 用户级 Agent 技能根目录 |
| `DEVFORGE_GSTACK_SKILLS` | `~/.claude/skills/gstack` | gstack 技能根目录 |
| `DEVFORGE_REPO_SKILLS` | `<repo>/skills/vendor` | 仓库内技能副本根（回退用） |
| `MAX_CONCURRENT_SPRINT_EXECUTORS` | `3` | 同时运行的 Sprint Agent 进程数上限 |
| `ARCHITECT_OPENSPEC_PHASE_TIMEOUT_MS` | - | 架构师 OpenSpec 形态 B 单阶段超时（毫秒）；未设置时回退 `ARCHITECT_OPENSPEC_TIMEOUT_MS` |
| `ARCHITECT_OPENSPEC_TIMEOUT_MS` | `480000` | 架构师 OpenSpec 单阶段超时回退值（毫秒，约 8 分钟） |
| `DEVFORGE_OPENSPEC_PIPELINE` | - | 设为 `legacy` 时架构师第 5 步使用旧版单次大提示；否则默认 OpenSpec 形态 B（bootstrap + 三阶段 + validate） |
| `DEVFORGE_LEGACY_FULL_OPENSPEC_CONTEXT` | - | 设为 `1` 时在架构师第 5 步提示中嵌入完整 `proposal/design/tasks` 文件；默认仅路径提示 |
| `STRICT_FILE_BLOCK_GATE` | `true` | Developer 代码任务强门禁：要求 `fileBlocks > 0 && written > 0`，否则判定失败 |
| `HIGH_RISK_TEST_BLOCK_REQUIRED` | `true` | 高风险任务（high/core）要求输出测试文件块，否则判定失败 |
| `HARNESS_REQUIRED` | `false` | 若为 `true`，`/execute` 在 Harness 初始化失败时返回 503；否则降级继续执行 |
| `HARNESS_WARMUP_ON_START` | `true` | Server 启动时是否预热 Harness；关闭后仅在请求时按需初始化 |

---

## 使用指南

### Dashboard 操作流程

1. **登录** — 使用默认凭据 `admin/admin` 登录
2. **创建项目** — 填写项目名称和描述
3. **创建冲刺 (Sprint)** — 在项目中创建冲刺，填写原始需求描述（`rawInput`）；可选择 **场景（scenario）**，对应 `config/pipelineConfig.js` 中的 `ROUTES`（如 `BUILD`、`CRITICAL`、`REVIEW` 等），用于生成该冲刺的角色流水线顺序
4. **执行开发流程** — 依次执行每个流程节点：
   - 点击流程节点查看详情
   - 确认/编辑用户输入
   - 点击「执行当前阶段」启动 Agent（系统调用 `sprint-agent-executor.js`）；**每次点击只运行当前阶段内、流水线顺序上的下一个未完成角色**（见下方「多角色节点」）
   - 等待 Agent 完成，查看输出
   - 确认后进入下一个流程节点
5. **查看交付物** — 在 `workspace/{sprintId}/output/` 下查看各角色产出
6. **设置测试环境**（可选）— 为测试验证节点配置测试环境 URL

### 冲刺场景与多角色节点

**场景（scenario）** 决定本次冲刺包含哪些角色及顺序，定义见 `config/pipelineConfig.js` 的 `ROUTES`。创建冲刺时选择的场景会写入冲刺数据，并与 Dashboard 流程节点展示对齐。

**同一流程节点内的多个 Agent（例如「技术设计」= 开发教练 + 架构师）**

- 界面上同属一个节点，但后端仍是 **两个独立迭代（iteration）**，顺序为：**开发教练（tech_coach）→ 架构师（architect）**（与 `BUILD` 路由一致）。
- **不会**在开发教练完成后自动启动架构师：你需 **再次点击「执行当前阶段」**，才会执行下一个角色。
- 教练完成后，若产出有效，服务端会把输出 **写入架构师的 `userInput`**，并将架构师从 `pending` 标为 `ready`，便于直接执行。
- 本阶段内各角色输出 **确认（confirmed）** 后，才允许进入下一流程节点（见 `SprintDetail.vue` 中的阶段完成判断）。

### 界面特性

- **饿了么风格界面** — 亮色主题，符合 Element Plus 设计规范
- **流程节点展示** — 弱化角色概念，强调开发流程（需求分析 → 技术设计 → 代码开发 → 测试验证 → 部署上线 → 迭代优化）
- **实时状态显示** — 每个节点显示当前工作中的 Agent 和使用的 Skills
- **横向 Steps 导航** — 使用 el-steps 组件展示开发流程进度

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
    ┌──────────┼──────────┐
    ↓          ↓          ↓
 Product    Creative    Ghost
    ↓          ↓          ↓
Tech Coach  Developer   Evolver
    ↓          ↓
Architect   Tester → Ops
```

### Harness 与 Sprint 执行路径

当前版本中，**Harness**（`harness/`）是 API Server 侧的一套**执行基础设施**，与「一次冲刺里真正跑 OpenCode 的进程」是**并存、分工**关系，而不是完全替代关系。

```
Dashboard / API
      │
      ├─ ensureHarness() ──► HarnessManager
      │                        ├─ CacheStrategy（L1 Skill，路径与 config/skillPaths.js 一致）
      │                        ├─ PoolManager / ProcessPool（按模型预热 worker，可复用）
      │                        ├─ TaskScheduler + ContentExtractor（角色依赖提炼等，供统一执行路径）
      │                        └─ preloadSkills（brainstorming / system-design 等常用项）
      │
      └─ POST …/iterations/:roleIndex/execute
               ├─ acquireSprintExecutorSlot()     ← 全局限流（MAX_CONCURRENT_SPRINT_EXECUTORS）
               └─ spawn('node', sprint-agent-executor.js)   ← 实际对话与落盘仍走此子进程
```

**要点**：

| 项 | 说明 |
|----|------|
| **何时初始化** | 服务启动后会异步尝试 `ensureHarness()`；首次 `GET /api/harness/stats` 或每次触发 `POST …/execute` 前也会 `await ensureHarness()`，用于预热缓存与进程池。 |
| **实际推理路径** | 每个角色的生成仍由 **`sprint-agent-executor.js`** 子进程完成（内部 `spawn('opencode', …)`），与 Dashboard WebSocket 日志、workspace 写入一致。 |
| **Harness 当前职责** | Skill 文件 **L1 缓存**、按模型的 **进程池** 与统计、为后续「统一走池化执行」预留的 `executeRole` / 调度链路；**不**改变现有「一角色一 executor 子进程」的对外行为。 |
| **并发控制** | 除 Harness 内调度外，Server 另有 **全局 Sprint 执行槽位**（`MAX_CONCURRENT_SPRINT_EXECUTORS` + 等待队列），避免同时起过多 `sprint-agent-executor`。 |
| **可观测性** | `GET /api/harness/stats` 返回 Harness 缓存命中率、池与调度器摘要，并附带 **当前活跃 / 排队** 的 Sprint executor 数量；初始化失败时 `enabled: false`，不影响单次 spawn 执行。 |

如需观察 Harness 是否就绪与负载，请优先查看 **`/api/harness/stats`**。

若需要诊断池健康与错误分类，可使用 **`/api/harness/health`**（包含初始化状态、池健康、缓存命中率，以及各模型池的错误计数与最近错误摘要）。

### 技术栈

| 层级 | 技术 |
|------|------|
| 编排层 | OpenCode CLI |
| 模型 | `opencode/qwen3.6-plus-free`, `opencode/big-pickle`, `opencode/gpt-5-nano` |
| Skills | Superpowers Skills + gstack Skills + OpenSpec（路径见 `config/skillPaths.js`） |
| 执行基础设施 | Harness（缓存 + 进程池 + 统计；与 `sprint-agent-executor` 配合） |
| 前端 | Vue 3 + Vite + Tailwind CSS + Pinia + Vue Router |
| 后端 | Express.js + Socket.io |
| 数据 | JSON 文件存储（内存 Map + 持久化） |

---

## 开发流程节点

DevForge Dashboard 采用**流程节点**模式，弱化角色概念，强调开发流程。每个节点包含 1-N 个 Agent 角色，界面实时展示当前工作中的 Agent 和使用的 Skills。

| 节点ID | 节点名称 | 图标 | 包含 Agent | Skills |
|--------|----------|------|-----------|--------|
| `requirement` | 需求分析 | 📋 | 产品经理 | brainstorming, user-story, product-spec-kit |
| `tech-design` | 技术设计 | 🏗️ | 技术教练 → 架构师（顺序执行，非自动串联） | system-design, api-design, database-design |
| `development` | 代码开发 | 💻 | 开发者 | test-driven-development, unit-test-generator |
| `testing` | 测试验证 | 🧪 | 测试工程师 | qa, benchmark, gstack |
| `deploy` | 部署上线 | ⚙️ | 运维工程师 | docker-helper, azure-deploy, ship |
| `optimize` | 迭代优化 | 🔄 | 进化顾问 | tech-debt, architecture-review |

---

## 角色定义

| 角色 | 图标 | 目标 | 输出 |
|------|------|------|------|
| **Gatekeeper** | 🚪 | 路由决策 | 路由决策 + Pipeline 配置 |
| **Product** | 📋 | 需求分析 | PRD (JSON) |
| **Architect** | 🏗️ | 架构设计 | OpenSpec Change Proposal |
| **Tech Coach** | 🔍 | 技术翻译 | change-request、技术实现文档、可行性分析 |
| **Developer** | 💻 | 代码实现 | 前端/后端代码 |
| **Tester** | 🧪 | 功能+安全测试 | 测试报告 |
| **Ops** | ⚙️ | 部署配置 | Dockerfile/部署配置 |
| **Evolver** | 🔄 | 重构优化 | 迭代/重构建议报告 |
| **Ghost** | 👻 | 安全审计 | 安全报告 |
| **Creative** | 🎨 | 设计评审 | 评审意见 |

---

## 决策路由

| 路由 | 执行顺序 | 适用场景 |
|------|----------|----------|
| `CRITICAL` | product → architect → creative → developer → tester → evolver | 核心/高风险功能 |
| `BUILD` | product → tech_coach → architect → developer → tester → ops → evolver | 从零构建新功能 |
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
| **Architect** | 1/5 系统设计 | `system-design` | 1.3KB | ✅ | 系统架构设计 |
| | 2/5 API 设计 | `api-design` | 13KB | ✅ | RESTful API 规范 |
| | 3/5 表设计 | `database-design` | 1.6KB | ✅ | 数据库表结构和关系 |
| | 4/5 数据流转图 | *(无)* | - | - | 业务数据流转图（Mermaid） |
| | 5/5 OpenSpec | *(OpenSpec CLI)* | - | - | 生成 OpenSpec Change Proposal |
| **Developer** | 1/7 范围确认 | *(无)* | - | - | 读取 OpenSpec tasks.md 确认实现范围 |
| | 2/7 第1批执行 | *(无)* | - | - | 执行 tasks.md 自上而下第 1～10 条任务 |
| | 3/7 第2批执行 | *(无)* | - | - | 第 11～20 条 |
| | 4/7 第3批执行 | *(无)* | - | - | 第 21～30 条 |
| | 5/7 第4批执行 | *(无)* | - | - | 第 31～40 条 |
| | 6/7 第5批执行 | *(无)* | - | - | 第 41 条起直至全部完成 |
| | 7/7 开发文档 | `test-driven-development` | 9.8KB | ✅ | 生成 README.md、API.md、dev-summary.md |
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

## Skill 路径配置

所有可注入 Skill 的**绝对路径映射**集中在 `config/skillPaths.js`（由 `sprint-agent-executor.js`、`ai-agent-executor.js` 与 Harness 缓存共用）。

- **解析顺序**：先读映射表中的主路径；若文件不存在，再尝试 **仓库内回退**：`<repo>/skills/vendor/<skillName>/SKILL.md`（可通过 `DEVFORGE_REPO_SKILLS` 修改根目录）。
- **逻辑别名**：例如 `ui-ux-designer` 与 `tailwind-design-system` 指向同一文件；`gstack-cso` 与 `cso` 一致。界面标签中的 `gstack`、`benchmark`、`tech-debt` 等也在映射表中有对应项，便于 Harness 预热与排查。
- **本机未安装 Superpowers 时**：可将对应 `SKILL.md` 复制到 `skills/vendor/<技能名>/`，或设置 `DEVFORGE_SUPERPOWERS_SKILLS` 指向实际 `superpowers/skills` 目录。

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
| Architect | `openspec/changes/<name>/` (proposal.md, design.md, database.md, tasks.md) |
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

### Harness

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/harness/stats` | GET | Harness 是否启用（`enabled`）、`getStats()`（缓存命中率、池与调度器摘要）、`maxConcurrentSprintExecutors`、当前 `activeSprintExecutors` 与排队长度；详见 [Harness 与 Sprint 执行路径](#harness-与-sprint-执行路径) |
| `/api/harness/health` | GET | Harness 细粒度健康检查：初始化状态、pool health、cache hit rate、每个模型池错误计数与最近错误摘要 |

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
│   ├── tech-coach.md
│   ├── developer.md
│   ├── tester.md
│   ├── ops.md
│   ├── evolver.md
│   ├── ghost.md
│   ├── creative.md
│   ├── receptionist.md
│   ├── architect/                    # 架构师扩展文档
│   ├── developer/                    # 开发者扩展文档
│   ├── product/                      # 产品扩展文档
│   └── tester/                       # 测试扩展文档
│
├── config/                           # 配置文件
│   ├── pipelineConfig.js             # ROUTES / 场景角色顺序
│   └── skillPaths.js                 # Skill 文件路径、别名与读盘回退
│
├── harness/                          # 执行 Harness：CacheStrategy、PoolManager、TaskScheduler 等（见「Harness 与 Sprint 执行路径」）
│   ├── manager.js                    # createHarness / getStats
│   ├── cache-strategy.js
│   └── ...
│
├── skills/                           # 可选：仓库内技能副本（见 DEVFORGE_REPO_SKILLS）
│   └── vendor/                       # <skillName>/SKILL.md 回退路径
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
├── workspace/                        # 冲刺执行记录（运行时生成，已 gitignore）
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
├── projects/                         # 项目根目录（运行时生成，已 gitignore）
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
  "product": "opencode/qwen3.6-plus-free",
  "architect": "opencode/qwen3.6-plus-free",
  "developer": "opencode/gpt-5-nano",
  "ops": "opencode/gpt-5-nano"
}
```

也可通过 Dashboard 的 `/api/config/models` 端点动态修改。

### 添加新 Skill

1. 将 Skill 文件放入本机目录（如 `~/.agents/skills/<name>/SKILL.md`）或仓库 `skills/vendor/<name>/SKILL.md`。
2. 在 `config/skillPaths.js` 的 `SKILL_PATHS` 中增加映射（必要时在 `SKILL_ALIASES` 中增加别名）。
3. 在 `agents/definitions.json` 的 `step_skills` 或 `sprint-agent-executor.js` 的 `ROLE_STEP_SKILLS` 中引用该技能名。

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
| Skill 无法加载 / 「未配置 Skill」 | 本机路径与默认不一致，或映射表缺少技能名 | 检查 `config/skillPaths.js`；设置 `DEVFORGE_*_SKILLS`；或将 `SKILL.md` 放到 `skills/vendor/<技能名>/` |
| 技术设计只跑了教练 | 设计如此：多角色需多次执行 | 教练完成后再次点击「执行当前阶段」以运行架构师 |

### 常见问题

**Q: 三个执行器应该用哪个？**
A: Dashboard 自动使用 `sprint-agent-executor.js`（推荐）。CLI 批量处理用 `agent-runner.js`。调试用 `ai-agent-executor.js`。

**Q: 如何查看 Agent 的思考过程？**
A: 查看 `workspace/{sprintId}/thinking/` 目录下的 JSON 文件，或通过 Dashboard 展开角色卡片的"思考过程"区域。

**Q: 测试环境如何配置？**
A: 在 Dashboard 的 Tester 角色页面设置测试环境 URL，Agent 会自动使用该地址进行 `/qa` 测试。

**Q: 如何清理旧数据？**
A: 删除 `workspace/` 和 `projects/` 下的对应目录即可。Dashboard 也支持删除项目和冲刺。

**Q: 技术设计里教练跑完了，架构师会自动开始吗？**
A: **不会。** 需再次执行当前阶段；系统会把教练产出写入架构师的输入区。详见上文「冲刺场景与多角色节点」。

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
