# Moby Dick - AI 开发舰队

> **版本**: v2.3.0
> 致敬白胡子的多角色 AI 开发团队系统（原 DevForge - Team Pipeline）

## v2.3.0 更新内容

### 🤖 Agent 自动流转
- Agent 执行完成后自动确认并流转到下一阶段
- Ops 角色自动获取 Developer 的输出作为输入
- 自动确认失败时保持 `completed` 状态，支持手动确认

### 🔧 Sprint ID 复制
- Sprint 详情页显示完整 ID
- 一键复制按钮，支持 HTTPS/HTTP 环境
- 复制成功/失败状态即时反馈

### ⚡ 实时进度显示
- WebSocket 实时推送 agent:progress 事件
- 界面实时显示 Agent 执行进度日志
- 每个角色执行状态即时更新

### 🎯 角色卡片增强
- 角色卡片显示 Skill 和 Model 信息
- 角色详情面板支持模型切换
- 模型配置持久化到 LocalStorage

### 📐 角色顺序优化
- 新顺序：BA → 产品 → 架构师 → 开发者 → QA → SRE → 进化顾问
- 条件触发角色：幽灵（安全审计）、创意（设计评审）

### 🌐 网络访问支持
- 服务绑定 0.0.0.0，支持局域网 IP 访问
- Dashboard: http://localhost:5173 / http://{IP}:5173
- API: http://localhost:3000 / http://{IP}:3000

### 🧹 僵尸进程清理
- sprint-agent-executor.js 增加僵尸进程检测
- 定时清理超时未退出的 Agent 进程
- 防止资源泄漏

### 📝 文本域优化
- 输入/输出文本域最大高度限制
- 支持滚动查看长内容
- 优化移动端体验

---

## v2.2.0 更新内容 (历史)

### ⏱️ Developer 超时优化
- Developer 超时从 5 分钟增加到 10 分钟
- 适配复杂代码生成场景

### 🔒 UI 执行锁定
- SprintDetail.vue 新增锁定逻辑
- 当前角色执行中时禁用"确认输出"按钮
- 防止用户跳过正在执行的角色

### 🧪 Tester 环境适配
- Tester 提示词增加环境说明
- 无后端环境时可进行静态代码审查
- 报告保留在 workspace，界面只显示摘要

### 📊 Tester 输出摘要
- 界面只显示 Bug 数量或环境问题
- 完整报告保存到 workspace/tester/report.json
- 支持环境问题/Bug 数量/测试通过三种状态展示

### ⚙️ Ops 自动化
- Ops 角色自动读取 Developer 产出目录的启动命令
- 基于 README.md 或 package.json 生成 Dockerfile
- 生成 docker-compose.yml 和 CI/CD 部署脚本

### 📐 OpenSpec 贯穿架构与开发
- **Architect** 生成 OpenSpec 架构文档 (YAML)
- **Developer** 读取 OpenSpec 实现代码
- OpenSpec 包含：技术选型、API 设计、数据模型、目录结构

### 🧪 Tester 使用 gstack 进行本地测试
- 直接读取 `workspace/{sprintId}/developer/` 下的生成代码
- 使用 gstack headless browser 测试前端 UI
- 生成两份报告：功能测试 + 接口安全

### 🎨 Dashboard UI 改造
- Vue 官方首页风格 (深色主题 + 霓虹绿高亮)
- 毛玻璃效果 + 发光边框
- 响应式布局

### 🔧 技术改进
- sprint-agent-executor.js 独立执行器
- WebSocket 实时状态更新
- 本地代码路径直接读取

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 编排层 | OpenCode CLI (`opencode run`) |
| Model | `opencode/big-pickle`, `opencode/gpt-5-nano` |
| Skills | Superpowers Skills + gstack Skills |
| 前端 Dashboard | Vue 3 + Vite + Tailwind CSS |
| 后端 API | Express.js + Socket.io |
| 生成代码 | 根据 OpenSpec 动态选择 (Vue/React + Express/Spring) |

---

## 角色定义

