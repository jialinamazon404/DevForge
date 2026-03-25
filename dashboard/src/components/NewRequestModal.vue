<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="$emit('close')"></div>
      
      <!-- Modal -->
      <div class="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 border border-gray-700">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 class="text-lg font-semibold text-white">新建请求</h2>
          <button @click="$emit('close')" class="text-gray-400 hover:text-white transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <form @submit.prevent="handleSubmit" class="p-6 space-y-4">
          <!-- Description -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">需求描述</label>
            <textarea
              v-model="form.description"
              rows="4"
              class="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="描述你想要实现的功能..."
              required
            ></textarea>
          </div>
          
          <!-- Category -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">请求类型</label>
            <div class="grid grid-cols-2 gap-2">
              <label 
                v-for="opt in categoryOptions" 
                :key="opt.value"
                class="flex items-center p-3 rounded-lg border cursor-pointer transition-all"
                :class="form.category === opt.value 
                  ? 'border-primary-500 bg-primary-500/10' 
                  : 'border-gray-700 hover:border-gray-600'"
              >
                <input 
                  type="radio" 
                  v-model="form.category" 
                  :value="opt.value"
                  class="hidden"
                />
                <span class="text-2xl mr-3">{{ opt.icon }}</span>
                <div>
                  <span class="text-white font-medium block">{{ opt.label }}</span>
                  <span class="text-gray-400 text-xs">{{ opt.desc }}</span>
                </div>
              </label>
            </div>
          </div>
          
          <!-- Priority -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">优先级</label>
            <select
              v-model="form.priority"
              class="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="LOW">低 (Low)</option>
              <option value="MEDIUM">中 (Medium)</option>
              <option value="HIGH">高 (High)</option>
              <option value="CRITICAL">紧急 (Critical)</option>
            </select>
          </div>
          
          <!-- Submit -->
          <div class="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              @click="$emit('close')"
              class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              class="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
            >
              创建流水线
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  show: Boolean
})

const emit = defineEmits(['close', 'submit'])

const form = ref({
  description: '',
  category: 'BUILD',
  priority: 'MEDIUM'
})

const categoryOptions = [
  { value: 'BUILD', label: '新功能', desc: '开发新功能', icon: '🛠️' },
  { value: 'REVIEW', label: '代码审查', desc: '审查现有代码', icon: '🔍' },
  { value: 'QUERY', label: '技术咨询', desc: '询问问题', icon: '❓' },
  { value: 'SECURITY', label: '安全扫描', desc: '安全漏洞检测', icon: '🔒' },
  { value: 'CRITICAL', label: '紧急修复', desc: '紧急问题处理', icon: '🚨' }
]

watch(() => props.show, (val) => {
  if (val) {
    form.value = {
      description: '',
      category: 'BUILD',
      priority: 'MEDIUM'
    }
  }
})

function handleSubmit() {
  emit('submit', {
    description: form.value.description,
    category: form.value.category,
    priority: form.value.priority
  })
}
</script>
