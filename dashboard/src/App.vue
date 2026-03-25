<template>
  <!-- 登录页面 -->
  <Login v-if="!isLoggedIn" @login="handleLogin" />
  
  <!-- 主界面 -->
  <div v-else class="min-h-screen bg-gray-900">
    <!-- Header -->
    <header class="bg-gray-800 border-b border-gray-700">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <div class="flex items-center space-x-4">
            <div class="flex items-center space-x-2">
              <div class="w-8 h-8 bg-gradient-to-br from-primary-400 to-primary-600 rounded-lg flex items-center justify-center">
                <span class="text-white font-bold text-sm">AI</span>
              </div>
              <h1 class="text-xl font-semibold text-white">Team Pipeline</h1>
            </div>
            <nav class="flex space-x-4 ml-8">
              <button 
                v-for="tab in tabs" 
                :key="tab.id"
                @click="currentTab = tab.id"
                class="px-3 py-2 rounded-md text-sm font-medium transition-colors"
                :class="currentTab === tab.id ? 'bg-gray-700 text-white' : 'text-gray-300 hover:text-white'"
              >
                {{ tab.label }}
              </button>
            </nav>
          </div>
          <div class="flex items-center space-x-4">
            <span class="text-sm text-gray-400">
              {{ connected ? '🟢 已连接' : '🔴 未连接' }}
            </span>
            <span class="text-sm text-gray-300">
              {{ currentUser?.username || 'User' }}
            </span>
            <button
              @click="showNewRequest = true"
              class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              + 新建请求
            </button>
            <button
              @click="handleLogout"
              class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors"
            >
              退出
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- 流水线列表 -->
      <div v-if="currentTab === 'pipelines'">
        <PipelineList @select="handlePipelineSelect" />
      </div>
      
      <!-- 角色管理 -->
      <div v-else-if="currentTab === 'agents'" class="space-y-6">
        <AgentManager @select-pipeline="handlePipelineSelect" />
      </div>
      
      <!-- 测试报告 -->
      <div v-else-if="currentTab === 'reports'">
        <Reports />
      </div>
      
      <!-- 流水线详情 -->
      <div v-else-if="currentTab === 'detail'">
        <PipelineDetail 
          :pipeline-id="selectedPipelineId" 
          @back="currentTab = 'pipelines'"
        />
      </div>
    </main>

    <!-- New Request Modal -->
    <NewRequestModal 
      :show="showNewRequest" 
      @close="showNewRequest = false"
      @submit="handleNewRequest"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { usePipelineStore } from './stores/pipeline'
import NewRequestModal from './components/NewRequestModal.vue'
import PipelineList from './views/PipelineList.vue'
import PipelineDetail from './views/PipelineDetail.vue'
import AgentManager from './views/AgentManager.vue'
import Reports from './views/Reports.vue'
import Login from './views/Login.vue'

const store = usePipelineStore()
const showNewRequest = ref(false)
const connected = ref(false)
const currentTab = ref('pipelines')
const selectedPipelineId = ref(null)
const isLoggedIn = ref(false)
const currentUser = ref(null)

const tabs = [
  { id: 'pipelines', label: '流水线' },
  { id: 'agents', label: '角色管理' },
  { id: 'reports', label: '测试报告' }
]

function handleLogin(user) {
  currentUser.value = user
  isLoggedIn.value = true
  store.fetchPipelines()
  store.connect()
  connected.value = true
}

function handleLogout() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  isLoggedIn.value = false
  currentUser.value = null
  store.disconnect()
}

async function handleNewRequest(data) {
  const pipeline = await store.createPipeline(data)
  showNewRequest.value = false
  selectedPipelineId.value = pipeline.id
  currentTab.value = 'detail'
}

function handlePipelineSelect(id) {
  selectedPipelineId.value = id
  currentTab.value = 'detail'
}

onMounted(() => {
  // 检查是否已登录
  const token = localStorage.getItem('token')
  const user = localStorage.getItem('user')
  
  if (token && user) {
    currentUser.value = JSON.parse(user)
    isLoggedIn.value = true
    store.fetchPipelines()
    store.connect()
    connected.value = true
  }
  
  store.$subscribe((mutation, state) => {
    connected.value = state.connected
  })
})

onUnmounted(() => {
  store.disconnect()
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