| 角色 | 图标 | 目标 | 输入 | 输出 | 模型 | Skill |
|------|------|------|------|------|------|-------|
| **Gatekeeper** | 🚪 | 路由决策 | 原始请求 | 路由决策 + Pipeline 配置 | `big-pickle` | - |
| **BA** | 📝 | 业务分析 | 用户原始需求 | 业务分析报告 | `big-pickle` | brainstorming |
| **Product** | 📋 | 需求分析 | 业务分析 | PRD (JSON) | `big-pickle` | brainstorming |
| **Architect** | 🏗️ | 架构设计 | PRD | OpenSpec (YAML) | `big-pickle` | plan-eng-review |
| **Scout** | 🔍 | 技术可行性验证 | OpenSpec | 风险评估报告 | `big-pickle` | - |
| **Developer** | 💻 | 代码实现 | PRD + OpenSpec | 前端/后端代码 + README + API.md | `big-pickle` | test-driven-development |
| **Tester** | 🧪 | 功能+安全测试 | 代码路径 | test-report.md + security-report.md | `big-pickle` | gstack/qa |
| **Ops** | ⚙️ | 部署配置 | Developer 输出 | Dockerfile/部署配置 | `gpt-5-nano` | ship |
| **Evolver** | 🔄 | 重构优化 | 现有代码 | 重构建议报告 | `gpt-5-nano` | retro |
| **Ghost** | 👻 | 安全审计 | 全部输出 | 安全报告 | `big-pickle` | cso |
| **Creative** | 🎨 | 设计评审 | 全部输出 | 评审意见 | `big-pickle` | design-review |

### 决策路由（5 种模式）

| 路由 | 执行顺序 |
|------|----------|
| **CRITICAL** | product → architect → creative → developer → tester → evolver |
| **BUILD** | product → architect → scout → developer → tester → ops → evolver |
| **REVIEW** | creative → ghost → tester |
| **QUERY** | scout |
| **SECURITY** | ghost → architect |

### 条件触发角色

| 角色 | 图标 | 触发条件 | Skill |
|------|------|----------|-------|
| **Scout** | 🔍 | BUILD 模式 | - |
| **Ghost** | 👻 | REVIEW / SECURITY | cso - 安全审计 |
| **Creative** | 🎨 | REVIEW / CRITICAL | design-review - UI/UX 评审 |

### 角色详细说明

#### 🚪 Gatekeeper (守门人)
- **目标**: 维护中央状态机，解析请求，路由决策，派发任务给下游 Agent
- **输入**: 原始用户请求
- **输出**: 路由决策 (CRITICAL/BUILD/REVIEW/QUERY/SECURITY) + Pipeline 配置
- **模型**: `big-pickle`

#### 📝 BA (业务分析师)
- **目标**: 业务分析，提取核心需求
- **输入**: 用户原始需求
- **输出**: 业务分析报告
- **Skill**: brainstorming

#### 📋 Product (产品经理)
- **目标**: 理解需求，生成完整的 PRD 文档
- **输入**: 用户原始需求 + 用户补充输入
- **输出**: JSON 格式 PRD，包含产品概述、用户画像、用户故事、功能清单、验收标准
- **Skill**: brainstorming - 需求分析

#### 🏗️ Architect (架构师)
- **目标**: 根据 PRD 生成系统架构设计
- **输入**: PRD 文档
- **输出**: OpenSpec (YAML)，包含系统架构图、技术选型、API 设计、数据模型
- **Skill**: plan-eng-review - 架构设计评审

#### 🔍 Scout (侦察兵)
- **目标**: 验证技术可行性，识别风险
- **输入**: 用户需求 + OpenSpec
- **输出**: 风险评估报告，包含技术风险、实施难点、替代方案
- **Skill**: 无

#### 💻 Developer (开发者)
- **目标**: 根据 OpenSpec 实现完整代码
- **输入**: PRD + OpenSpec
- **输出**: 
  - `developer/frontend/` - 前端代码
  - `developer/backend/` - 后端代码 (如有)
  - `README.md` - 运行说明
  - `API.md` - 接口文档 (如有)
- **Skill**: test-driven-development - TDD 开发

#### 🧪 Tester (测试工程师)
- **目标**: 功能测试 + 接口安全测试
- **输入**: 本地代码路径 (`workspace/{sprintId}/developer/`)
- **输出**:
  - `output/test-report.md` - 功能测试报告
  - `output/security-report.md` - 接口安全报告
- **Skill**: gstack/qa - 使用 headless browser 进行 UI 测试

#### ⚙️ Ops (运维工程师)
- **目标**: 生成部署配置
- **输入**: OpenSpec
- **输出**: Dockerfile, docker-compose.yml, CI/CD 配置
- **Skill**: ship - 部署配置

