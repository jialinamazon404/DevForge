<template>
  <div v-if="sprint" class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <button @click="$emit('back')" class="text-gray-400 hover:text-white transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <div class="flex items-center space-x-3">
            <h1 class="text-xl font-semibold text-white">{{ sprint.name }}</h1>
            <span :class="sprintStatusClass(sprint.status)" class="px-2 py-0.5 rounded text-xs">
              {{ sprintStatusText(sprint.status) }}
            </span>
          </div>
          <p class="text-gray-400 text-sm mt-1">{{ sprint.goal || sprint.rawInput }}</p>
        </div>
      </div>
      <div class="flex items-center space-x-3">
        <button
          v-if="sprint.status === 'pending'"
          @click="startSprint"
          class="px-4 py-2 bg-gradient-to-r from-vue-primary to-vue-secondary text-white rounded-vue text-sm font-medium transition-all hover:shadow-vue-glow"
        >
          开始冲刺 ▶
        </button>
        <button
          v-if="sprint.status === 'running'"
          @click="showCancelConfirm = true"
          class="px-4 py-2 bg-red-600/20 border border-red-600/50 text-red-400 hover:bg-red-600/30 rounded-vue text-sm transition-all"
        >
          取消冲刺
        </button>
      </div>
    </div>

    <!-- 角色流程 -->
    <div class="card-vue p-6">
      <h2 class="text-lg font-medium text-white mb-6">执行流程</h2>
      
      <div class="flex items-center justify-between overflow-x-auto pb-4">
        <div 
          v-for="(iteration, index) in sprint.iterations" 
          :key="iteration.role"
          class="flex items-center"
        >
          <!-- Stage Card -->
          <div 
            class="flex flex-col items-center px-4 py-3 rounded-vue min-w-[120px] cursor-pointer transition-all hover:scale-105"
            :class="getIterationClass(index, iteration)"
            @click="selectIteration(index)"
          >
            <div class="w-10 h-10 rounded-full flex items-center justify-center mb-2"
                 :class="getIterationIconBg(index, iteration)"
            >
              <span v-if="iteration.status === 'confirmed'" class="text-white">✓</span>
              <span v-else-if="iteration.status === 'completed'" class="text-white">✓</span>
              <span v-else-if="iteration.status === 'running' || iteration.status === 'waiting_input'" class="w-3 h-3 bg-white rounded-full animate-pulse"></span>
              <span v-else class="text-lg">{{ iteration.roleInfo?.icon || '🤖' }}</span>
            </div>
            <span class="text-sm font-medium text-white">{{ iteration.roleInfo?.name || iteration.role }}</span>
            <span class="text-xs mt-1" :class="getIterationStatusTextClass(iteration.status)">
              {{ getIterationStatusText(iteration.status) }}
            </span>
          </div>
          
          <!-- Arrow -->
          <div v-if="index < sprint.iterations.length - 1" class="mx-2">
            <svg class="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- 当前角色详情 -->
    <div v-if="selectedIterationIndex !== null" class="card-vue">
      <div class="px-6 py-4 border-b border-vue-border flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <span class="text-2xl">{{ currentIteration?.roleInfo?.icon || '🤖' }}</span>
          <div>
            <h2 class="text-lg font-medium text-white">{{ currentIteration?.roleInfo?.name || '-' }}</h2>
            <p class="text-gray-400 text-sm">{{ getIterationStatusText(currentIteration?.status) }}</p>
          </div>
        </div>
        <button @click="selectedIterationIndex = null" class="text-gray-400 hover:text-white">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="p-6 space-y-6">
        <!-- 用户输入 -->
        <div class="bg-vue-darker rounded-vue p-4">
          <h3 class="text-gray-400 text-sm mb-2">用户输入</h3>
          
          <!-- Product 角色：直接显示冲刺需求 -->
          <div v-if="isProductRole && sprint?.rawInput" class="space-y-3">
            <div class="text-white bg-vue-card rounded-vue p-3">
              {{ sprint.rawInput }}
            </div>
            <div class="flex justify-end">
              <button
                @click="submitUserInput"
                :disabled="!canAutoExecute"
                class="px-4 py-2 bg-gradient-to-r from-vue-primary to-vue-secondary disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-vue text-sm font-medium transition-all hover:shadow-vue-glow"
              >
                确认需求并执行 ✓
              </button>
            </div>
          </div>
          
          <!-- 其他角色：用户输入 -->
          <div v-else-if="canInput" class="space-y-3">
            <textarea
              v-model="userInput"
              rows="4"
              class="w-full bg-vue-darker border border-vue-border rounded-vue px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-vue-primary"
              :placeholder="getInputPlaceholder()"
            ></textarea>
            <div class="flex justify-between">
              <div class="flex items-center space-x-2">
                <input 
                  type="checkbox" 
                  v-model="confirmModify" 
                  id="confirmModify"
                  class="w-4 h-4 rounded bg-vue-darker border-vue-border"
                />
                <label for="confirmModify" class="text-yellow-400 text-sm">
                  确认修改需求（低效行为）
                </label>
              </div>
              <button
                @click="submitUserInput"
                :disabled="!userInput.trim()"
                class="px-4 py-2 bg-gradient-to-r from-vue-primary to-vue-secondary disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-vue text-sm font-medium transition-all hover:shadow-vue-glow"
              >
                确认输入 ✓
              </button>
            </div>
          </div>
          
          <div v-else-if="currentIteration?.userInput" class="text-white">
            {{ currentIteration.userInput }}
          </div>
          <div v-else class="text-gray-500 italic">
            等待用户输入...
          </div>
        </div>

        <!-- Agent 输出 -->
        <div class="bg-vue-darker rounded-vue p-4">
          <h3 class="text-gray-400 text-sm mb-2">Agent 输出</h3>
          <div class="text-xs text-gray-500 mb-2">
            状态: {{ currentIteration?.status }}
          </div>
          
          <!-- Tester 角色：显示摘要 -->
          <div v-if="currentIteration?.role === 'tester' && testerSummary" class="space-y-3">
            <div v-if="testerSummary.type === 'environment'" class="bg-yellow-900/30 border border-yellow-700 rounded-vue p-4">
              <div class="flex items-center space-x-2 text-yellow-400">
                <span class="text-xl">⚠️</span>
                <span class="font-medium">{{ testerSummary.message }}</span>
              </div>
            </div>
            <div v-else-if="testerSummary.type === 'bugs'" class="bg-red-900/30 border border-red-700 rounded-vue p-4">
              <div class="flex items-center space-x-2 text-red-400">
                <span class="text-xl">🐛</span>
                <span class="font-medium">发现 {{ testerSummary.count }} 个 Bug</span>
              </div>
            </div>
            <div v-else-if="testerSummary.type === 'issues'" class="bg-orange-900/30 border border-orange-700 rounded-vue p-4">
              <div class="flex items-center space-x-2 text-orange-400">
                <span class="text-xl">⚠️</span>
                <span class="font-medium">{{ testerSummary.message }}</span>
              </div>
            </div>
            <div v-else class="bg-green-900/30 border border-green-700 rounded-vue p-4">
              <div class="flex items-center space-x-2 text-green-400">
                <span class="text-xl">✅</span>
                <span class="font-medium">{{ testerSummary.message }}</span>
              </div>
            </div>
            <div class="text-gray-400 text-sm">
              完整报告保存在 workspace 中
            </div>
          </div>
          
          <!-- 其他角色：显示完整输出 -->
          <div v-else-if="currentIteration?.output || currentIteration?.status === 'running'" class="space-y-4">
            <pre class="text-gray-300 text-sm whitespace-pre-wrap overflow-auto max-h-96">{{ currentIteration.output }}</pre>
            
            <!-- 确认/重新执行按钮 -->
            <div v-if="canConfirm" class="flex justify-end space-x-3 pt-4 border-t border-vue-border">
              <button
                @click="rerunIteration"
                class="px-4 py-2 bg-yellow-600/20 border border-yellow-600/50 text-yellow-400 hover:bg-yellow-600/30 rounded-vue text-sm transition-all"
              >
                重新执行 🔄
              </button>
              <button
                @click="confirmOutput"
                class="px-4 py-2 bg-gradient-to-r from-vue-primary to-vue-secondary text-white rounded-vue text-sm font-medium transition-all hover:shadow-vue-glow"
              >
                确认输出 ✓
              </button>
            </div>
            <div v-else-if="currentIteration?.status === 'running'" class="text-center py-4">
              <div class="animate-spin w-8 h-8 border-2 border-vue-primary border-t-transparent rounded-full mx-auto mb-2"></div>
              <p class="text-gray-400">Agent 正在执行...</p>
            </div>
          </div>
          <div v-else-if="currentIteration?.status === 'running'" class="text-center py-4">
            <div class="animate-spin w-8 h-8 border-2 border-vue-primary border-t-transparent rounded-full mx-auto mb-2"></div>
            <p class="text-gray-400">Agent 正在执行...</p>
          </div>
          <div v-else class="text-gray-500 italic">
            等待执行...
          </div>
        </div>

        <!-- 历史记录 -->
        <div v-if="currentIteration?.history?.length > 0" class="bg-vue-darker rounded-vue p-4">
          <h3 class="text-gray-400 text-sm mb-2">执行历史</h3>
          <div class="space-y-3">
            <div 
              v-for="(historyItem, idx) in currentIteration.history" 
              :key="idx"
              class="border-l-2 border-vue-border pl-3 py-2"
            >
              <div class="text-xs text-gray-500 mb-1">{{ formatDate(historyItem.timestamp) }}</div>
              <div class="text-gray-400 text-sm">{{ historyItem.input?.slice(0, 100) }}...</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 本地项目参考 -->
    <div v-if="sprint.localProjectPath" class="card-vue p-6">
      <h2 class="text-lg font-medium text-white mb-4">📂 本地项目参考</h2>
      <div class="text-gray-400 text-sm">
        路径: <code class="text-vue-primary">{{ sprint.localProjectPath }}</code>
      </div>
    </div>

    <!-- 取消确认弹窗 -->
    <div v-if="showCancelConfirm" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="showCancelConfirm = false"></div>
      <div class="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-red-500">
        <div class="p-6 text-center">
          <div class="text-4xl mb-4">⚠️</div>
          <h3 class="text-xl font-semibold text-white mb-2">确认取消冲刺？</h3>
          <p class="text-gray-400 mb-6">取消后无法恢复，请确认。</p>
          <div class="flex justify-center space-x-4">
            <button
              @click="showCancelConfirm = false"
              class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
            >
              取消
            </button>
            <button
              @click="cancelSprint"
              class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
            >
              确认取消
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="text-center py-20">
    <div class="animate-spin w-8 h-8 border-2 border-vue-primary border-t-transparent rounded-full mx-auto mb-4"></div>
    <p class="text-gray-400">加载中...</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, onUnmounted } from 'vue'
