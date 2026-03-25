# AI Team Pipeline

基于 **OpenCode + Superpowers** 的多角色 AI 开发团队系统。每个角色有独立目标、自主思考和结构化输出。

## 技术栈

| 层级 | 技术 |
|------|------|
| 编排层 | OpenCode CLI (`opencode run`) |
| Model | `opencode/big-pickle`, `opencode/gpt-5-nano` |
| Skills | Superpowers Skills + gstack Skills |
| 设计规范 | OpenSpec (YAML) |
| 前端 | Vue 3 + Vite + Pinia |
| 后端 | Express.js + Socket.io |

## 架构

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
┌────────┐        ┌────────────┐        ┌──────────┐
│ Scout  │   →   │  Tester   │   →    │   Ops    │
│ 🔍    │        │  🧪       │         │  ⚙️     │
└────────┘        └────────────┘         └──────────┘
                         ↓
              ┌────────────┐        ┌──────────┐
              │  Creative │   →    │ Evolver  │
              │  🎨       │         │  🔄     │
              └────────────┘         └──────────┘
```

## 角色职责

| 角色 | 图标 | 目标 | 输出文件 | Skill |
|------|------|------|----------|-------|
| 产品 | 📋 | 理解需求，生成 PRD | prd.md | brainstorming |
| 架构师 | 🏗️ | 系统设计 | **OpenSpec** | plan-eng-review |
| 侦察兵 | 🔍 | 可行性验证 | scout-report.md | - |
| 开发 | 💻 | 代码实现 | dev-summary.md | test-driven-development |
| 测试 | 🧪 | 集成测试 | test-report.md | qa, browse |
| 运维 | ⚙️ | 部署配置 | ops-config.md | ship |
| 幽灵 | 👻 | 安全审计 | security-report.md | cso |
| 创意 | 🎨 | 设计评审 | design-review.md | - |
| 进化 | 🔄 | 重构优化 | evolver-report.md | - |

## OpenSpec

项目使用 **OpenSpec** 作为架构设计规范（YAML 格式），定义系统架构、API、数据模型、技术选型。

```
.omc/specs/{pipelineId}/openspec-v1.yaml
```

### OpenSpec 流转

```
Architect (生成) → Developer (实现) → Scout (验证) → Tester (测试) → Ops (部署)
```

### OpenSpec 示例结构

```yaml
version: "1.0"
project:
  name: "项目名"
  type: "web-api"  # web-app | web-api | cli | library
techStack:
  frontend: "Vue 3"
  backend: "Node.js/Express"
  database: "PostgreSQL"
apis:
  - path: "/api/users"
    method: "GET"
    description: "获取用户列表"
```

## Skills

### Superpowers Skills (Agent 映射)

| Agent | Skill | 说明 |
|-------|-------|------|
| product | brainstorming | 需求分析 |
| architect | plan-eng-review | 架构设计评审 |
| developer | test-driven-development | TDD 开发 |
| tester | qa | 自动化 QA |
| ops | ship | 部署配置 |
| ghost | cso | 安全审计 |

### gstack Skills (测试集成)

| Skill | 用途 |
|-------|------|
| `/browse` | 页面交互测试 |
| `/qa` | 完整 QA (测试→修复→验证) |
| `/qa-only` | 仅报告不修复 |
| `/canary` | 部署后健康检查 |
| `/benchmark` | 性能回归测试 |

## 决策树路由

```
请求类型 → 流水线路径
├── CRITICAL → 产品 → 架构师 → 创意 → 开发 → 测试 → 进化
├── BUILD    → 产品 → 架构师 → 侦察兵 → 开发 → 测试 → 运维 → 进化
├── REVIEW   → 创意 → 幽灵 → 测试
├── QUERY    → 侦察兵
└── SECURITY → 幽灵 → 架构师
```

## 快速开始

```bash
cd /Users/jialin.chen/WorkSpace/auto_pipeline
npm start
```

打开浏览器：http://localhost:5173

## 目录结构

```
auto_pipeline/
├── agents/
│   ├── definitions.json    # 角色定义（含目标、思考模板、输出格式）
│   ├── team-config.json    # OMC Team 配置
│   └── ...                 # 各角色 prompt
│
├── dashboard/
│   ├── server/             # API Server
│   │   └── server.js
│   └── src/                # Vue Dashboard
│       └── views/
│           └── PipelineDetail.vue  # 展示 thinking + output
│
├── gatekeeper.js           # 守门人编排逻辑
├── workspace/              # 流水线工作区
│   └── {pipelineId}/
│       ├── pipeline.json   # 全局状态
│       ├── thinking/       # 思考过程 (JSON)
│       │   ├── 01-product.json
│       │   └── 02-architect.json
│       ├── output/         # 输出交付物 (Markdown)
│       │   ├── prd.md
│       │   └── openspec.md
│       └── {agent}/        # Agent 工作目录
│
└── CLAUDE.md
```

## Agent 思考与输出

每个 Agent 执行包含三个阶段：

1. **Goal** - 明确目标
2. **Thinking** - Chain-of-Thought 推理
3. **Output** - 结构化交付

### thinking 示例

```json
{
  "agent": "architect",
  "steps": [
    {
      "prompt": "1. 分析功能范围和技术边界",
      "thought": "用户需要实现用户登录功能..."
    }
  ]
}
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| /api/pipelines | POST | 创建流水线 |
| /api/pipelines | GET | 列表 |
| /api/pipelines/:id | GET | 详情 |
| /api/pipelines/:id/thinking | GET | 思考过程 |
| /api/pipelines/:id/output | GET | 输出结果 |
| /api/pipelines/:id/tree | GET | 树状状态 |
| /api/pipelines/:id/start | POST | 启动 |

## Dashboard 展示

点击流水线中的角色卡片，可查看：
- 🎯 **目标** - Agent 要完成的任务
- 💭 **思考过程** - 推理步骤
- 📤 **输出结果** - 交付物

## License

MIT
