# gstack 集成配置

## 概述

gstack 是测试层的重要组成部分，为测试 Agent 提供 UI 测试、E2E 测试、性能测试等能力。

## 集成方式

测试 Agent (tester.md) 会自动调用 gstack 技能：

| 技能 | 用途 | 触发场景 |
|------|------|----------|
| `/browse` | 页面交互测试 | 每次 UI 测试 |
| `/qa` | 完整 QA 循环 | 功能测试 |
| `/qa-only` | 只报告不修复 | 审查模式 |
| `/canary` | 部署后监控 | 部署验证 |
| `/benchmark` | 性能回归 | 性能测试 |

## 启动 gstack 服务

```bash
# 方式 1: 使用 gstack CLI
gstack

# 方式 2: 通过 Claude Code
/claude browse https://example.com
```

## 测试报告格式

测试 Agent 生成的报告结构：

```json
{
  "reportId": "uuid",
  "pipelineId": "parent-pipeline-id",
  "testType": "smoke|full|regression|e2e",
  "summary": {
    "total": 50,
    "passed": 45,
    "failed": 3,
    "skipped": 2,
    "pass_rate": "90%"
  },
  "bugs": [...],
  "screenshots": [...],
  "performance": {...}
}
```

## 在流水线中使用

```
用户请求: 实现用户登录功能
    ↓
架构师: 设计登录流程 OpenSpec
    ↓
开发: 实现登录代码
    ↓
测试(QA):
    ├── 使用 /browse 测试登录页面
    ├── 使用 /qa 进行完整验证
    ├── 使用 /benchmark 性能测试
    ↓
生成测试报告 → 存入 .omc/specs/{id}/test-report.json
```

## 测试配置

在 `agents/tester.md` 中配置测试场景：

```markdown
## 测试场景

### Smoke Test (冒烟测试)
- 核心功能快速验证
- 预计时间: 2-5 分钟
- 阈值: 100% 通过

### Full Test (完整测试)
- 所有功能测试
- 预计时间: 10-30 分钟
- 阈值: 95% 通过

### Regression (回归测试)
- 验证新功能不影响旧功能
- 预计时间: 15-60 分钟
- 阈值: 90% 通过

### E2E (端到端)
- 完整用户流程
- 预计时间: 5-15 分钟
- 阈值: 100% 通过
```

## 性能基准

```json
{
  "lcp": "< 2.5s",
  "fid": "< 100ms",
  "cls": "< 0.1",
  "load_time": "< 3s",
  "score": "> 80"
}
```

## 本地开发测试

```bash
# 1. 启动开发服务器
npm run dev

# 2. 使用 gstack 测试
gstack browse http://localhost:5173

# 3. 运行 QA
gstack qa http://localhost:5173 --mode smoke

# 4. 性能测试
gstack benchmark http://localhost:5173
```

## 集成检查清单

- [ ] gstack 已安装
- [ ] 测试 Agent 可以调用 /browse
- [ ] 测试 Agent 可以调用 /qa
- [ ] 测试报告格式正确
- [ ] 截图正确保存
- [ ] 性能数据正确收集
