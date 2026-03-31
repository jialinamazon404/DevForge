<template>
  <div class="space-y-6">
    <!-- 角色切换器 -->
    <div class="bg-gray-800 rounded-lg border border-gray-700">
      <div class="px-6 py-4 border-b border-gray-700">
        <h2 class="text-lg font-medium text-white">角色切换</h2>
        <p class="text-gray-400 text-sm mt-1">选择要扮演的角色，查看该角色的任务和状态</p>
      </div>
          <div class="p-6">
        <div class="grid grid-cols-2 md:grid-cols-6 lg:grid-cols-7 gap-3">
          <button
            v-for="agent in agents"
            :key="agent.id"
            @click="selectAgent(agent)"
            class="p-3 rounded-lg border-2 transition-all text-center relative"
            :class="selectedAgent?.id === agent.id 
              ? 'border-primary-500 bg-primary-500/10' 
              : 'border-gray-700 hover:border-gray-600 bg-gray-900'"
          >
            <div class="text-2xl mb-1">{{ agent.icon }}</div>
            <div class="text-white font-medium text-sm">{{ agent.name }}</div>
            <div v-if="agent.skills?.length > 0" class="text-primary-400 text-xs mt-1">
              ⚡ {{ agent.skills.length }} skills
            </div>
            <div v-else class="text-gray-500 text-xs mt-1">
              ⚡ 核心角色
            </div>
          </button>
        </div>
      </div>
    </div>

    <!-- 选中角色详情 -->
    <div v-if="selectedAgent" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- 角色信息 -->
      <div class="bg-gray-800 rounded-lg border border-gray-700">
        <div class="px-6 py-4 border-b border-gray-700">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-medium text-white">
              {{ selectedAgent.icon }} {{ selectedAgent.name }}
            </h2>
            <button
              @click="selectedAgent = null"
              class="text-gray-400 hover:text-white"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div class="p-6 space-y-4">
          <div>
            <h3 class="text-gray-400 text-sm mb-2">职责</h3>
            <p class="text-white">{{ selectedAgent.description }}</p>
          </div>
          
          <div>
            <h3 class="text-gray-400 text-sm mb-2">触发条件</h3>
            <div class="flex flex-wrap gap-2">
              <span 
                v-for="trigger in selectedAgent.triggers" 
                :key="trigger"
                class="px-2 py-1 bg-gray-700 rounded text-sm text-gray-300"
              >
                {{ trigger }}
              </span>
            </div>
          </div>

          <div>
            <h3 class="text-gray-400 text-sm mb-2">工具</h3>
            <div class="flex flex-wrap gap-2">
              <span 
                v-for="tool in selectedAgent.tools" 
                :key="tool"
                class="px-2 py-1 bg-primary-500/20 rounded text-sm text-primary-400"
              >
                {{ tool }}
              </span>
            </div>
          </div>

          <div v-if="selectedAgent.skills?.length > 0" class="border-t border-gray-700 pt-4">
            <h3 class="text-gray-400 text-sm mb-2">使用的 Skills ({{ selectedAgent.skills.length }})</h3>
            <div class="space-y-2">
              <div 
                v-for="skill in selectedAgent.skills" 
                :key="skill.name"
                class="bg-gradient-to-r from-primary-500/10 to-secondary-500/10 rounded-lg p-3 border border-primary-500/20 hover:border-primary-500/40 transition-colors"
              >
                <div class="flex items-center space-x-3">
                  <span class="text-lg">⚡</span>
                  <div>
                    <div class="text-white font-medium">{{ skill.name }}</div>
                    <div class="text-gray-400 text-xs mt-0.5">{{ skill.description }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else-if="selectedAgent.id === 'gatekeeper'" class="border-t border-gray-700 pt-4">
            <h3 class="text-gray-400 text-sm mb-2">角色说明</h3>
            <div class="bg-gradient-to-r from-gray-500/10 to-gray-600/10 rounded-lg p-3 border border-gray-500/20">
              <div class="text-gray-300 text-sm">
                守门人是系统的核心调度角色，负责：
              </div>
              <ul class="mt-2 text-gray-400 text-sm space-y-1">
                <li>• 解析用户请求</li>
                <li>• 路由决策（CRITICAL/BUILD/REVIEW/QUERY/SECURITY）</li>
                <li>• 派发任务给下游 Agent</li>
                <li>• 维护中央状态机</li>
              </ul>
            </div>
          </div>

          <!-- 架构师：显示场景化 Skills -->
          <div v-else-if="selectedAgent.id === 'architect' && selectedAgent.scenarios" class="border-t border-gray-700 pt-4">
            <h3 class="text-gray-400 text-sm mb-2">应用场景与 Skills</h3>
            <div class="space-y-3">
              <div 
                v-for="scenario in selectedAgent.scenarios" 
                :key="scenario.id"
                class="bg-gradient-to-r from-primary-500/10 to-secondary-500/10 rounded-lg p-3 border border-primary-500/20"
              >
                <div class="text-white font-medium mb-2">{{ scenario.name }}</div>
                <div class="flex flex-wrap gap-1.5">
                  <span 
                    v-for="skill in scenario.skills" 
                    :key="skill.name"
                    class="px-2 py-0.5 bg-primary-500/20 rounded text-xs text-primary-300"
                  >
                    {{ skill.name }}
                  </span>
                </div>
                <div class="mt-2 text-gray-400 text-xs">
                  工作流: {{ scenario.skills.map(s => s.name).join(' → ') }}
                </div>
              </div>
            </div>
          </div>

          <!-- 开发者：显示场景化 Skills -->
          <div v-else-if="selectedAgent.id === 'developer' && selectedAgent.scenarios" class="border-t border-gray-700 pt-4">
            <h3 class="text-gray-400 text-sm mb-2">应用场景与 Skills</h3>
            <div class="space-y-3">
              <div 
                v-for="scenario in selectedAgent.scenarios" 
                :key="scenario.id"
                class="bg-gradient-to-r from-blue-500/10 to-cyan-500/10 rounded-lg p-3 border border-blue-500/20"
              >
                <div class="text-white font-medium mb-2">{{ scenario.name }}</div>
                <div class="flex flex-wrap gap-1.5">
                  <span 
                    v-for="skill in scenario.skills" 
                    :key="skill.name"
                    :class="skill.name.includes('必用') ? 'bg-orange-500/30 text-orange-300' : 'bg-blue-500/20 text-blue-300'"
                    class="px-2 py-0.5 rounded text-xs"
                  >
                    {{ skill.name }}
                  </span>
                </div>
                <div class="mt-2 text-gray-400 text-xs">
                  工作流: {{ scenario.skills.map(s => s.name.replace('【', '').replace('】', '').replace('【必要时】', '')).join(' → ') }}
                </div>
              </div>
            </div>
          </div>

          <!-- 开发者：显示场景化 Skills -->
          <div v-else-if="selectedAgent.id === 'ops' && selectedAgent.scenarios" class="border-t border-gray-700 pt-4">
            <h3 class="text-gray-400 text-sm mb-2">应用场景与 Skills</h3>
            <div class="space-y-3">
              <div 
                v-for="scenario in selectedAgent.scenarios" 
                :key="scenario.id"
                class="bg-gradient-to-r from-green-500/10 to-teal-500/10 rounded-lg p-3 border border-green-500/20"
              >
                <div class="text-white font-medium mb-2">{{ scenario.name }}</div>
                <div class="flex flex-wrap gap-1.5">
                  <span 
                    v-for="skill in scenario.skills" 
                    :key="skill.name"
                    :class="skill.name.includes('已安装') ? 'bg-green-500/30 text-green-300' : 'bg-green-500/20 text-green-300'"
                    class="px-2 py-0.5 rounded text-xs"
                  >
                    {{ skill.name }}
                  </span>
                </div>
                <div class="mt-2 text-gray-400 text-xs">
                  工作流: {{ scenario.skills.map(s => s.name).join(' → ') }}
                </div>
              </div>
            </div>
          </div>

          <div v-if="selectedAgent.id !== 'gatekeeper' && selectedAgent.id !== 'architect' && selectedAgent.id !== 'developer' && selectedAgent.id !== 'ops'" class="border-t border-gray-700 pt-4">
            <h3 class="text-gray-400 text-sm mb-2">AI 模型</h3>
            <div class="flex items-center space-x-3">
              <select
                v-model="agentModels[selectedAgent.id]"
                @change="saveModelConfig"
                class="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-primary-500"
              >
                <option value="opencode/big-pickle">🤖 big-pickle (最强模型)</option>
                <option value="opencode/sonnet">🤖 sonnet (均衡)</option>
                <option value="opencode/gpt-5-nano">🤖 gpt-5-nano (快速)</option>
              </select>
              <button
                @click="resetModelConfig(selectedAgent.id)"
                class="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-400 text-sm transition-colors"
                title="重置为默认模型"
              >
                ↩
              </button>
            </div>
            <p class="text-gray-500 text-xs mt-2">切换模型后，新任务将使用选择的模型执行</p>
          </div>
        </div>
      </div>

      <!-- 角色任务 -->
      <div class="bg-gray-800 rounded-lg border border-gray-700">
        <div class="px-6 py-4 border-b border-gray-700">
          <h2 class="text-lg font-medium text-white">当前任务</h2>
        </div>
        <div class="p-6">
          <div v-if="agentTasks.length === 0" class="text-center py-8">
            <div class="text-4xl mb-3">😴</div>
            <p class="text-gray-400">暂无等待中的任务</p>
          </div>
          
          <div v-else class="space-y-3">
            <div 
              v-for="task in agentTasks" 
              :key="task.pipelineId"
              class="bg-gray-900 rounded-lg p-4 border border-gray-700"
            >
              <div class="flex items-center justify-between mb-2">
                <span class="text-white font-medium">{{ task.pipelineId.slice(0, 8) }}</span>
                <span :class="categoryClass(task.category)" class="px-2 py-0.5 rounded text-xs">
                  {{ task.category }}
                </span>
              </div>
              <p class="text-gray-400 text-sm mb-3">{{ task.description }}</p>
              <div class="flex items-center justify-between">
                <span class="text-gray-500 text-xs">
                  {{ task.timestamp }}
                </span>
                <div class="flex gap-2">
                  <button 
                    @click="executeTask(task)"
                    class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                  >
                    执行
                  </button>
                  <button 
                    @click="viewPipeline(task.pipelineId)"
                    class="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
                  >
                    查看
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 角色流水线视图 -->
    <div v-if="selectedAgent" class="bg-gray-800 rounded-lg border border-gray-700">
      <div class="px-6 py-4 border-b border-gray-700">
        <h2 class="text-lg font-medium text-white">角色流水线</h2>
        <p class="text-gray-400 text-sm">该角色参与的所有流水线</p>
      </div>
      <div class="p-6">
        <div v-if="agentPipelines.length === 0" class="text-center py-8">
          <p class="text-gray-400">暂无相关流水线</p>
        </div>
        <div v-else class="space-y-3">
          <div 
            v-for="pipeline in agentPipelines"
            :key="pipeline.id"
            class="bg-gray-900 rounded-lg p-4 border border-gray-700 flex items-center justify-between"
          >
            <div class="flex items-center space-x-4">
              <div :class="statusClass(pipeline.status)" class="w-3 h-3 rounded-full"></div>
              <div>
                <div class="text-white">{{ pipeline.id.slice(0, 8) }}</div>
                <div class="text-gray-400 text-sm">{{ pipeline.category }}</div>
              </div>
            </div>
            <div class="flex items-center space-x-4">
              <div class="text-right">
                <div class="text-gray-300">{{ pipeline.currentStage }}</div>
                <div class="text-gray-500 text-xs">{{ formatTime(pipeline.updatedAt) }}</div>
              </div>
              <button 
                @click="viewPipeline(pipeline.id)"
                class="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
              >
                查看
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { usePipelineStore } from '../stores/pipeline'
import { useProjectStore } from '../stores/project'

const emit = defineEmits(['selectPipeline'])

const store = usePipelineStore()
const projectStore = useProjectStore()
const selectedAgent = ref(null)

const agents = [
  {
    id: 'gatekeeper',
    name: '守门人',
    role: 'Gatekeeper',
    icon: '🚪',
    description: '路由决策，维护中央状态机，解析请求，派发任务给下游 Agent',
    triggers: ['用户发起请求'],
    tools: ['文件读取', '文件写入', '状态管理'],
    route: ['gatekeeper'],
    skills: []
  },
  {
    id: 'ba',
    name: 'BA',
    role: 'Business Analyst',
    icon: '📊',
    description: '业务分析，需求梳理，流程优化建议',
    triggers: ['用户发起请求'],
    tools: ['文件写入', '需求分析'],
    route: ['ba'],
    skills: [
      { name: 'brainstorming', description: '业务分析、需求梳理、流程优化' }
    ]
  },
  {
    id: 'product',
    name: '产品',
    role: 'Product Manager',
    icon: '📋',
    description: '产品规划，功能定义，用户体验设计，生成 PRD 和用户故事',
    triggers: ['BA完成后', '新产品立项', '原型设计', '体验优化'],
    tools: ['文件写入', 'PRD编写', '用户故事'],
    route: ['product'],
    skills: [
      { name: 'user-story', description: '用户故事拆分（As a... I want... So that...）' },
      { name: 'product-spec-kit', description: '产品规格文档生成' },
      { name: 'ui-ux-designer', description: '界面布局建议、交互流程设计' },
      { name: 'tailwind-design-system', description: '设计系统构建、组件规范' },
      { name: 'user-journeys', description: '用户旅程映射、体验优化' },
      { name: 'brainstorming', description: '产品思维、需求深化' }
    ]
  },
  {
    id: 'architect',
    name: '架构师',
    role: 'Architect',
    icon: '🏗️',
    description: '系统设计，生成 OpenSpec 文档，API 定义，数据模型设计',
    triggers: ['产品完成后'],
    tools: ['文件写入', '代码搜索', 'OpenSpec生成'],
    route: ['architect'],
    scenarios: [
      {
        id: 'new-system',
        name: '新系统架构设计',
        skills: [
          { name: 'OpenSpec', description: '生成架构设计文档' },
          { name: 'system-design', description: '系统架构设计原则、组件划分' },
          { name: 'database-design', description: '数据库设计、数据模型构建' },
          { name: 'document', description: '架构文档编写与规范' }
        ]
      },
      {
        id: 'optimize',
        name: '现有系统架构优化',
        skills: [
          { name: 'explain', description: '现有系统分析理解' },
          { name: 'tech-debt-analyzer', description: '技术债务识别与分析' },
          { name: 'architecture-review', description: '架构评审、问题诊断' },
          { name: 'refactor', description: '重构方案设计' }
        ]
      },
      {
        id: 'high-concurrency',
        name: '高并发场景架构改造',
        skills: [
          { name: 'optimize', description: '性能优化分析' },
          { name: 'event-driven', description: '事件驱动架构设计' },
          { name: 'api-design', description: '高并发 API 设计原则' }
        ]
      }
    ]
  },
  {
    id: 'tech_coach',
    name: '开发教练',
    role: 'Tech Coach',
    icon: '🔍',
    description: '技术可行性验证，探索代码库，识别风险和机会，基于 OpenSpec 进行分析',
    triggers: ['BUILD模式'],
    tools: ['代码搜索', '文件探索', '依赖分析', 'OpenSpec验证'],
    route: ['tech_coach'],
    skills: [
      { name: 'OpenSpec验证', description: '验证 OpenSpec 可行性，分析技术边界和依赖' },
      { name: '代码探索', description: '探索现有代码库结构，分析相似实现' },
      { name: '风险识别', description: '识别技术风险、依赖问题、性能瓶颈' }
    ]
  },
  {
    id: 'developer',
    name: '开发者',
    role: 'Developer',
    icon: '💻',
    description: '源代码产出，测试代码编写，Git 操作，PR 创建',
    triggers: ['架构设计后'],
    tools: ['文件编辑', '文件写入', 'Git', 'Shell'],
    route: ['developer'],
    scenarios: [
      {
        id: 'daily-dev',
        name: '日常功能开发',
        skills: [
          { name: 'code', description: '代码编写' },
          { name: 'TDD(含refactor)', description: '测试驱动开发，含重构环节' },
          { name: 'document', description: '文档编写' },
          { name: 'api-design', description: '【接口必用】RESTful API 设计' }
        ]
      },
      {
        id: 'bug-fix',
        name: '复杂 bug 排查',
        skills: [
          { name: 'systematic-debugging', description: '系统调试、根因分析' },
          { name: 'log-analyzer', description: '日志分析（替代 bug-hunter）' },
          { name: 'code', description: '代码修复' }
        ]
      },
      {
        id: 'specialized-dev',
        name: '技术栈专项开发',
        skills: [
          { name: '原生脚手架', description: 'vue-cli/create-react-app 等（替代 frontend-builder）' },
          { name: 'unit-test-generator', description: '单元测试生成' },
          { name: 'dependency-checker', description: '依赖检查（npm audit）' },
          { name: 'api-design', description: '【接口必用】RESTful API 设计' },
          { name: 'event-driven', description: '【必要时】事件驱动架构' }
        ]
      }
    ]
  },
  {
    id: 'tester',
    name: 'QA',
    role: 'QA Engineer',
    icon: '🧪',
    description: '集成测试，bug 报告生成，测试覆盖率分析，性能测试',
    triggers: ['开发完成后'],
    tools: ['gstack/browse', 'gstack/qa', 'gstack/canary', 'gstack/benchmark'],
    route: ['tester'],
    skills: [
      { name: 'gstack/qa', description: '完整 QA 测试循环（测试→修复→验证）' },
      { name: 'gstack/browse', description: '页面交互测试（导航、表单、按钮验证）' },
      { name: 'gstack/canary', description: '部署后健康检查' },
      { name: 'gstack/benchmark', description: '性能回归测试（LCP、FID、CLS）' }
    ]
  },
  {
    id: 'ops',
    name: '运维',
    role: 'DevOps',
    icon: '⚙️',
    description: '基础设施配置，部署脚本，CI/CD 流水线，多云平台支持',
    triggers: ['QA通过后', 'BUILD模式'],
    tools: ['Docker', 'Shell', 'CI配置', '部署脚本', 'Kubernetes'],
    route: ['ops'],
    scenarios: [
      {
        id: 'container',
        name: '容器化部署',
        skills: [
          { name: 'docker-helper', description: 'Docker 镜像构建和优化' },
          { name: 'kubernetes', description: 'K8s 部署配置（kubectl/helm）' },
          { name: 'prometheus', description: 'Prometheus 监控配置' },
          { name: 'incident-response', description: '事件响应手册' }
        ]
      },
      {
        id: 'multi-cloud',
        name: '多云部署',
        skills: [
          { name: 'azure-deploy', description: 'Azure 部署（已安装）' },
          { name: 'AWS', description: 'AWS CloudFormation' },
          { name: '阿里云', description: '阿里云 ROS 模板' },
          { name: '聚石塔', description: '阿里巴巴电商云' },
          { name: '抖音云', description: '抖音云部署' },
          { name: '火山云', description: '火山引擎云' },
          { name: '京东云', description: '京东云部署' }
        ]
      },
      {
        id: 'daily-ops',
        name: '日常运维',
        skills: [
          { name: 'ship', description: '部署配置、Docker Compose' },
          { name: 'ci-cd', description: 'CI/CD 流水线配置' }
        ]
      }
    ]
  },
  {
    id: 'ghost',
    name: '幽灵',
    role: 'Security Ghost',
    icon: '👻',
    description: '安全审计，日志分析，识别潜在风险（只读，不修改）',
    triggers: ['REVIEW模式', 'SECURITY模式'],
    tools: ['日志分析', '安全扫描', '合规检查'],
    route: ['ghost'],
    skills: [
      { name: 'cso', description: '安全审计、敏感信息扫描、OWASP 检查' }
    ]
  },
  {
    id: 'creative',
    name: '创意',
    role: 'Creative Director',
    icon: '🎨',
    description: 'UI/UX 评审，设计一致性检查，体验优化建议',
    triggers: ['REVIEW模式', 'CRITICAL模式'],
    tools: ['截图', '设计评审', '用户体验分析'],
    route: ['creative'],
    skills: [
      { name: 'design-review', description: 'UI/UX 评审、设计一致性、视觉审计' }
    ]
  },
  {
    id: 'evolver',
    name: '进化顾问',
    role: 'Evolver',
    icon: '🔮',
    description: '代码重构，技术债务清理，性能优化，未来规划建议',
    triggers: ['任务完成后', '需要优化时'],
    tools: ['重构', '性能分析', '代码审查'],
    route: ['evolver'],
    skills: [
      { name: 'retro', description: '代码重构、技术债务清理、性能优化' },
      { name: 'tech-debt', description: '技术债务识别与分析（已安装）' }
    ]
  }
]

// 默认模型配置
const DEFAULT_MODELS = {
  ba: 'opencode/big-pickle',
  product: 'opencode/big-pickle',
  architect: 'opencode/big-pickle',
  developer: 'opencode/big-pickle',
  tester: 'opencode/big-pickle',
  ops: 'opencode/gpt-5-nano',
  evolver: 'opencode/gpt-5-nano',
  ghost: 'opencode/big-pickle',
  creative: 'opencode/big-pickle'
}

// 从 LocalStorage 加载模型配置
function loadModelConfig() {
  try {
    const saved = localStorage.getItem('agent-models')
    return saved ? JSON.parse(saved) : { ...DEFAULT_MODELS }
  } catch {
    return { ...DEFAULT_MODELS }
  }
}

// 模型配置
const agentModels = ref(loadModelConfig())

// 获取角色使用的模型
function getAgentModel(agentId) {
  return agentModels.value[agentId] || DEFAULT_MODELS[agentId]
}

// 保存模型配置到 LocalStorage 和后端
async function saveModelConfig() {
  try {
    // 保存到 LocalStorage
    localStorage.setItem('agent-models', JSON.stringify(agentModels.value))
    // 保存到后端
    await projectStore.saveModelConfig(agentModels.value)
  } catch (e) {
    console.error('保存模型配置失败:', e)
  }
}

// 重置单个角色的模型为默认
async function resetModelConfig(agentId) {
  agentModels.value[agentId] = DEFAULT_MODELS[agentId]
  await saveModelConfig()
}

// 初始化时从后端加载模型配置
onMounted(async () => {
  const serverConfig = await projectStore.fetchModelConfig()
  if (serverConfig) {
    agentModels.value = serverConfig
    localStorage.setItem('agent-models', JSON.stringify(serverConfig))
  }
})

const agentTasks = computed(() => {
  if (!selectedAgent.value) return []
  
  return store.pipelines
    .filter(p => p.currentStage === selectedAgent.value.id)
    .map(p => ({
      pipelineId: p.id,
      category: p.category,
      description: p.rawInput,
      timestamp: formatTime(p.createdAt),
      status: p.status
    }))
})

const agentPipelines = computed(() => {
  if (!selectedAgent.value) return []
  
  const agentId = selectedAgent.value.id
  return store.pipelines
    .filter(p => p.stages.some(s => s.role === agentId))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
})

function selectAgent(agent) {
  selectedAgent.value = agent
}

function executeTask(task) {
  emit('selectPipeline', task.pipelineId)
}

function viewPipeline(id) {
  emit('selectPipeline', id)
}

function agentStatusClass(agent) {
  const tasks = store.pipelines.filter(p => p.currentStage === agent.id)
  if (tasks.length > 0) {
    return 'bg-blue-500/20 text-blue-400'
  }
  return 'bg-gray-500/20 text-gray-400'
}

function agentStatusText(agent) {
  const tasks = store.pipelines.filter(p => p.currentStage === agent.id)
  if (tasks.length > 0) {
    return `忙碌 (${tasks.length})`
  }
  return '空闲'
}

function statusClass(status) {
  const classes = {
    pending: 'bg-gray-500',
    running: 'bg-blue-500',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
    stopped: 'bg-yellow-500'
  }
  return classes[status] || 'bg-gray-500'
}

function categoryClass(category) {
  const classes = {
    BUILD: 'bg-purple-500/20 text-purple-400',
    REVIEW: 'bg-green-500/20 text-green-400',
    QUERY: 'bg-blue-500/20 text-blue-400',
    SECURITY: 'bg-red-500/20 text-red-400',
    CRITICAL: 'bg-orange-500/20 text-orange-400'
  }
  return classes[category] || 'bg-gray-500/20 text-gray-400'
}

function formatTime(isoString) {
  if (!isoString) return '-'
  const date = new Date(isoString)
  const now = new Date()
  const diff = now - date
  
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  return date.toLocaleDateString('zh-CN')
}

onMounted(() => {
  store.fetchPipelines()
})
</script>
