<template>
  <div class="space-y-6">
    <!-- 角色切换器 -->
    <div class="bg-gray-800 rounded-lg border border-gray-700">
      <div class="px-6 py-4 border-b border-gray-700">
        <h2 class="text-lg font-medium text-white">角色切换</h2>
        <p class="text-gray-400 text-sm mt-1">选择要扮演的角色，查看该角色的任务和状态</p>
      </div>
      <div class="p-6">
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <button
            v-for="agent in agents"
            :key="agent.id"
            @click="selectAgent(agent)"
            class="p-4 rounded-lg border-2 transition-all text-center"
            :class="selectedAgent?.id === agent.id 
              ? 'border-primary-500 bg-primary-500/10' 
              : 'border-gray-700 hover:border-gray-600 bg-gray-900'"
          >
            <div class="text-3xl mb-2">{{ agent.icon }}</div>
            <div class="text-white font-medium">{{ agent.name }}</div>
            <div class="text-gray-400 text-xs mt-1">{{ agent.role }}</div>
            <div class="mt-2">
              <span 
                class="px-2 py-0.5 rounded text-xs"
                :class="agentStatusClass(agent)"
              >
                {{ agentStatusText(agent) }}
              </span>
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

const emit = defineEmits(['selectPipeline'])

const store = usePipelineStore()
const selectedAgent = ref(null)

const agents = [
  {
    id: 'receptionist',
    name: '前台',
    role: 'Receptionist',
    icon: '👋',
    description: '接收用户需求，进行分类和格式化处理',
    triggers: ['用户请求入口'],
    tools: ['状态写入', 'HTTP客户端'],
    route: ['pending']
  },
  {
    id: 'gatekeeper',
    name: '守门人',
    role: 'Gatekeeper',
    icon: '🛡️',
    description: '中央状态机维护者，负责路由决策和流程控制',
    triggers: ['始终参与'],
    tools: ['状态读写', '决策逻辑'],
    route: ['*']
  },
  {
    id: 'architect',
    name: '架构师',
    role: 'Architect',
    icon: '🏗️',
    description: '系统设计，生成 OpenSpec 文档',
    triggers: ['BUILD', 'CRITICAL'],
    tools: ['文件写入', '代码搜索'],
    route: ['architect']
  },
  {
    id: 'scout',
    name: '侦察兵',
    role: 'Scout',
    icon: '🔍',
    description: '代码探索，可行性验证，依赖分析',
    triggers: ['BUILD', 'QUERY'],
    tools: ['代码搜索', '依赖分析'],
    route: ['scout']
  },
  {
    id: 'developer',
    name: '开发',
    role: 'Developer',
    icon: '💻',
    description: '源代码产出，测试代码编写，Git 操作',
    triggers: ['BUILD', 'CRITICAL'],
    tools: ['文件编辑', 'Git', 'Shell'],
    route: ['developer']
  },
  {
    id: 'tester',
    name: '测试',
    role: 'Tester',
    icon: '🧪',
    description: 'gstack 集成测试，报告生成',
    triggers: ['开发后'],
    tools: ['gstack', '/browse', '/qa', '/canary'],
    route: ['tester']
  },
  {
    id: 'ops',
    name: '运维',
    role: 'Ops',
    icon: '🚀',
    description: '基础设施，部署配置，CI/CD',
    triggers: ['BUILD后续'],
    tools: ['Docker', 'Shell', 'CI配置'],
    route: ['ops']
  },
  {
    id: 'ghost',
    name: '幽灵',
    role: 'Ghost',
    icon: '👻',
    description: '静默监控，日志审计，安全扫描',
    triggers: ['REVIEW', 'SECURITY'],
    tools: ['日志分析', '安全扫描'],
    route: ['ghost']
  },
  {
    id: 'creative',
    name: '创意',
    role: 'Creative',
    icon: '🎨',
    description: '方案评审，体验优化，设计检查',
    triggers: ['REVIEW', 'CRITICAL'],
    tools: ['截图', '设计评审'],
    route: ['creative']
  },
  {
    id: 'evolver',
    name: '进化',
    role: 'Evolver',
    icon: '🔄',
    description: '重构优化，技术债务清理，性能调优',
    triggers: ['BUILD后续'],
    tools: ['重构', '性能分析', '测试优化'],
    route: ['evolver']
  }
]

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
