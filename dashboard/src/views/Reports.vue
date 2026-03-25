<template>
  <div class="bg-gray-800 rounded-lg border border-gray-700">
    <div class="px-6 py-4 border-b border-gray-700">
      <h2 class="text-lg font-medium text-white">测试报告</h2>
    </div>
    <div class="p-6">
      <div v-if="reports.length === 0" class="text-center py-12">
        <svg class="w-12 h-12 text-gray-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p class="text-gray-400">暂无测试报告</p>
        <p class="text-gray-500 text-sm mt-1">运行流水线后会自动生成报告</p>
      </div>
      
      <div v-else class="space-y-4">
        <div v-for="report in reports" :key="report.reportId" class="bg-gray-900 rounded-lg p-4">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h3 class="text-white font-medium">{{ report.pipelineId?.slice(0, 8) || 'Unknown' }}</h3>
              <p class="text-gray-400 text-sm">{{ formatTime(report.timestamp) }}</p>
            </div>
            <span :class="testTypeClass(report.testType)" class="px-3 py-1 rounded-full text-sm">
              {{ report.testType }}
            </span>
          </div>
          
          <div class="grid grid-cols-4 gap-4 mb-4">
            <div class="bg-gray-800 rounded p-3 text-center">
              <p class="text-gray-400 text-xs">总计</p>
              <p class="text-white text-xl font-semibold">{{ report.summary?.total || 0 }}</p>
            </div>
            <div class="bg-gray-800 rounded p-3 text-center">
              <p class="text-gray-400 text-xs">通过</p>
              <p class="text-green-400 text-xl font-semibold">{{ report.summary?.passed || 0 }}</p>
            </div>
            <div class="bg-gray-800 rounded p-3 text-center">
              <p class="text-gray-400 text-xs">失败</p>
              <p class="text-red-400 text-xl font-semibold">{{ report.summary?.failed || 0 }}</p>
            </div>
            <div class="bg-gray-800 rounded p-3 text-center">
              <p class="text-gray-400 text-xs">跳过</p>
              <p class="text-yellow-400 text-xl font-semibold">{{ report.summary?.skipped || 0 }}</p>
            </div>
          </div>
          
          <div v-if="report.performance" class="grid grid-cols-5 gap-2">
            <div v-for="(value, key) in report.performance" :key="key" class="bg-gray-800 rounded p-2 text-center">
              <p class="text-gray-400 text-xs">{{ key }}</p>
              <p class="text-white text-sm">{{ value }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

const reports = ref([])

function testTypeClass(type) {
  const classes = {
    smoke: 'bg-green-500/20 text-green-400',
    full: 'bg-blue-500/20 text-blue-400',
    regression: 'bg-purple-500/20 text-purple-400',
    e2e: 'bg-orange-500/20 text-orange-400'
  }
  return classes[type] || 'bg-gray-500/20 text-gray-400'
}

function formatTime(isoString) {
  if (!isoString) return '-'
  return new Date(isoString).toLocaleString('zh-CN')
}

async function fetchReports() {
  try {
    const { data } = await axios.get('/api/reports')
    reports.value = data
  } catch (e) {
    console.error('Failed to fetch reports:', e)
  }
}

onMounted(fetchReports)
</script>
