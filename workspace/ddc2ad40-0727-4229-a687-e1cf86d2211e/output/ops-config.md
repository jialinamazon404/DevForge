{
  "dockerfile": "FROM node:18-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --only=production\nCOPY . .\nEXPOSE 3000\nCMD [\"node\", \"index.js\"]",
  "docker_compose": "version: \"3.8\"\nservices:\n  app:\n    build: .\n    ports:\n      - \"3000:3000\"",
  "ci_config": {
    "provider": "github-actions",
    "stages": [
      "test",
      "build",
      "deploy"
    ]
  },
  "deployment_script": "#!/bin/bash\necho \"Deploying...\"",
  "env_template": {
    "NODE_ENV": "production",
    "PORT": "3000"
  }
}