#### 🔄 Evolver (进化顾问)
- **目标**: 代码重构与优化
- **输入**: 现有代码
- **输出**: 重构建议报告，包含性能优化、代码质量改进
- **Skill**: 无

---

## OpenSpec 流转

```
Product (生成 PRD)
    ↓
Architect (读取 PRD, 生成 OpenSpec)
    ↓
Developer (读取 OpenSpec, 实现代码) ←→ Tester (读取代码, 验证功能)
    ↓
Ops (读取 OpenSpec, 配置部署)
```

### OpenSpec 示例结构

```yaml
version: "1.0"
project:
  name: "项目名"
  type: "web-app"  # web-app | web-api | cli | library
techStack:
  frontend: "Vue 3 + Vite"
  backend: "Express.js"
  database: "SQLite"
apis:
  - path: "/api/users"
    method: "GET"
    description: "获取用户列表"
    request:
      - name: "page"
        type: "number"
        required: false
    response:
      - name: "users"
        type: "array"
database:
  tables:
    - name: "users"
      columns:
        - name: "id"
          type: "integer"
          primaryKey: true
```

---

## Skills 映射

### Superpowers Skills

| Agent | 模型 | Skill | 说明 |
|-------|------|-------|------|
| gatekeeper | `opencode/big-pickle` | - | 路由决策 |
| ba | `opencode/big-pickle` | brainstorming | 业务分析 |
| product | `opencode/big-pickle` | **user-story**, product-spec-kit, ui-ux-designer, tailwind-design-system, user-journeys, brainstorming | 需求分析 + 用户故事 + 界面设计 |
| architect | `opencode/big-pickle` | OpenSpec, **system-design**, database-design, plan-eng-review | 系统设计 + 架构评审 |
| scout | `opencode/big-pickle` | OpenSpec验证 | 技术可行性验证 |
| developer | `opencode/big-pickle` | **api-design**, **event-driven**, test-driven-development, systematic-debugging, unit-test-generator, log-analyzer | API 设计 + 事件驱动 + TDD + 调试 |
| tester | `opencode/big-pickle` | qa, browse, canary, benchmark | 自动化 QA + 测试 |
| ops | `opencode/gpt-5-nano` | ship | 部署配置 |
| evolver | `opencode/gpt-5-nano` | retro, tech-debt | 重构优化 + 技术债务 |
| ghost | `opencode/big-pickle` | cso | 安全审计 |
| creative | `opencode/big-pickle` | design-review | UI/UX 评审 |

### Product 场景与 Skills

| 场景 | Skills 组合 | 输出 |
|------|-------------|------|
| 新产品立项 | user-story → product-spec-kit → brainstorming | PRD + 产品规格 + 用户故事 |
| 原型与设计落地 | ui-ux-designer → tailwind-design-system | 界面布局建议 + 设计系统 |
| 体验优化 | user-journeys → brainstorming | 交互流程草图 + 改进建议 |

### 新安装 Skills

| Skill | 来源 | 安装量 | 用途 | 状态 |
|-------|------|--------|------|------|
| `api-design` | wshobson/agents | 13.2K ⭐ | RESTful API 设计原则 | ✅ |
| `event-driven` | 404kidwiz/claude-supercode-skills | 133 | 事件驱动架构模式 | ✅ |
| `system-design` | anthropics/knowledge-work-plugins | 676 ⭐ | 系统设计原则 | ✅ |
| `user-story` | deanpeters/product-manager-skills | 734 ⭐ | 用户故事拆分 | ✅ |
| `product-spec-kit` | diegoeis/product-spec-kit | 66 | 产品规格文档 | ✅ |
| `ui-ux-designer` | lotosbin/claude-skills | 1.2K ⭐ | UI/UX 设计 | ✅ |
| `tailwind-design-system` | wshobson/agents | 25.7K ⭐ | 设计系统构建 | ✅ |
| `user-journeys` | alinaqi/claude-bootstrap | 163 ⭐ | 用户旅程映射 | ✅ |
| `tech-debt` | anthropics/knowledge-work-plugins | 501 ⭐ | 技术债务分析 | ✅ |
| `systematic-debugging` | obra/superpowers | 44.5K ⭐ | 系统调试、根因分析 | ✅ |
| `unit-test-generator` | patricio0312rev/skills | 76 | 单元测试生成 | ✅ |
| `log-analyzer` | levnikolaevich/claude-code-skills | 68 | 日志分析 | ✅ |
| `database-design` | sickn33/antigravity-awesome-skills | 931 ⭐ | 数据库设计 | ✅ (新安装成功) |
| `architecture-review` | srstomp/pokayokay | 180 | 架构评审 | ✅ (新安装成功) |
| `refactor` | - | - | 代码重构 | ❌ 需替代 |
| `bug-hunter` | - | - | Bug 追踪 | ❌ 需替代 |
| `frontend-builder` | - | - | 前端构建 | ❌ 需替代 |

