<template>
  <div class="min-h-screen bg-gray-900 flex items-center justify-center">
    <div class="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md p-8">
      <!-- Logo -->
      <div class="text-center mb-8">
        <div class="w-16 h-16 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
          <span class="text-white font-bold text-2xl">AI</span>
        </div>
        <h1 class="text-2xl font-bold text-white">Team Pipeline</h1>
        <p class="text-gray-400 text-sm mt-2">多角色 AI 开发团队系统</p>
      </div>

      <!-- Login Form -->
      <form @submit.prevent="handleLogin" class="space-y-6">
        <div>
          <label class="block text-gray-300 text-sm font-medium mb-2">用户名</label>
          <input 
            v-model="username"
            type="text" 
            class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            placeholder="输入用户名"
            required
          />
        </div>
        
        <div>
          <label class="block text-gray-300 text-sm font-medium mb-2">密码</label>
          <input 
            v-model="password"
            type="password" 
            class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            placeholder="输入密码"
            required
          />
        </div>

        <div v-if="error" class="bg-red-500/20 border border-red-500 rounded-lg p-3">
          <p class="text-red-400 text-sm">{{ error }}</p>
        </div>

        <button 
          type="submit"
          :disabled="loading"
          class="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg px-4 py-3 font-medium transition-colors flex items-center justify-center space-x-2"
        >
          <span v-if="loading" class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
          <span v-else>登录</span>
        </button>
      </form>

      <p class="text-gray-500 text-xs text-center mt-6">
        默认账号: admin / admin
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const emit = defineEmits(['login'])

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function handleLogin() {
  error.value = ''
  loading.value = true

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username.value,
        password: password.value
      })
    })

    const data = await response.json()

    if (!response.ok) {
      error.value = data.error || '登录失败'
      return
    }

    // 保存 token
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
    
    emit('login', data.user)
  } catch (e) {
    error.value = '网络错误，请重试'
  } finally {
    loading.value = false
  }
}
</script>
