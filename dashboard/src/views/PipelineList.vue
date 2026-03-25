<template>
  <div>
    <!-- Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-gray-400 text-sm">全部流水线</p>
            <p class="text-2xl font-semibold text-white mt-1">{{ store.pipelines.length }}</p>
          </div>
          <div class="w-10 h-10 bg-gray-700 rounded-lg flex items-center justify-center">
            <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
          </div>
        </div>
      </div>
      
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-gray-400 text-sm">运行中</p>
            <p class="text-2xl font-semibold text-blue-400 mt-1">{{ store.runningCount }}</p>
          </div>
          <div class="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
            <div class="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
          </div>
        </div>
      </div>

      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-gray-400 text-sm">待处理</p>
            <p class="text-2xl font-semibold text-yellow-400 mt-1">{{ store.pendingCount }}</p>
          </div>
          <div class="w-10 h-10 bg-yellow-500/20 rounded-lg flex items-center justify-center">
            <svg class="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>

      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-gray-400 text-sm">已完成</p>
            <p class="text-2xl font-semibold text-green-400 mt-1">{{ store.completedCount }}</p>
          </div>
          <div class="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
            <svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- Pipeline List -->
    <div class="bg-gray-800 rounded-lg border border-gray-700">
      <div class="px-6 py-4 border-b border-gray-700">
        <h2 class="text-lg font-medium text-white">流水线列表</h2>
      </div>
      
      <div v-if="store.pipelines.length === 0" class="p-8 text-center">
        <svg class="w-12 h-12 text-gray-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
        <p class="text-gray-400">暂无流水线</p>
        <p class="text-gray-500 text-sm mt-1">点击右上角「新建请求」开始</p>
      </div>

      <div v-else class="divide-y divide-gray-700">
        <div 
          v-for="pipeline in store.pipelines" 
          :key="pipeline.id"
          class="px-6 py-4 hover:bg-gray-750 cursor-pointer transition-colors"
          @click="$emit('select', pipeline.id)"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-4">
              <!-- Status Indicator -->
              <div class="relative">
                <div :class="statusClass(pipeline.status)" class="w-3 h-3 rounded-full"></div>
                <div v-if="pipeline.status === 'running'" class="absolute inset-0 w-3 h-3 bg-blue-500 rounded-full animate-ping opacity-75"></div>
              </div>
              
              <!-- Info -->
              <div>
                <div class="flex items-center space-x-2">
                  <span class="text-white font-medium">{{ pipeline.id.slice(0, 8) }}</span>
                  <span :class="categoryClass(pipeline.category)" class="px-2 py-0.5 rounded text-xs font-medium">
                    {{ pipeline.category }}
                  </span>
                  <span :class="priorityClass(pipeline.priority)" class="px-2 py-0.5 rounded text-xs">
                    {{ pipeline.priority }}
                  </span>
                </div>
                <p class="text-gray-400 text-sm mt-1 truncate max-w-md">{{ pipeline.rawInput }}</p>
              </div>
            </div>

            <div class="flex items-center space-x-4">
              <div class="text-right">
                <p class="text-gray-400 text-sm">{{ pipeline.currentStage || 'pending' }}</p>
                <p class="text-gray-500 text-xs">{{ formatTime(pipeline.createdAt) }}</p>
              </div>
              
              <button 
                v-if="pipeline.status === 'pending'"
                @click.stop="startPipeline(pipeline.id)"
                class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors"
              >
                启动
              </button>
              
              <button 
                v-if="pipeline.status === 'running'"
                @click.stop="stopPipeline(pipeline.id)"
                class="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm transition-colors"
              >
                停止
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { usePipelineStore } from '../stores/pipeline'

defineEmits(['select'])

const store = usePipelineStore()

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

function priorityClass(priority) {
  const classes = {
    LOW: 'bg-gray-500/20 text-gray-400',
    MEDIUM: 'bg-yellow-500/20 text-yellow-400',
    HIGH: 'bg-orange-500/20 text-orange-400',
    CRITICAL: 'bg-red-500/20 text-red-400'
  }
  return classes[priority] || 'bg-gray-500/20 text-gray-400'
}

function formatTime(isoString) {
  const date = new Date(isoString)
  const now = new Date()
  const diff = now - date
  
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  return date.toLocaleDateString('zh-CN')
}

async function startPipeline(id) {
  await store.startPipeline(id)
}

async function stopPipeline(id) {
  await store.stopPipeline(id)
}
</script>
