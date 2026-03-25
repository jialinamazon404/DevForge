{
  "version": "1.0",
  "requirements": [
    {
      "id": "REQ-001",
      "source": "US-001",
      "description": "功能需求",
      "priority": "HIGH"
    }
  ],
  "architecture": {
    "components": [
      {
        "name": "Frontend",
        "responsibility": "用户界面",
        "tech_stack": "Vue 3"
      },
      {
        "name": "Backend",
        "responsibility": "业务逻辑",
        "tech_stack": "Node.js"
      },
      {
        "name": "Database",
        "responsibility": "数据存储",
        "tech_stack": "PostgreSQL"
      }
    ],
    "data_flow": [
      "用户请求 → 前端 → API → 业务逻辑 → 数据库"
    ]
  },
  "api": {
    "endpoints": [
      {
        "method": "GET",
        "path": "/api/health",
        "request": "none",
        "response": "{status: \"ok\"}"
      }
    ]
  },
  "data_model": {
    "entities": [
      {
        "name": "User",
        "fields": [
          {
            "name": "id",
            "type": "UUID"
          },
          {
            "name": "name",
            "type": "string"
          }
        ]
      }
    ]
  },
  "tech_stack": {
    "frontend": "Vue 3 + Vite",
    "backend": "Express.js",
    "database": "PostgreSQL"
  },
  "decisions": [
    {
      "id": "DEC-001",
      "topic": "技术选型",
      "decision": "使用 Node.js",
      "rationale": "团队熟悉"
    }
  ]
}