import { useProjectStore } from '../stores/project'

const props = defineProps({
  sprintId: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['back'])

const store = useProjectStore()

const sprint = computed(() => store.currentSprint)
const selectedIterationIndex = ref(null)
const userInput = ref('')
const confirmModify = ref(false)
const showCancelConfirm = ref(false)

const currentIteration = computed(() => {
  if (selectedIterationIndex.value === null) return null
  return sprint.value?.iterations[selectedIterationIndex.value]
})

const canInput = computed(() => {
  const iter = currentIteration.value
  if (!iter) return false
  return ['waiting_input', 'ready', 'pending'].includes(iter.status)
})

// 当前 iteration 是否可以确认（必须在完成状态且有输出）
const canConfirm = computed(() => {
  const iter = currentIteration.value
  if (!iter) return false
  return iter.status === 'completed' && iter.output && iter.output.trim().length > 0
})

// Product 角色特殊处理：不需要额外输入，直接使用冲刺需求
const isProductRole = computed(() => currentIteration.value?.role === 'product')

// Tester 输出摘要（解析 bug 数量或环境问题）
const testerSummary = computed(() => {
  if (currentIteration.value?.role !== 'tester') return null
  const output = currentIteration.value?.output || ''
  
  // 检查是否有环境问题
  if (output.includes('环境') || output.includes('缺少环境') || output.includes('无法启动')) {
    return { type: 'environment', message: '环境问题无法进行代码审查' }
  }
  
  // 尝试提取 bug 数量
  const bugMatch = output.match(/(\d+)\s*个\s*(bug|问题|缺陷)/i)
  if (bugMatch) {
    return { type: 'bugs', count: parseInt(bugMatch[1]) }
  }
  
  // 检查是否有失败/错误
  if (output.includes('失败') || output.includes('error') || output.includes('Error')) {
    return { type: 'issues', message: '存在测试问题，请查看完整报告' }
  }
  
  return { type: 'success', message: '测试通过或无明显问题' }
})

// 第一个角色可以自动执行（不需要用户输入）
const canAutoExecute = computed(() => {
  const iter = currentIteration.value
  if (!iter) return false
  // Product 角色：状态为 waiting_input 或 ready 时可以直接确认输入
  if (iter.role === 'product' && ['waiting_input', 'ready', 'pending'].includes(iter.status)) {
    return true
  }
  // 其他角色：状态为 waiting_input/ready/pending 且有用户输入时可以执行
  return ['waiting_input', 'ready', 'pending'].includes(iter.status) && 
         iter.userInput && iter.userInput.trim().length > 0
})

onMounted(() => {
  store.fetchSprint(props.sprintId)
  
  // 确保 socket 连接
  store.connect()
  
  // 设置 WebSocket 监听
  if (store.socket) {
    setupSocketListeners()
  } else {
    // socket 未就绪，等待连接后设置
    store.socket?.on('connect', () => {
      setupSocketListeners()
    })
  }
})

function setupSocketListeners() {
  if (!store.socket) return
  
  store.socket.on('iteration:output:updated', ({ sprintId }) => {
    if (sprintId === props.sprintId) {
      store.fetchSprint(props.sprintId)
    }
  })
  store.socket.on('iteration:confirmed', ({ sprintId }) => {
    if (sprintId === props.sprintId) store.fetchSprint(props.sprintId)
  })
  store.socket.on('iteration:execution:started', ({ sprintId }) => {
    if (sprintId === props.sprintId) store.fetchSprint(props.sprintId)
  })
  store.socket.on('sprint:updated', (data) => {
    if (data.id === props.sprintId) store.fetchSprint(props.sprintId)
  })
  store.socket.on('agent:output', ({ sprintId }) => {
    if (sprintId === props.sprintId) store.fetchSprint(props.sprintId)
  })
}

watch(() => props.sprintId, (newId) => {
  store.fetchSprint(newId)
})

// 监听当前 iteration 状态变化，自动刷新
let pollTimer = null
watch(() => currentIteration.value?.status, (newStatus, oldStatus) => {
  if (newStatus === 'running' && oldStatus !== 'running') {
    pollTimer = setInterval(async () => {
      await store.fetchSprint(props.sprintId)
      const iter = currentIteration.value
      if (iter?.output || iter?.status === 'completed' || iter?.status === 'confirmed' || iter?.status === 'failed') {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }, 1500)
  }
  if (newStatus !== 'running' && pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})

// 组件卸载时清理
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

function selectIteration(index) {
  selectedIterationIndex.value = index
  const iter = sprint.value?.iterations[index]
  userInput.value = iter?.userInput || ''
  confirmModify.value = false
}

function getInputPlaceholder() {
  const role = currentIteration.value?.role
  const placeholders = {
    product: '这是冲刺的原始需求，确认后 Agent 将生成 PRD',
    architect: '输入对架构的特殊要求，例如：需要支持高并发...',
    scout: '输入需要特别关注的可行性点...',
    developer: '输入对开发的特殊要求...',
    tester: '输入对测试的特殊要求...',
    ops: '输入对部署的特殊要求...',
    evolver: '输入优化建议...'
  }
  return placeholders[role] || '输入你的需求或反馈...'
}

async function submitUserInput() {
  // Product 角色：使用冲刺需求作为输入
  const input = isProductRole.value ? (sprint.value?.rawInput || '') : userInput.value
  
  if (!input.trim()) return
  if (!confirmModify.value && currentIteration.value?.userInput && !isProductRole.value) {
    if (!confirm('已有输入，确定要覆盖吗？')) return
  }
  
  await store.inputIteration(props.sprintId, selectedIterationIndex.value, input)
  await store.fetchSprint(props.sprintId)
  
  await store.executeIteration(props.sprintId, selectedIterationIndex.value)
}

async function confirmOutput() {
  const currentIndex = selectedIterationIndex.value
  
  try {
    const result = await store.confirmIteration(props.sprintId, currentIndex)
    if (!result) {
      alert('确认失败，请重试')
      return
    }
    await store.fetchSprint(props.sprintId)
    
    // 自动选择下一个角色
    const nextIndex = currentIndex + 1
    if (nextIndex < sprint.value?.iterations.length) {
      selectedIterationIndex.value = nextIndex
      
      const prevOutput = sprint.value?.iterations[currentIndex]?.output || ''
      userInput.value = prevOutput
    }
  } catch (e) {
    console.error('确认输出失败:', e)
    alert('确认失败: ' + e.message)
  }
}

async function rerunIteration() {
  await store.rerunIteration(props.sprintId, selectedIterationIndex.value)
  // 触发 Agent 重新执行
  await store.executeIteration(props.sprintId, selectedIterationIndex.value)
  // 刷新数据
  await store.fetchSprint(props.sprintId)
}

async function startSprint() {
  await store.startSprint(props.sprintId)
  // 刷新数据
  await store.fetchSprint(props.sprintId)
  // 第一个角色设置为等待输入
  selectedIterationIndex.value = 0
}

async function cancelSprint() {
  await store.updateSprint(props.sprintId, { status: 'cancelled' })
  showCancelConfirm.value = false
  emit('back')
}

function getIterationClass(index, iteration) {
  if (index === sprint.value?.currentRoleIndex && sprint.value?.status === 'running') {
    return 'bg-vue-primary/20 border-2 border-vue-primary'
  }
  if (iteration.status === 'confirmed' || iteration.status === 'completed') {
    return 'bg-vue-primary/10 border border-vue-primary/50'
  }
  if (iteration.status === 'failed') {
    return 'bg-red-500/10 border border-red-500/50'
  }
  return 'bg-vue-card border border-vue-border hover:border-vue-primary/50'
}

function getIterationIconBg(index, iteration) {
  if (iteration.status === 'confirmed' || iteration.status === 'completed') {
    return 'bg-vue-primary'
  }
  if (iteration.status === 'running' || iteration.status === 'waiting_input') {
    return 'bg-blue-500'
  }
  if (iteration.status === 'failed') {
    return 'bg-red-500'
  }
  return 'bg-gray-600'
}

function getIterationStatusTextClass(status) {
  const classes = {
    pending: 'text-gray-500',
    waiting_input: 'text-yellow-400',
    ready: 'text-yellow-400',
    running: 'text-blue-400',
    completed: 'text-green-400',
    confirmed: 'text-green-400',
    failed: 'text-red-400'
  }
  return classes[status] || 'text-gray-500'
}

function getIterationStatusText(status) {
  const texts = {
    pending: '待开始',
    waiting_input: '等待输入',
    ready: '准备执行',
    running: '执行中',
    completed: '已完成',
    confirmed: '已确认',
    failed: '失败'
  }
  return texts[status] || status
}

function sprintStatusClass(status) {
  const classes = {
    pending: 'bg-gray-500/20 text-gray-400',
    running: 'bg-yellow-500/20 text-yellow-400',
    completed: 'bg-green-500/20 text-green-400',
    cancelled: 'bg-red-500/20 text-red-400'
  }
  return classes[status] || classes.pending
}

function sprintStatusText(status) {
  const texts = {
    pending: '待开始',
    running: '进行中',
    completed: '已完成',
    cancelled: '已取消'
  }
  return texts[status] || status
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}
</script>