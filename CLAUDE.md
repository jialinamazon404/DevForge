# AI Team Pipeline - OpenCode 配置

## 项目概述

这是一个基于 OMC + Superpowers 的多角色 AI 开发团队系统，每个角色有独立目标、自主思考和结构化输出。

## 核心架构

```
用户请求
    ↓
┌─────────────────────────────────────────────────────────┐
│                    OMC 编排层                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Gatekeeper (守门人) - 路由决策 + 派发任务         │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           ↓
    ┌──────────────────────────────────────────────────┐
    ↓                    ↓                    ↓
┌────────┐        ┌────────────┐        ┌──────────┐
│Product │   →   │ Architect  │   →    │ Developer│
│ 📋    │        │  🏗️        │         │  💻     │
└────────┘        └────────────┘         └──────────┘
    ↓                    ↓                    ↓
┌────────────┐    ┌────────────┐        ┌──────────┐
│Tech Coach  │   │  Tester   │   →    │   Ops    │
│ 🔍        │   │  🧪       │         │  ⚙️     │
└────────────┘    └────────────┘         └──────────┘
                         ↓
              ┌────────────┐        ┌──────────┐
              │  Creative │   →    │ Evolver  │
              │  🎨       │         │  🔄     │
              └────────────┘         └──────────┘
```

## 角色定义

| 角色 | 图标 | 目标 | 输出 |
|------|------|------|------|
| 产品 | 📋 | 理解需求，生成 PRD | 用户故事、功能清单、验收标准 |
| 架构师 | 🏗️ | 系统设计 + OpenSpec CLI | OpenSpec Change Proposal、API、数据模型 |
| 开发教练 | 🔍 | 整合产出，翻译为开发规格 | 技术实现文档、用户故事、可行性分析 |
| 开发 | 💻 | 代码实现 | 源代码、测试、PR |
| 测试 | 🧪 | 集成测试 | 测试报告、Bug 列表 |
| 运维 | ⚙️ | 部署配置 | Dockerfile、CI/CD |
| 幽灵 | 👻 | 安全审计 | 安全报告（只读） |
| 创意 | 🎨 | 设计评审 | 评审意见、建议 |
| 进化 | 🔄 | 重构优化 | 重构代码、性能改进 |

## 决策树路由

```javascript
const ROUTES = {
  CRITICAL: ['product', 'architect', 'creative', 'developer', 'tester', 'evolver'],
  BUILD:    ['product', 'architect', 'tech_coach', 'developer', 'tester', 'ops', 'evolver'],
  REVIEW:   ['creative', 'ghost', 'tester'],
  QUERY:    ['tech_coach'],
  SECURITY: ['ghost', 'architect']
};
```

## Agent 思考与输出

每个 Agent 包含：

| 字段 | 说明 |
|------|------|
| `goal` | 本阶段目标 |
| `thinking` | Chain-of-Thought 推理过程 |
| `output` | 结构化交付物 |

### thinking 结构

```json
{
  "agent": "architect",
  "startedAt": "2026-03-26T00:00:00Z",
  "steps": [
    {
      "prompt": "1. 分析功能范围和技术边界",
      "thought": "用户需要实现用户登录功能...",
      "timestamp": "2026-03-26T00:00:01Z"
    }
  ]
}
```

## workspace 结构

```
workspace/{sprintId}/              # 冲刺执行记录（轻量）
├── thinking/            # 思考过程
│   ├── 01-product.json
│   ├── 02-architect.json
│   └── ...
├── output/              # 输出交付物
│   ├── prd.md
│   ├── user-stories.md
│   ├── tech-feasibility.md
│   ├── test-report.md
│   ├── ops-config.md
│   ├── security-report.md
│   ├── design-review.md
│   └── evolver-report.md
├── product/            # 产品文档
├── architect/          # 架构设计文档
├── tech-coach/         # 技术实现文档
├── tester/             # 测试文档
└── ops/                # 运维文档

projects/{projectId}/              # 项目根目录（持续演进）
├── openspec/            # 共享 OpenSpec 仓库
│   └── changes/         # 每次 sprint 追加新 change
│       └── <name>/
│           ├── proposal.md
│           ├── design.md
│           └── tasks.md
└── src/                 # 共享代码库（增量更新）
    ├── frontend/
    ├── backend/
    ├── README.md
    └── API.md
```

## API Server

- **地址**: http://localhost:3000
- **WebSocket**: ws://localhost:3000

### 新增端点

- `GET /api/pipelines/:id/thinking` - 获取思考过程
- `GET /api/pipelines/:id/output` - 获取输出结果
- `GET /api/pipelines/:id/stage/:index` - 获取单个阶段详情
- `GET /api/pipelines/:id/tree` - 获取树状流水线状态

## Dashboard 展示

每个阶段卡片包含：
- 角色图标 + 名称
- 状态 (待处理/思考中/完成)
- 目标 (Goal)
- 思考过程 (Thinking) - 可展开
- 输出摘要 (Output) - 可展开
- 耗时统计

## 启动

```bash
./start.sh    # 一键启动 (API:3000, Dashboard:5173)
./stop.sh     # 停止
./restart.sh  # 重启
```

## Agent 调用方式

使用 Task 工具派发 agent：

```
Task(
  prompt: 读取 agents/definitions.json 获取角色定义，执行对应角色任务,
  subagent_type: "general" | "explore",
  model: "sonnet" | "opus"
)
```