### 架构师场景化工作流程

| 场景 | Skills 工作流 | 说明 |
|------|-------------|------|
| **新系统架构设计** | OpenSpec → system-design → database-design → document | 从零开始设计新系统 |
| **现有系统架构优化** | explain → tech-debt-analyzer → architecture-review → refactor | 架构优化和重构 |
| **高并发场景架构改造** | optimize → event-driven → api-design | 高并发优化 |

### 开发者场景化工作流程

| 场景 | Skills 工作流 | 说明 |
|------|-------------|------|
| **日常功能开发** | code → refactor → TDD → document | 涉及接口必用 api-design |
| **复杂 bug 排查** | systematic-debugging → bug-hunter → log-analyzer → code | 系统调试方法 |
| **技术栈专项开发** | frontend-builder → unit-test-generator → dependency-checker | 接口必用 api-design |

> **模型配置**: 可在 Dashboard 界面中点击角色卡片切换模型，配置保存到 LocalStorage

### gstack Skills

| Skill | 用途 |
|-------|------|
| `/browse` | 页面交互测试 |
| `/qa` | 完整 QA (测试→修复→验证) |
| `/qa-only` | 仅报告不修复 |
| `/canary` | 部署后健康检查 |
| `/benchmark` | 性能回归测试 |

---

## 快速开始

### 1. 启动服务

```bash
cd /Users/jialin.chen/WorkSpace/DevForge
./restart.sh
```

或手动启动：

```bash
# 终端 1: API Server
cd /Users/jialin.chen/WorkSpace/DevForge/dashboard/server
node server.js

# 终端 2: Dashboard (开发模式)
cd /Users/jialin.chen/WorkSpace/DevForge/dashboard
npm run dev
```

### 2. 打开浏览器

- 本地访问: http://localhost:5173
- 局域网访问: http://{你的IP}:5173

### 3. 创建项目与冲刺

1. 登录 (默认账号: admin / admin)
2. 创建项目
3. 创建冲刺，填写需求
4. 启动冲刺，开始执行角色

### 常用命令

```bash
./restart.sh   # 重启所有服务
./stop.sh     # 停止所有服务
```

---

## 目录结构

```
DevForge/
├── sprint-agent-executor.js   # Sprint 模式 Agent 执行器
├── model-config.json          # 模型配置文件
├── restart.sh                 # 重启脚本
├── stop.sh                    # 停止脚本
├── CLAUDE.md                  # Claude Code 配置
│
├── dashboard/
│   ├── server/
│   │   └── server.js          # API Server (Express + Socket.io)
│   └── src/
│       ├── App.vue            # Vue 主组件 (深色主题)
│       ├── style.css          # 全局样式
│       ├── views/
│       │   ├── Login.vue      # 登录页
│       │   ├── ProjectList.vue
│       │   ├── ProjectDetail.vue
│       │   └── SprintDetail.vue
│       └── stores/
│           └── project.js     # Pinia 状态管理
│
├── workspace/                 # 工作区
│   └── {sprintId}/
│       ├── output/            # 输出交付物
│       │   ├── prd.md         # Product 输出
│       │   ├── openspec.md    # Architect 输出
│       │   ├── test-report.md # Tester 功能报告
│       │   └── security-report.md # Tester 安全报告
│       └── developer/          # Developer 代码输出
│           ├── README.md
│           ├── API.md
│           ├── frontend/      # 前端代码
│           └── backend/       # 后端代码 (如有)
│
└── README.md
```

---

## 输出文件规范

所有角色输出文件统一使用 **Markdown (.md)** 格式，位于 `workspace/{sprintId}/` 目录下：

### 角色输出文件清单

