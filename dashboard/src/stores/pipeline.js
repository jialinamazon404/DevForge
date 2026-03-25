import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { io } from 'socket.io-client'

const API_BASE = '/api'

export const usePipelineStore = defineStore('pipeline', () => {
  const pipelines = ref([])
  const currentPipeline = ref(null)
  const connected = ref(false)
  let socket = null

  // Computed
  const runningCount = computed(() => 
    pipelines.value.filter(p => p.status === 'running').length
  )
  
  const pendingCount = computed(() => 
    pipelines.value.filter(p => p.status === 'pending').length
  )
  
  const completedCount = computed(() => 
    pipelines.value.filter(p => p.status === 'completed').length
  )

  // Actions
  async function fetchPipelines() {
    try {
      const { data } = await axios.get(`${API_BASE}/pipelines`)
      pipelines.value = data
    } catch (e) {
      console.error('Failed to fetch pipelines:', e)
    }
  }

  async function fetchPipeline(id) {
    try {
      const { data } = await axios.get(`${API_BASE}/pipelines/${id}`)
      currentPipeline.value = data
      return data
    } catch (e) {
      console.error('Failed to fetch pipeline:', e)
      return null
    }
  }

  async function createPipeline(request) {
    try {
      const { data } = await axios.post(`${API_BASE}/pipelines`, {
        rawInput: request.description,
        category: request.category,
        priority: request.priority || 'MEDIUM'
      })
      pipelines.value.unshift(data)
      return data
    } catch (e) {
      console.error('Failed to create pipeline:', e)
      throw e
    }
  }

  async function startPipeline(id) {
    try {
      const { data } = await axios.post(`${API_BASE}/pipelines/${id}/start`)
      const idx = pipelines.value.findIndex(p => p.id === id)
      if (idx !== -1) pipelines.value[idx] = data
      if (currentPipeline.value?.id === id) currentPipeline.value = data
      return data
    } catch (e) {
      console.error('Failed to start pipeline:', e)
    }
  }

  async function stopPipeline(id) {
    try {
      const { data } = await axios.post(`${API_BASE}/pipelines/${id}/stop`)
      const idx = pipelines.value.findIndex(p => p.id === id)
      if (idx !== -1) pipelines.value[idx] = data
      if (currentPipeline.value?.id === id) currentPipeline.value = data
      return data
    } catch (e) {
      console.error('Failed to stop pipeline:', e)
    }
  }

  async function pausePipeline(id) {
    try {
      const { data } = await axios.post(`${API_BASE}/pipelines/${id}/pause`)
      const idx = pipelines.value.findIndex(p => p.id === id)
      if (idx !== -1) pipelines.value[idx] = data
      if (currentPipeline.value?.id === id) currentPipeline.value = data
      return data
    } catch (e) {
      console.error('Failed to pause pipeline:', e)
    }
  }

  async function abandonPipeline(id, reason) {
    try {
      const { data } = await axios.post(`${API_BASE}/pipelines/${id}/abandon`, { reason })
      const idx = pipelines.value.findIndex(p => p.id === id)
      if (idx !== -1) pipelines.value[idx] = data
      if (currentPipeline.value?.id === id) currentPipeline.value = data
      return data
    } catch (e) {
      console.error('Failed to abandon pipeline:', e)
    }
  }

  async function deletePipeline(id) {
    try {
      await axios.delete(`${API_BASE}/pipelines/${id}`)
      pipelines.value = pipelines.value.filter(p => p.id !== id)
      if (currentPipeline.value?.id === id) currentPipeline.value = null
    } catch (e) {
      console.error('Failed to delete pipeline:', e)
    }
  }

  async function fetchLogs(id) {
    try {
      const { data } = await axios.get(`${API_BASE}/pipelines/${id}/logs`)
      return data
    } catch (e) {
      console.error('Failed to fetch logs:', e)
      return []
    }
  }

  function connect() {
    socket = io(window.location.origin, {
      transports: ['websocket', 'polling']
    })

    socket.on('connect', () => {
      connected.value = true
      console.log('[WS] Connected')
    })

    socket.on('disconnect', () => {
      connected.value = false
      console.log('[WS] Disconnected')
    })

    socket.on('pipeline:created', (pipeline) => {
      const idx = pipelines.value.findIndex(p => p.id === pipeline.id)
      if (idx === -1) pipelines.value.unshift(pipeline)
    })

    socket.on('pipeline:updated', (pipeline) => {
      const idx = pipelines.value.findIndex(p => p.id === pipeline.id)
      if (idx !== -1) pipelines.value[idx] = pipeline
      if (currentPipeline.value?.id === pipeline.id) {
        currentPipeline.value = pipeline
      }
    })

    socket.on('pipeline:deleted', ({ id }) => {
      pipelines.value = pipelines.value.filter(p => p.id !== id)
    })

    socket.on('pipeline:stage:completed', ({ pipelineId, agent, nextStage }) => {
      console.log(`[WS] Stage ${agent} completed, next: ${nextStage}`)
    })
  }

  function disconnect() {
    if (socket) {
      socket.disconnect()
      socket = null
    }
  }

  function subscribe(pipelineId) {
    if (socket) {
      socket.emit('subscribe', { pipelineId })
    }
  }

  return {
    pipelines,
    currentPipeline,
    connected,
    runningCount,
    pendingCount,
    completedCount,
    fetchPipelines,
    fetchPipeline,
    createPipeline,
    startPipeline,
    stopPipeline,
    pausePipeline,
    abandonPipeline,
    deletePipeline,
    fetchLogs,
    connect,
    disconnect,
    subscribe
  }
})
