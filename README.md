# DevForge - AI Team Pipeline

> **版本**: v2.2.0
> 基于 **OpenCode + Superpowers** 的多角色 AI 开发团队系统。

## v2.2.0 更新内容

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
| **Product** | 📋 | 需求分析 | 用户原始需求 | PRD (JSON) | `big-pickle` | brainstorming |
| **Architect** | 🏗️ | 架构设计 | PRD | OpenSpec (YAML) | `big-pickle` | plan-eng-review |
| **Scout** | 🔍 | 可行性验证 | 用户需求 | 风险评估报告 | `gpt-5-nano` | - |
| **Developer** | 💻 | 代码实现 | PRD + OpenSpec | 前端/后端代码 + README + API.md | `big-pickle` | test-driven-development |
| **Tester** | 🧪 | 功能+安全测试 | 代码路径 | test-report.md + security-report.md | `big-pickle` | gstack/qa |
| **Ops** | ⚙️ | 部署配置 | OpenSpec | Dockerfile/部署配置 | `gpt-5-nano` | ship |
| **Evolver** | 🔄 | 重构优化 | 现有代码 | 重构建议报告 | `gpt-5-nano` | - |

### 角色详细说明

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
| product | `opencode/big-pickle` | brainstorming | 需求分析 |
| architect | `opencode/big-pickle` | plan-eng-review | 架构设计评审 |
| developer | `opencode/big-pickle` | test-driven-development | TDD 开发 |
| tester | `opencode/big-pickle` | qa | 自动化 QA |
| ops | `opencode/gpt-5-nano` | ship | 部署配置 |
| scout | `opencode/gpt-5-nano` | - | 代码探索 |
| evolver | `opencode/gpt-5-nano` | - | 重构优化 |

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

### 1. 启动 Dashboard

```bash
cd /Users/jialin.chen/WorkSpace/DevForge
node dashboard/server/server.js
```

### 2. 打开浏览器

访问 http://localhost:3000

### 3. 创建项目与冲刺

1. 登录 (默认账号: admin / admin)
2. 创建项目
3. 创建冲刺，填写需求
4. 启动冲刺，开始执行角色

---

## 目录结构

```
DevForge/
├── sprint-agent-executor.js   # Sprint 模式 Agent 执行器
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

---

## Dashboard 功能

- **项目列表**: 创建、编辑、删除项目
- **冲刺管理**: 创建冲刺，设定目标，分配角色
- **角色执行**: 
  - Product → 生成 PRD
  - Architect → 生成 OpenSpec
  - Developer → 生成代码
  - Tester → 生成测试报告
- **实时状态**: WebSocket 推送执行进度
- **日志查看**: 查看每个角色的输出日志

---

## 注意事项

1. **本地代码测试**: Tester 直接读取 `workspace/{sprintId}/developer/` 下的代码，无需部署
2. **OpenSpec 传递**: Architect 生成的 OpenSpec 会传递给 Developer 作为实现依据
3. **gstack 集成**: Tester 使用 gstack 进行 UI 测试，需要确保 gstack 可用

---

## License

MIT