| 角色 | 输出文件 | 路径 | 说明 |
|------|---------|------|------|
| **Gatekeeper** | 路由决策 | `output/route-decision.md` | 路由决策记录 |
| **Product** | PRD 文档 | `output/prd.md` | 产品需求文档 |
| | 产品规格 | `output/product-spec.md` | 产品概述、目标、竞品 |
| | 界面布局 | `output/ui-layout.md` | 页面布局建议 |
| | 交互流程 | `output/user-journey.md` | 用户旅程 |
| | 用户故事 | `output/user-stories.md` | 标准化用户故事 |
| **Architect** | 架构设计 | `output/openspec.md` | OpenSpec 架构文档 |
| **Scout** | 风险评估 | `output/scout-report.md` | 技术可行性评估 |
| **Developer** | 开发摘要 | `output/dev-summary.md` | 开发完成情况 |
| | 运行说明 | `developer/README.md` | 项目运行指南 |
| | 接口文档 | `developer/API.md` | API 说明 |
| | 前端代码 | `developer/frontend/` | 前端源代码 |
| | 后端代码 | `developer/backend/` | 后端源代码 |
| **Tester** | 测试报告 | `output/test-report.md` | 功能测试报告 |
| | 安全报告 | `output/security-report.md` | 接口安全报告 |
| **Ops** | 部署配置 | `output/ops-config.md` | 部署说明文档 |
| | Dockerfile | `output/Dockerfile` | Docker 配置 |
| | Docker Compose | `output/docker-compose.yml` | 容器编排 |
| | CI/CD | `output/.github/workflows/` | 流水线配置 |
| **Ghost** | 安全审计 | `output/security-report.md` | 安全漏洞扫描 |
| **Creative** | 设计评审 | `output/design-review.md` | UI/UX 评审 |
| **Evolver** | 进化建议 | `output/evolver-report.md` | 重构改进建议 |

---

## API 端点

### 项目 API

| 端点 | 方法 | 说明 |
|------|------|------|
| /api/projects | POST | 创建项目 |
| /api/projects | GET | 项目列表 |
| /api/projects/:id | GET | 项目详情 |
| /api/projects/:id | PUT | 更新项目 |
| /api/projects/:id | DELETE | 删除项目 |

### 冲刺 API

| 端点 | 方法 | 说明 |
|------|------|------|
| /api/projects/:p/sprints | POST | 创建冲刺 |
| /api/projects/:p/sprints | GET | 冲刺列表 |
| /api/sprints/:id | GET | 冲刺详情 |
| /api/sprints/:id | PUT | 更新冲刺 |
| /api/sprints/:id/start | POST | 启动冲刺 |

### 迭代 API

| 端点 | 方法 | 说明 |
|------|------|------|
| /api/sprints/:id/iterations/:i/input | PUT | 用户输入 |
| /api/sprints/:id/iterations/:i/output | PUT | Agent 输出更新 |
| /api/sprints/:id/iterations/:i/execute | POST | 执行角色 |
| /api/sprints/:id/iterations/:i/confirm | PUT | 确认输出 |
| /api/sprints/:id/iterations/:i/rerun | POST | 重跑角色 |

### 配置 API

| 端点 | 方法 | 说明 |
|------|------|------|
| /api/config/models | GET | 获取模型配置 |
| /api/config/models | PUT | 保存模型配置 |

### WebSocket 事件

| 事件 | 说明 |
|------|------|
| agent:progress | Agent 执行进度实时推送 |
| agent:output | Agent 输出实时推送 |
| iteration:confirmed | 角色确认完成 |
| iteration:execution:started | 角色开始执行 |
| sprint:started | 冲刺启动 |

---

## Dashboard 功能

- **项目列表**: 创建、编辑、删除项目
- **冲刺管理**: 创建冲刺，设定目标，分配角色
- **角色执行**: 
  - BA → 业务分析
  - Product → 生成 PRD
  - Architect → 生成 OpenSpec
  - Developer → 生成代码
  - Tester → 生成测试报告
  - SRE → 部署配置
- **实时状态**: WebSocket 推送执行进度
- **日志查看**: 查看每个角色的输出日志
- **模型切换**: 点击角色卡片切换模型
- **Sprint ID 复制**: 一键复制 Sprint ID

---

## 注意事项

1. **本地代码测试**: Tester 直接读取 `workspace/{sprintId}/developer/` 下的代码，无需部署
2. **OpenSpec 传递**: Architect 生成的 OpenSpec 会传递给 Developer 作为实现依据
3. **gstack 集成**: Tester 使用 gstack 进行 UI 测试，需要确保 gstack 可用

---

## License

MIT