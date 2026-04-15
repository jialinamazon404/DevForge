# DevForge

多角色 AI 软件交付编排系统：把自然语言需求走成可追踪的流水线（需求 → 设计 → 开发 → 测试 → 运维 → 优化），由 **Dashboard + API** 驱动，核心执行在 **`sprint-agent-executor.js`**（OpenCode CLI）。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)
[![Version](https://img.shields.io/badge/Version-1.0.0-red.svg)](package.json)

---

## 目录

- [一分钟上手](#一分钟上手)
- [系统做什么](#系统做什么)
- [架构一览](#架构一览)
- [Sprint 与数据落在哪里](#sprint-与数据落在哪里)
- [Dashboard 怎么用](#dashboard-怎么用)
- [代码开发：tasks 与落盘](#代码开发tasks-与落盘)
- [OpenSpec 与 Developer](#openspec-与-developer)
- [预览与调试](#预览与调试)
- [API 摘要](#api-摘要)
- [环境变量（常用）](#环境变量常用)
- [CLI 与执行器](#cli-与执行器)
- [扩展与贡献](#扩展与贡献)
- [故障排除](#故障排除)
- [License](#license)

---

## 一分钟上手

```bash
cd DevForge
./start.sh
```

- **Dashboard**：`http://<本机或局域网 IP>:5173`
- **API / WebSocket**：`http://<本机或局域网 IP>:3000`（Socket 同源）

分步启动：`npm run api`（API） + `npm run web`（前端）。停止：`./stop.sh`，重启：`./restart.sh`。

默认登录：`admin` / `admin`（可用 `ADMIN_USER`、`ADMIN_PASSWORD` 覆盖）。

**依赖**：Node.js **≥ 20**、全局 `opencode`；OpenSpec CLI、gstack、Superpowers 等为增强能力，按团队需要安装（详见下文）。

---

## 系统做什么

| 能力 | 说明 |
|------|------|
| 多角色流水线 | 产品、技术教练、架构师、开发、测试、运维等按场景顺序执行 |
| 可观测 | 迭代输出、workspace 产物、部分阶段思考过程可查看 |
| Sprint 为主 | Dashboard 主路径是 **Sprint**；旧版 **Pipeline** 仍兼容 |
| OpenSpec | 架构产出 `proposal/design/tasks` 等，驱动开发任务拆解 |

场景路由定义在 [`config/pipelineConfig.js`](config/pipelineConfig.js) 的 `ROUTES`（如 `BUILD`、`CRITICAL`、`REVIEW` 等）。

---

## 架构一览

```text
用户 / Dashboard
      │
      ▼
Express API (dashboard/server/server.js) + Socket.IO
      │
      ├─ 项目 / Sprint / 迭代状态（JSON 持久化）
      │
      └─ spawn → sprint-agent-executor.js（单角色或单步）
                    │
                    └─ OpenCode CLI → 模型输出 → 解析落盘 / 回写 API
```

**Harness**（`harness/`）：API 侧的缓存、进程池与统计；与 `sprint-agent-executor` 并存，实际对话与 workspace 写入仍以 executor 子进程为准。观测：`GET /api/harness/stats`、`GET /api/harness/health`。

更细的团队角色说明见 [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md)（与本文档互补，不必重复粘贴大段表格）。

---

## Sprint 与数据落在哪里

| 位置 | 内容 |
|------|------|
| `workspace/<sprintId>/` | 本次冲刺的过程与产出：`product/`、`architect/`、`output/`、`thinking/` 等 |
| `projects/<projectId>/` | 长期项目：`openspec/changes/...`、`src/`（默认代码树）等 |

**代码写到哪里**：若 Sprint 配置了 `localProjectPath`，Developer 优先写入该路径；否则写入 `projects/<projectId>/src/`（常见为 `src/frontend`、`src/backend` 或 `frontend` / `backend`，以任务与项目结构为准）。

---

## Dashboard 怎么用

1. 登录 → 创建 **项目** → 创建 **Sprint**（填写 `rawInput`，选择 **scenario**）。
2. 在流程节点中选中阶段 → **执行当前阶段**：每次只跑当前阶段内、流水线顺序上的**下一个未完成角色**（同一节点内多角色时，通常需**多次点击**，例如技术教练完成后再点一次跑架构师）。
3. 需要补充说明时，在「用户输入」中填写后确认执行；或对已产出不满意，用 **「提意见并重新生成」**（统一入口，内部会写入输入并按需 rerun）。
4. **代码开发**阶段可使用 **前端/后端预览** 与 **后端 API 控制台**（见下节）。

---

## 代码开发：tasks 与落盘

- **任务来源**：以 OpenSpec 的 **`tasks.md`** 为主清单，按自上而下顺序分批执行（每批最多 10 条等，由 executor 步骤划分）。
- **落盘方式**：模型需输出 ` ```file:相对路径` 代码块，由执行器解析并写入 **允许的工程目录**（默认 `backend/`、`frontend/` 等，受 `project.json` 的 `codegen` 约束时可收紧）。
- **门禁**：可对「无文件块 / 未写入 / 高风险缺测试」等做强校验（环境变量可调，详见 [`sprint-agent-executor.js`](sprint-agent-executor.js) 内注释与仓库内环境说明）。
- **界面布局**：产品阶段会生成 `workspace/<sprintId>/product/ui-layout.md`；开发提示词会要求对齐该文件；执行后有一次 **轻量 UI 布局对齐检查**（结果写入 `workspace/<sprintId>/output/ui-layout-check.md`，并在 Dashboard 开发区显示「布局对齐」状态）。

---

## OpenSpec 与 Developer

| Artifact | 作用 |
|----------|------|
| `proposal.md` | 变更背景与范围 |
| `design.md` | 技术设计与接口约定 |
| `tasks.md` | **开发执行清单**（Developer 核心输入） |

Developer 典型顺序：**先读 `tasks.md` → 参考 `design.md` / `proposal.md` → 按批次实现并落盘**。OpenSpec CLI 可选；不可用时由流程降级为目录与文件约定（仍以 `tasks.md` 为准）。

---

## 预览与调试

在 **代码开发** 阶段，Dashboard 提供：

- **前端预览**：`POST /api/sprints/:id/preview/start`，body 可选 `{ "target": "frontend" }`（默认即前端）；`GET .../preview/meta`、`GET .../preview/status`；`POST .../preview/stop`，body 可选 `{ "target": "frontend" | "backend" | "all" }`。
- **后端预览**：同上，`target: "backend"`。
- **API 控制台**：`POST /api/sprints/:id/preview/api/request`，由服务端转发到本机已启动的后端预览端口（需先启动后端预览）。

探测逻辑见 [`dashboard/server/preview-target.js`](dashboard/server/preview-target.js)。

---

## API 摘要

**Sprint（主路径）**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/PUT/DELETE | `/api/sprints/:id` | 冲刺读写 |
| POST | `/api/sprints/:id/start` | 启动冲刺 |
| PUT | `/api/sprints/:id/iterations/:roleIndex/input` | 用户输入 |
| POST | `/api/sprints/:id/iterations/:roleIndex/execute` | 执行该迭代 |
| POST | `/api/sprints/:id/iterations/:roleIndex/rerun` | 重跑 |
| PUT | `/api/sprints/:id/iterations/:roleIndex/confirm` | 确认输出 |

**预览**（节选，完整实现见 [`dashboard/server/server.js`](dashboard/server/server.js)）

| 方法 | 路径 |
|------|------|
| GET | `/api/sprints/:sprintId/preview/meta` |
| GET | `/api/sprints/:sprintId/preview/status` |
| POST | `/api/sprints/:sprintId/preview/start` |
| POST | `/api/sprints/:sprintId/preview/stop` |
| POST | `/api/sprints/:sprintId/preview/api/request` |

**其它**：`/api/projects/*`、`/api/local-project/*`、`/api/config/models`、`/api/harness/stats` 等。

WebSocket：客户端 `subscribe` 后接收 `iteration:*`、`preview:updated` 等事件。

---

## 环境变量（常用）

| 变量 | 说明 |
|------|------|
| `PORT` / `HOST` | API 监听（默认 `3000` / `0.0.0.0`） |
| `API_BASE` | 执行器回写 API 的基地址 |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Dashboard 登录 |
| `MAX_CONCURRENT_SPRINT_EXECUTORS` | 并发执行上限 |
| `DEVFORGE_*_SKILLS` | 各技能根目录（见 `config/skillPaths.js`） |
| `STRICT_FILE_BLOCK_GATE` 等 | Developer 落盘与验证门禁 |

完整列表以代码与部署环境为准。

---

## CLI 与执行器

| 命令 / 文件 | 用途 |
|-------------|------|
| `./start.sh` | 一键启动 API + Dashboard |
| `npm run api` / `npm run web` | 分别启动 |
| `npm run orchestrator` | 交互式 CLI 编排 |
| [`sprint-agent-executor.js`](sprint-agent-executor.js) | **推荐**：Dashboard Sprint 执行 |
| [`agent-runner.js`](agent-runner.js) | 轮询 / 批量 Pipeline |
| [`ai-agent-executor.js`](ai-agent-executor.js) | 分步调试 |

可选安装：

```bash
npm install -g opencode
npm install -g @fission-ai/openspec@latest
```

---

## 扩展与贡献

1. 角色与步骤：[`agents/definitions.json`](agents/definitions.json)、[`agents/*.md`](agents/)
2. 路由与场景：[`config/pipelineConfig.js`](config/pipelineConfig.js)
3. Skill 路径：[`config/skillPaths.js`](config/skillPaths.js)
4. 模型：[`model-config.json`](model-config.json) 或 Dashboard 配置 API

提交 PR 前请保持 **API / 行为变更与 README 同步**。

---

## 故障排除

| 现象 | 处理 |
|------|------|
| 端口 3000 / 5173 占用 | `./stop.sh` 或改 `PORT` / 换 Vite 端口 |
| Agent 无输出 | 检查 OpenCode 与 API Key；看 API 与 executor 日志 |
| 界面有输出但磁盘无代码 | 确认输出是否含 `file:` 块；确认 `localProjectPath` 是否指向预期目录 |
| 多角色同一节点只跑了一个 | 设计如此：再次「执行当前阶段」跑下一角色 |
| Skill 未找到 | 检查 `config/skillPaths.js` 与 `DEVFORGE_*_SKILLS` / `skills/vendor/` |

---

## License

MIT
