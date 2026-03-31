<template>
  <div v-if="pipeline" class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <button @click="$emit('back')" class="text-gray-400 hover:text-white transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 class="text-xl font-semibold text-white">流水线: {{ pipeline.id.slice(0, 8) }}</h1>
          <p class="text-gray-400 text-sm mt-1">{{ pipeline.rawInput }}</p>
        </div>
      </div>
      <div class="flex items-center space-x-3">
        <span :class="statusClass(pipeline.status)" class="px-3 py-1 rounded-full text-sm font-medium">
          {{ statusText(pipeline.status) }}
        </span>
        
        <!-- 待处理状态 -->
        <button 
          v-if="pipeline.status === 'pending'"
          @click="startPipeline"
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          启动 ▶
        </button>
        
        <!-- 运行中状态 -->
        <template v-if="pipeline.status === 'running' || pipeline.status === 'waiting_selection'">
          <button 
            @click="pausePipeline"
            class="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            暂停 ⏸
          </button>
          <button 
            @click="showAbandonModal = true"
            class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            放弃 ✕
          </button>
        </template>
        
        <!-- 暂停状态 -->
        <template v-if="pipeline.status === 'paused'">
          <button 
            @click="resumePipeline"
            class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            继续 ▶
          </button>
          <button 
            @click="showAbandonModal = true"
            class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            放弃 ✕
          </button>
        </template>
      </div>
    </div>
    
    <!-- 放弃确认弹窗 -->
    <div v-if="showAbandonModal" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div class="bg-gray-800 rounded-xl border border-red-500 w-full max-w-md p-6">
        <h3 class="text-xl font-semibold text-white mb-4">⚠️ 确认放弃流水线</h3>
        <p class="text-gray-400 mb-4">确定要放弃这个流水线吗？此操作不可撤销。</p>
        <div class="mb-4">
          <label class="block text-gray-400 text-sm mb-2">放弃原因（可选）</label>
          <input 
            v-model="abandonReason" 
            type="text" 
            class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
            placeholder="输入放弃原因..."
          />
        </div>
        <div class="flex gap-3 justify-end">
          <button 
            @click="showAbandonModal = false"
            class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors"
          >
            取消
          </button>
          <button 
            @click="abandonPipeline"
            class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            确认放弃
          </button>
        </div>
      </div>
    </div>

    <!-- 交付物列表 -->
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h2 class="text-lg font-medium text-white mb-4">📦 交付物清单</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div 
          v-for="(stage, index) in pipeline.stages" 
          :key="stage.role"
          class="rounded-lg p-4 border transition-all cursor-pointer hover:scale-[1.02]"
          :class="deliverableClass(stage)"
          @click="selectStage(stage)"
        >
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center space-x-2">
              <span class="text-xl">{{ roleIcon(stage.role) }}</span>
              <span class="font-medium text-white">{{ roleName(stage.role) }}</span>
            </div>
            <div :class="deliverableStatusClass(stage)">
              <span v-if="stage.status === 'completed'" class="text-green-400 font-bold">✓</span>
              <span v-else-if="stage.status === 'running'" class="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></span>
              <span v-else class="text-gray-500">○</span>
            </div>
          </div>
          <div class="text-sm text-gray-400">{{ deliverableTitle(stage.role) }}</div>
          <div v-if="stage.duration" class="text-xs text-gray-500 mt-1">
            耗时: {{ (stage.duration / 1000).toFixed(1) }}s
          </div>
        </div>
      </div>
    </div>

    <!-- 当前角色思考过程 -->
    <div v-if="currentRunningStage" class="bg-gray-800 rounded-lg border border-blue-700 p-6">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center space-x-3">
          <span class="text-2xl animate-pulse">{{ roleIcon(currentRunningStage.role) }}</span>
          <div>
            <h2 class="text-lg font-medium text-white">{{ roleName(currentRunningStage.role) }} 正在思考...</h2>
            <p class="text-blue-400 text-sm">{{ currentRunningStage.goal || '执行中' }}</p>
          </div>
        </div>
        <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
      
      <!-- 思考步骤 -->
      <div class="space-y-3">
        <div v-for="(step, idx) in thinkingSteps" :key="idx" 
             class="bg-gray-900 rounded-lg p-4 border-l-4 border-blue-500">
          <div class="flex items-start space-x-3">
            <div class="w-6 h-6 rounded-full bg-blue-500/30 flex items-center justify-center text-blue-400 text-sm font-medium flex-shrink-0">
              {{ idx + 1 }}
            </div>
            <div class="flex-1">
              <div class="text-gray-400 text-sm mb-1">{{ step.prompt }}</div>
              <div v-if="step.thought" class="text-gray-200 text-sm">{{ step.thought }}</div>
              <div v-else class="text-gray-500 text-sm italic">思考中...</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Pipeline Flow -->
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h2 class="text-lg font-medium text-white mb-6">流水线状态</h2>
      <div class="flex items-center justify-between overflow-x-auto pb-4">
        <div 
          v-for="(stage, index) in pipeline.stages" 
          :key="stage.role"
          class="flex items-center"
        >
          <!-- Stage Card -->
          <div 
            class="flex flex-col items-center px-4 py-3 rounded-lg min-w-[100px] cursor-pointer transition-all hover:scale-105"
            :class="[
              stageClass(stage),
              selectedStage?.role === stage.role ? 'ring-2 ring-primary-500' : ''
            ]"
            @click="selectStage(stage)"
          >
            <div class="w-8 h-8 rounded-full flex items-center justify-center mb-2"
                 :class="stageIconBg(stage)"
            >
              <span v-if="stage.status === 'completed'" class="text-white">✓</span>
              <span v-else-if="stage.status === 'running'" class="w-3 h-3 bg-white rounded-full animate-pulse"></span>
              <span v-else class="text-gray-400 text-sm">{{ index + 1 }}</span>
            </div>
            <span class="text-sm font-medium">{{ roleName(stage.role) }}</span>
            <span class="text-xs text-gray-400 mt-1">{{ stageStatusText(stage.status) }}</span>
          </div>
          
          <!-- Arrow -->
          <div v-if="index < pipeline.stages.length - 1" class="mx-2">
            <svg class="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <!-- Architect Selection Modal -->
    <div v-if="showArchitectModal" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50" @click.self="showArchitectModal = false">
      <div class="bg-gray-800 rounded-xl border border-purple-500 w-full max-w-2xl max-h-[80vh] overflow-hidden">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-gray-700 bg-gradient-to-r from-purple-900/50 to-blue-900/50">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <span class="text-2xl">🏗️</span>
              <div>
                <h2 class="text-xl font-semibold text-white">技术选型</h2>
                <p class="text-purple-300 text-sm">请选择一个技术栈方案</p>
              </div>
            </div>
            <button @click="showArchitectModal = false" class="text-gray-400 hover:text-white">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
        
        <!-- Content -->
        <div class="p-6 overflow-auto max-h-[60vh]">
          <!-- Option Tags -->
          <div class="space-y-3">
            <div v-for="(opt, idx) in architectOptions?.options" :key="idx"
                 class="p-4 rounded-lg border-2 cursor-pointer transition-all"
                 :class="selectedOption === opt.id 
                   ? 'bg-purple-500/20 border-purple-500' 
                   : 'bg-gray-700/50 border-gray-600 hover:border-purple-400'"
                 @click="selectedOption = opt.id"
            >
              <div class="flex items-start justify-between">
                <div class="flex items-center space-x-3">
                  <div class="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-lg"
                       :class="selectedOption === opt.id ? 'bg-purple-500 text-white' : 'bg-gray-600 text-gray-300'">
                    {{ opt.id.split('-')[1]?.toUpperCase() || idx + 1 }}
                  </div>
                  <div>
                    <h3 class="text-white font-semibold">{{ opt.name }}</h3>
                    <div class="flex items-center gap-2 mt-1">
                      <span v-if="opt.id === architectOptions?.recommendation" 
                            class="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs">
                        ⭐ 推荐
                      </span>
                      <span class="text-gray-400 text-xs">
                        预估: {{ opt.estimatedTime || '待定' }}
                      </span>
                    </div>
                  </div>
                </div>
                <div v-if="selectedOption === opt.id" class="text-purple-400">
                  <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                  </svg>
                </div>
              </div>
              
              <!-- Stack Info -->
              <div class="mt-3 flex flex-wrap gap-2">
                <span v-if="opt.stack?.frontend" class="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">
                  前端: {{ opt.stack.frontend }}
                </span>
                <span v-if="opt.stack?.backend" class="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs">
                  后端: {{ opt.stack.backend }}
                </span>
                <span v-if="opt.stack?.database" class="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs">
                  数据库: {{ opt.stack.database }}
                </span>
                <span v-if="opt.stack?.deployment" class="px-2 py-1 bg-orange-500/20 text-orange-400 rounded text-xs">
                  部署: {{ opt.stack.deployment }}
                </span>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Footer -->
        <div class="px-6 py-4 border-t border-gray-700 bg-gray-900/50">
          <div class="flex items-center justify-between">
            <div v-if="selectedOption" class="text-gray-400 text-sm">
              已选择: <span class="text-purple-400 font-medium">
                {{ architectOptions?.options?.find(o => o.id === selectedOption)?.name }}
              </span>
            </div>
            <div v-else></div>
            <div class="flex gap-3">
              <button @click="showArchitectModal = false" 
                      class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors">
                取消
              </button>
              <button @click="confirmSelection" 
                      :disabled="!selectedOption"
                      class="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">
                确认选择 ✓
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

        <!-- Selected Stage Output -->
    <div v-if="selectedStage" class="bg-gray-800 rounded-lg border border-gray-700">
      <div class="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <span class="text-2xl">{{ roleIcon(selectedStage.role) }}</span>
          <div>
            <h2 class="text-lg font-medium text-white">{{ roleName(selectedStage.role) }}</h2>
            <p class="text-gray-400 text-sm">{{ stageStatusText(selectedStage.status) }}</p>
          </div>
        </div>
        <button @click="selectedStage = null" class="text-gray-400 hover:text-white">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      <!-- 实时思考过程（当正在运行时） -->
      <div v-if="selectedStage.status === 'running' && selectedStage.thinking?.steps" class="px-6 py-4 border-b border-gray-700 bg-gray-900/50">
        <h3 class="text-sm font-medium text-blue-400 mb-3">💭 AI 思考过程</h3>
        <div class="space-y-2">
          <div v-for="(step, idx) in selectedStage.thinking.steps" :key="idx"
               class="flex items-start space-x-3 text-sm">
            <div class="w-5 h-5 rounded-full bg-blue-500/30 flex items-center justify-center text-blue-400 text-xs flex-shrink-0 mt-0.5">
              {{ idx + 1 }}
            </div>
            <div class="flex-1">
              <div class="text-gray-400">{{ step.prompt }}</div>
              <div v-if="step.thought" class="text-gray-300 mt-1">{{ step.thought }}</div>
              <div v-else class="text-gray-500 mt-1 italic">思考中...</div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 实时日志（当正在运行时） -->
      <div v-if="pipeline.status === 'running'" class="px-6 py-4 border-b border-gray-700 bg-gray-900/30">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-medium text-green-400">📜 执行日志</h3>
          <button @click="refreshLogs" class="text-xs text-gray-400 hover:text-white">
            刷新
          </button>
        </div>
        <div class="bg-black/50 rounded-lg p-3 font-mono text-xs max-h-48 overflow-auto">
          <div v-for="(log, idx) in logs.slice(-20)" :key="idx" 
               class="text-gray-400 whitespace-pre-wrap"
               :class="{ 'text-red-400': log.type === 'agent_error' }">
            {{ formatLogTime(log.timestamp) }} {{ log.message }}
          </div>
          <div v-if="logs.length === 0" class="text-gray-500 italic">
            等待日志...
          </div>
        </div>
      </div>
      
      <!-- Tabs -->
      <div class="px-6 border-b border-gray-700">
        <div class="flex space-x-6">
          <button 
            @click="activeTab = 'thinking'"
            class="py-3 text-sm font-medium border-b-2 transition-colors"
            :class="activeTab === 'thinking' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-300'"
          >
            💭 思考过程
          </button>
          <button 
            @click="activeTab = 'output'"
            class="py-3 text-sm font-medium border-b-2 transition-colors"
            :class="activeTab === 'output' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-300'"
          >
            📤 输出结果
          </button>
          <button 
            @click="activeTab = 'goal'"
            class="py-3 text-sm font-medium border-b-2 transition-colors"
            :class="activeTab === 'goal' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-300'"
          >
            🎯 目标
          </button>
        </div>
      </div>
      
      <div class="p-6 max-h-[500px] overflow-auto">
        <!-- Goal Tab -->
        <div v-if="activeTab === 'goal'" class="space-y-4">
          <div class="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <div class="flex items-center space-x-2 mb-2">
              <span class="text-xl">{{ roleIcon(selectedStage.role) }}</span>
              <span class="text-blue-400 font-medium">目标</span>
            </div>
            <p class="text-gray-300">{{ selectedStage.goal || '未设置目标' }}</p>
          </div>
          <div v-if="selectedStage.duration" class="text-gray-400 text-sm">
            耗时: {{ (selectedStage.duration / 1000).toFixed(1) }}s
          </div>
        </div>
        
        <!-- Thinking Tab -->
        <div v-else-if="activeTab === 'thinking'" class="space-y-4">
          <div v-if="selectedStage.thinking" class="space-y-3">
            <div v-for="(step, idx) in selectedStage.thinking.steps" :key="idx"
                 class="bg-gray-900 rounded-lg p-4 border-l-4 border-blue-500">
              <div class="flex items-start space-x-3">
                <div class="w-6 h-6 rounded-full bg-blue-500/30 flex items-center justify-center text-blue-400 text-sm font-medium">
                  {{ idx + 1 }}
                </div>
                <div class="flex-1">
                  <div class="text-gray-400 text-sm mb-1">{{ step.prompt }}</div>
                  <div class="text-gray-200 text-sm">{{ step.thought }}</div>
                </div>
              </div>
            </div>
          </div>
          <div v-else-if="selectedStage.status === 'running'" class="text-center py-8">
            <div class="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p class="text-gray-400">思考中...</p>
          </div>
          <div v-else class="text-center py-8">
            <div class="text-4xl mb-4">💭</div>
            <p class="text-gray-400">暂无思考过程</p>
          </div>
        </div>
        
        <!-- Output Tab -->
        <div v-else-if="activeTab === 'output'">
          <!-- Running State -->
          <div v-if="selectedStage.status === 'running'" class="text-center py-8">
            <div class="animate-spin w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p class="text-gray-400">正在输出中...</p>
          </div>
          
          <!-- Pending State -->
          <div v-else-if="selectedStage.status === 'pending'" class="text-center py-8">
            <div class="text-4xl mb-4">⏳</div>
            <p class="text-gray-400">等待执行</p>
          </div>
        
        <!-- Completed State - Show Output -->
        <div v-else-if="selectedStage.output" class="space-y-4">
          <!-- Product PRD Output -->
          <template v-if="selectedStage.role === 'product'">
            <div v-if="selectedStage.output.prd" class="space-y-4">
              <div class="bg-indigo-500/20 border border-indigo-700 rounded-lg p-4">
                <div class="flex items-center space-x-2 mb-3">
                  <span class="text-2xl">📋</span>
                  <div>
                    <div class="text-indigo-400 font-medium">PRD 已生成</div>
                    <div class="text-gray-400 text-sm">{{ selectedStage.output.prd.title || '产品需求文档' }}</div>
                  </div>
                </div>
              </div>
              
              <!-- PRD Summary -->
              <div v-if="selectedStage.output.prd.summary" class="bg-gray-900 rounded-lg p-4">
                <h4 class="text-gray-300 font-medium mb-2">📝 产品概述</h4>
                <p class="text-gray-400 text-sm">{{ selectedStage.output.prd.summary }}</p>
              </div>
              
              <!-- User Stories -->
              <div v-if="selectedStage.output.prd.userStories?.length" class="bg-gray-900 rounded-lg p-4">
                <h4 class="text-gray-300 font-medium mb-3">👤 用户故事 ({{ selectedStage.output.prd.userStories.length }})</h4>
                <div class="space-y-3">
                  <div v-for="(story, idx) in selectedStage.output.prd.userStories" :key="idx"
                       class="bg-gray-800 rounded-lg p-3 border-l-4 border-indigo-500">
                    <div class="text-white font-medium mb-2">{{ story.id }} - {{ story.priority || 'MEDIUM' }}</div>
                    <div class="text-gray-400 text-sm space-y-1">
                      <div><span class="text-indigo-400">AS A:</span> {{ story.asA }}</div>
                      <div><span class="text-indigo-400">I WANT:</span> {{ story.iWant }}</div>
                      <div><span class="text-indigo-400">SO THAT:</span> {{ story.soThat }}</div>
                    </div>
                    <div v-if="story.acceptanceCriteria?.length" class="mt-2 pt-2 border-t border-gray-700">
                      <div class="text-gray-400 text-xs">验收标准:</div>
                      <ul class="text-gray-300 text-xs mt-1 list-disc list-inside">
                        <li v-for="(ac, acIdx) in story.acceptanceCriteria" :key="acIdx">{{ ac }}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- Features -->
              <div v-if="selectedStage.output.prd.features?.length" class="bg-gray-900 rounded-lg p-4">
                <h4 class="text-gray-300 font-medium mb-3">⚙️ 功能清单 ({{ selectedStage.output.prd.features.length }})</h4>
                <div class="space-y-2">
                  <div v-for="(feature, idx) in selectedStage.output.prd.features" :key="idx"
                       class="flex items-center justify-between bg-gray-800 rounded p-2">
                    <div>
                      <span class="text-white text-sm">{{ feature.id }}</span>
                      <span class="text-gray-400 text-sm ml-2">{{ feature.name }}</span>
                    </div>
                    <span class="px-2 py-0.5 rounded text-xs"
                          :class="{
                            'bg-red-500/20 text-red-400': feature.priority === 'HIGH',
                            'bg-yellow-500/20 text-yellow-400': feature.priority === 'MEDIUM',
                            'bg-gray-500/20 text-gray-400': feature.priority === 'LOW'
                          }">
                      {{ feature.priority }}
                    </span>
                  </div>
                </div>
              </div>
              
              <!-- PRD Path -->
              <div v-if="selectedStage.output.prdPath" class="bg-gray-900 rounded-lg p-4">
                <h4 class="text-gray-300 font-medium mb-2">📄 PRD 文件</h4>
                <code class="text-primary-400 text-sm">{{ selectedStage.output.prdPath }}</code>
              </div>
            </div>
            <div v-else-if="selectedStage.output.prdPath" class="space-y-3">
              <div class="bg-indigo-500/20 border border-indigo-700 rounded-lg p-4">
                <div class="flex items-center space-x-2 mb-2">
                  <span class="text-2xl">✅</span>
                  <div class="text-indigo-400 font-medium">PRD 已生成</div>
                </div>
                <code class="text-gray-300 text-sm">{{ selectedStage.output.prdPath }}</code>
              </div>
              <div v-if="selectedStage.output.userStoriesCount" class="text-gray-400 text-sm">
                用户故事: {{ selectedStage.output.userStoriesCount }} 个 | 功能: {{ selectedStage.output.featuresCount }} 个
              </div>
            </div>
            <div v-else class="text-gray-400">PRD 内容正在解析中...</div>
          </template>
          
          <!-- Architect Output -->
          <template v-else-if="selectedStage.role === 'architect'">
            <div class="space-y-4">
              <!-- Phase indicator -->
              <div v-if="selectedStage.output.phase === 'selection'" class="bg-purple-500/20 border border-purple-700 rounded-lg p-4">
                <div class="flex items-center space-x-2 mb-2">
                  <span class="text-2xl">⏳</span>
                  <div>
                    <div class="text-purple-400 font-medium">等待技术选型</div>
                    <div class="text-gray-400 text-sm">请在下方选择技术栈方案</div>
                  </div>
                </div>
              </div>
              
              <!-- Selected Option -->
              <div v-if="selectedStage.output.selectedOption" class="bg-green-500/20 border border-green-700 rounded-lg p-4">
                <div class="flex items-center space-x-2 mb-2">
                  <span class="text-2xl">✓</span>
                  <div>
                    <div class="text-green-400 font-medium">已选方案</div>
                    <div class="text-gray-300">{{ selectedStage.output.selectedOption }}</div>
                  </div>
                </div>
              </div>
              
              <!-- Architecture Diagrams -->
              <div v-if="selectedStage.output.architecture" class="space-y-4">
                <h4 class="text-gray-300 font-medium">📊 架构图</h4>
                
                <!-- Data Flow -->
                <div v-if="selectedStage.output.architecture.dataFlow" class="bg-gray-900 rounded-lg p-4">
                  <h5 class="text-purple-400 text-sm mb-2">📊 业务数据流转图</h5>
                  <pre class="text-gray-400 text-xs overflow-auto">{{ selectedStage.output.architecture.dataFlow }}</pre>
                </div>
                
                <!-- Network Architecture -->
                <div v-if="selectedStage.output.architecture.networkArch" class="bg-gray-900 rounded-lg p-4">
                  <h5 class="text-blue-400 text-sm mb-2">🌐 网络架构图</h5>
                  <pre class="text-gray-400 text-xs overflow-auto">{{ selectedStage.output.architecture.networkArch }}</pre>
                </div>
                
                <!-- Application Architecture -->
                <div v-if="selectedStage.output.architecture.appArch" class="bg-gray-900 rounded-lg p-4">
                  <h5 class="text-green-400 text-sm mb-2">⚙️ 应用架构图</h5>
                  <pre class="text-gray-400 text-xs overflow-auto">{{ selectedStage.output.architecture.appArch }}</pre>
                </div>
              </div>
              
              <!-- OpenSpec file -->
              <div v-if="selectedStage.output.openspecPath" class="bg-gray-900 rounded-lg p-4">
                <h5 class="text-gray-300 text-sm mb-2">📄 OpenAPI 规范</h5>
                <code class="text-primary-400 text-sm">{{ selectedStage.output.openspecPath }}</code>
              </div>
              
              <!-- Raw output fallback -->
              <div v-if="selectedStage.output.raw" class="bg-gray-900 rounded-lg p-4">
                <pre class="text-gray-300 text-xs whitespace-pre-wrap overflow-auto max-h-64">{{ selectedStage.output.raw }}</pre>
              </div>
            </div>
          </template>
          
          <!-- Developer Output -->
          <template v-else-if="selectedStage.role === 'developer'">
            <div class="space-y-3">
              <div v-if="selectedStage.output.branch" class="bg-blue-500/20 border border-blue-700 rounded-lg p-4">
                <div class="flex items-center space-x-2 mb-3">
                  <span class="text-2xl">💻</span>
                  <div>
                    <div class="text-blue-400 font-medium">开发完成</div>
                    <div class="text-gray-400 text-sm">代码已生成</div>
                  </div>
                </div>
                
                <!-- Code Location -->
                <div v-if="selectedStage.output.codeLocation" class="mt-3 pt-3 border-t border-blue-600/50">
                  <div class="flex items-center justify-between bg-gray-900/50 rounded-lg p-3">
                    <div>
                      <div class="text-blue-300 text-sm mb-1">📂 代码位置</div>
                      <code class="text-primary-400 font-mono text-sm">{{ selectedStage.output.codeLocation }}</code>
                    </div>
                    <button @click="copyUrl(selectedStage.output.codeLocation)" 
                            class="text-gray-400 hover:text-white transition-colors">
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
                
                <div class="grid grid-cols-2 gap-4 text-sm mt-3">
                  <div>
                    <span class="text-gray-400">Git 分支:</span>
                    <code class="ml-2 bg-gray-900 px-2 py-1 rounded text-white">{{ selectedStage.output.branch }}</code>
                  </div>
                  <div>
                    <span class="text-gray-400">文件数:</span>
                    <span class="ml-2 text-white">{{ selectedStage.output.files?.length || 0 }} 个</span>
                  </div>
                </div>
              </div>
              
              <!-- Generated Files -->
              <div v-if="selectedStage.output.files?.length" class="bg-gray-900 rounded-lg p-4">
                <h4 class="text-gray-300 font-medium mb-3">📁 生成的文件</h4>
                <div class="space-y-2">
                  <div v-for="(file, idx) in selectedStage.output.files" :key="idx" 
                       class="flex items-center justify-between bg-gray-800 rounded p-2">
                    <div class="flex items-center space-x-2">
                      <span class="text-gray-500">{{ idx + 1 }}.</span>
                      <code class="text-primary-400 text-sm">{{ file.path }}</code>
                    </div>
                    <span class="text-gray-500 text-xs">{{ file.lines }} 行</span>
                  </div>
                </div>
              </div>
              
              <!-- Test Results -->
              <div v-if="selectedStage.output.testResults" class="bg-gray-900 rounded-lg p-4">
                <h4 class="text-gray-300 font-medium mb-3">🧪 测试结果</h4>
                <div class="grid grid-cols-3 gap-4">
                  <div class="text-center">
                    <div class="text-2xl text-green-400">{{ selectedStage.output.testResults.passed }}</div>
                    <div class="text-gray-400 text-sm">通过</div>
                  </div>
                  <div class="text-center">
                    <div class="text-2xl text-red-400">{{ selectedStage.output.testResults.failed }}</div>
                    <div class="text-gray-400 text-sm">失败</div>
                  </div>
                  <div class="text-center">
                    <div class="text-2xl text-gray-400">{{ selectedStage.output.testResults.total }}</div>
                    <div class="text-gray-400 text-sm">总计</div>
                  </div>
                </div>
              </div>
              
              <!-- Commits -->
              <div v-if="selectedStage.output.commits?.length" class="bg-gray-900 rounded-lg p-4">
                <h4 class="text-gray-300 font-medium mb-3">📝 Git 提交</h4>
                <div v-for="(commit, idx) in selectedStage.output.commits" :key="idx" 
                     class="flex items-center space-x-3 py-2 border-b border-gray-800 last:border-0">
                  <code class="text-gray-500 text-sm">{{ commit.sha }}</code>
                  <span class="text-gray-300 text-sm">{{ commit.message }}</span>
                </div>
              </div>
              
              <!-- 开发文档完整内容 -->
              <div v-if="selectedStage.output.fullOutput || selectedStage.output.textSummary" class="bg-gray-900 rounded-lg p-4 mt-4">
                <h4 class="text-gray-300 font-medium mb-3">📄 开发文档</h4>
                <pre class="text-gray-300 text-sm whitespace-pre-wrap overflow-auto max-h-96">{{ selectedStage.output.fullOutput || selectedStage.output.textSummary }}</pre>
              </div>
              
              <!-- README 文档 -->
              <div v-if="selectedStage.output.readme" class="bg-gray-900 rounded-lg p-4 mt-4">
                <h4 class="text-gray-300 font-medium mb-3">📖 README 开发文档</h4>
                <pre class="text-gray-300 text-sm whitespace-pre-wrap overflow-auto max-h-96">{{ selectedStage.output.readme }}</pre>
              </div>
              
              <!-- API 接口文档表格 -->
              <div v-if="selectedStage.output.apiDocs && selectedStage.output.apiDocs.length > 0" class="bg-gray-900 rounded-lg p-4 mt-4">
                <h4 class="text-gray-300 font-medium mb-3">📡 API 接口文档</h4>
                <div class="overflow-x-auto">
                  <table class="w-full text-sm text-left">
                    <thead class="bg-gray-800 text-gray-400">
                      <tr>
                        <th class="px-3 py-2">方法</th>
                        <th class="px-3 py-2">路径</th>
                        <th class="px-3 py-2">描述</th>
                        <th class="px-3 py-2">请求参数</th>
                        <th class="px-3 py-2">响应格式</th>
                      </tr>
                    </thead>
                    <tbody class="text-gray-300">
                      <tr v-for="(api, idx) in selectedStage.output.apiDocs" :key="idx" class="border-t border-gray-700">
                        <td class="px-3 py-2 font-mono text-green-400">{{ api.method }}</td>
                        <td class="px-3 py-2 font-mono text-blue-400">{{ api.path }}</td>
                        <td class="px-3 py-2">{{ api.description }}</td>
                        <td class="px-3 py-2 text-gray-500">{{ api.request || '-' }}</td>
                        <td class="px-3 py-2 text-gray-500">{{ api.response || '-' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </template>
          
          <!-- Ops Output -->
          <template v-else-if="selectedStage.role === 'ops'">
            <div class="space-y-3">
              <div class="bg-orange-500/20 border border-orange-700 rounded-lg p-4">
                <div class="flex items-center space-x-2 mb-3">
                  <span class="text-2xl">🚀</span>
                  <div>
                    <div class="text-orange-400 font-medium">部署配置完成</div>
                    <div class="text-gray-400 text-sm">Docker / CI/CD 配置已生成</div>
                  </div>
                </div>
                
                <!-- Access URL -->
                <div v-if="selectedStage.output.accessUrl" class="mt-4 pt-4 border-t border-orange-600/50">
                  <div class="flex items-center justify-between bg-gray-900/50 rounded-lg p-3">
                    <div>
                      <div class="text-orange-300 text-sm mb-1">🌐 访问地址</div>
                      <a :href="selectedStage.output.accessUrl" target="_blank" 
                         class="text-primary-400 hover:text-primary-300 font-mono text-sm">
                        {{ selectedStage.output.accessUrl }}
                      </a>
                    </div>
                    <button @click="copyUrl(selectedStage.output.accessUrl)" 
                            class="text-gray-400 hover:text-white transition-colors">
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              
              <div v-if="selectedStage.output.dockerfile" class="bg-gray-900 rounded-lg p-4">
                <h4 class="text-gray-300 font-medium mb-2">🐳 Dockerfile</h4>
                <div class="flex items-center space-x-2">
                  <code class="text-primary-400">{{ selectedStage.output.dockerfile.path }}</code>
                  <span class="text-gray-500 text-sm">({{ selectedStage.output.dockerfile.content?.length || 0 }} 字符)</span>
                </div>
              </div>
              
              <div v-if="selectedStage.output.docker_compose" class="bg-gray-900 rounded-lg p-4">
                <h4 class="text-gray-300 font-medium mb-2">📦 docker-compose.yml</h4>
                <div class="flex items-center space-x-2">
                  <code class="text-primary-400">{{ selectedStage.output.docker_compose.path }}</code>
                </div>
              </div>
              
              <div v-if="selectedStage.output.deployment_script" class="bg-gray-900 rounded-lg p-4">
                <h4 class="text-gray-300 font-medium mb-2">📜 部署脚本</h4>
                <code class="text-primary-400">{{ selectedStage.output.deployment_script.path }}</code>
              </div>
            </div>
          </template>
          
          <!-- Tester Output -->
          <template v-else-if="selectedStage.role === 'tester'">
            <div class="space-y-3">
              <div v-if="selectedStage.output.testReport" class="bg-purple-500/20 border border-purple-700 rounded-lg p-4">
                <div class="flex items-center space-x-2 mb-3">
                  <span class="text-2xl">🧪</span>
                  <div>
                    <div class="text-purple-400 font-medium">测试报告</div>
                    <div class="text-gray-400 text-sm">{{ selectedStage.output.testReport.testType }} 测试</div>
                  </div>
                </div>
                
                <div class="grid grid-cols-4 gap-3">
                  <div class="bg-gray-900 rounded p-3 text-center">
                    <div class="text-2xl text-green-400">{{ selectedStage.output.testReport.summary?.passed || 0 }}</div>
                    <div class="text-gray-400 text-xs">通过</div>
                  </div>
                  <div class="bg-gray-900 rounded p-3 text-center">
                    <div class="text-2xl text-red-400">{{ selectedStage.output.testReport.summary?.failed || 0 }}</div>
                    <div class="text-gray-400 text-xs">失败</div>
                  </div>
                  <div class="bg-gray-900 rounded p-3 text-center">
                    <div class="text-2xl text-yellow-400">{{ selectedStage.output.testReport.summary?.skipped || 0 }}</div>
                    <div class="text-gray-400 text-xs">跳过</div>
                  </div>
                  <div class="bg-gray-900 rounded p-3 text-center">
                    <div class="text-2xl text-white">{{ selectedStage.output.testReport.summary?.total || 0 }}</div>
                    <div class="text-gray-400 text-xs">总计</div>
                  </div>
                </div>
              </div>
              
              <!-- Bugs -->
              <div v-if="selectedStage.output.testReport?.bugs?.length" class="bg-gray-900 rounded-lg p-4">
                <h4 class="text-gray-300 font-medium mb-3">🐛 发现的 Bug</h4>
                <div class="space-y-2">
                  <div v-for="(bug, idx) in selectedStage.output.testReport.bugs" :key="idx"
                       class="bg-gray-800 rounded p-3 border-l-4"
                       :class="{
                         'border-red-500': bug.severity === 'CRITICAL' || bug.severity === 'HIGH',
                         'border-yellow-500': bug.severity === 'MEDIUM',
                         'border-gray-500': bug.severity === 'LOW'
                       }">
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-white font-medium">{{ bug.id }}</span>
                      <span class="px-2 py-0.5 rounded text-xs"
                            :class="{
                              'bg-red-500/20 text-red-400': bug.severity === 'CRITICAL' || bug.severity === 'HIGH',
                              'bg-yellow-500/20 text-yellow-400': bug.severity === 'MEDIUM',
                              'bg-gray-500/20 text-gray-400': bug.severity === 'LOW'
                            }">
                        {{ bug.severity }}
                      </span>
                    </div>
                    <div class="text-gray-300 text-sm">{{ bug.title }}</div>
                  </div>
                </div>
              </div>
            </div>
          </template>
          
          <!-- Tech Coach Output -->
          <template v-else-if="selectedStage.role === 'tech_coach'">
            <div class="space-y-3">
              <div class="bg-cyan-500/20 border border-cyan-700 rounded-lg p-4">
                <div class="flex items-center space-x-2 mb-3">
                  <span class="text-2xl">🔍</span>
                  <div>
                    <div class="text-cyan-400 font-medium">可行性分析完成</div>
                    <div class="text-gray-400 text-sm">{{ selectedStage.output.findings?.length || 0 }} 个发现</div>
                  </div>
                </div>
                <div v-if="selectedStage.output.feasibility" class="mt-3 pt-3 border-t border-cyan-800">
                  <div class="flex items-center space-x-2">
                    <span>可行性:</span>
                    <span class="px-2 py-0.5 rounded text-sm font-medium"
                          :class="{
                            'bg-green-500/20 text-green-400': selectedStage.output.feasibility.overall === 'FEASIBLE',
                            'bg-yellow-500/20 text-yellow-400': selectedStage.output.feasibility.overall === 'CHALLENGING',
                            'bg-red-500/20 text-red-400': selectedStage.output.feasibility.overall === 'INFEASIBLE'
                          }">
                      {{ selectedStage.output.feasibility.overall }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </template>
          
          <!-- Generic Output -->
          <template v-else>
            <div v-if="selectedStage.output.textSummary" class="space-y-4">
              <pre class="bg-gray-900 rounded-lg p-4 text-gray-300 text-sm whitespace-pre-wrap overflow-auto max-h-96">{{ selectedStage.output.textSummary }}</pre>
              <div v-if="selectedStage.output.fullOutput" class="bg-gray-900 rounded-lg p-4">
                <h4 class="text-gray-300 font-medium mb-2">完整输出:</h4>
                <pre class="text-gray-400 text-xs whitespace-pre-wrap overflow-auto max-h-64">{{ selectedStage.output.fullOutput }}</pre>
              </div>
            </div>
            <pre v-else class="bg-gray-900 rounded-lg p-4 text-gray-300 text-sm whitespace-pre-wrap overflow-auto max-h-96">{{ JSON.stringify(selectedStage.output, null, 2) }}</pre>
          </template>
        </div>
        
        <!-- No Output -->
        <div v-else class="text-center py-8">
          <div class="text-4xl mb-4">📭</div>
          <p class="text-gray-400">暂无输出</p>
        </div>
        </div>
      </div>
    </div>

  </div>

  <div v-else class="text-center py-20">
    <div class="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto mb-4"></div>
    <p class="text-gray-400">加载中...</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { usePipelineStore } from '../stores/pipeline'

const props = defineProps({
  pipelineId: {
    type: String,
    required: true
  }
})

defineEmits(['back'])

const store = usePipelineStore()
const logs = ref([])

const pipeline = computed(() => store.currentPipeline)
const currentStage = computed(() => {
  if (!pipeline.value) return null
  return pipeline.value.stages.find(s => 
    s.status === 'running' || 
    (s.status === 'pending' && pipeline.value.currentStage === s.role)
  )
})
const completedStages = computed(() => {
  if (!pipeline.value) return []
  return pipeline.value.stages.filter(s => s.status === 'completed')
})
const selectedStage = ref(null)
const activeTab = ref('output')

// 当前正在运行的角色
const currentRunningStage = computed(() => {
  if (!pipeline.value) return null
  return pipeline.value.stages.find(s => s.status === 'running')
})

// 思考步骤（实时从阶段数据获取）
const thinkingSteps = computed(() => {
  if (!currentRunningStage.value) return []
  const stage = currentRunningStage.value
  if (stage.thinking?.steps) return stage.thinking.steps
  // 如果阶段有 goal，生成默认步骤
  if (stage.goal) {
    return [
      { prompt: '理解任务目标', thought: stage.goal },
      { prompt: '分析输入内容', thought: '正在读取上下文...' },
      { prompt: '执行 AI 推理', thought: 'AI Agent 正在思考...' },
      { prompt: '生成输出', thought: '正在生成结构化输出...' }
    ]
  }
  return [
    { prompt: '理解任务目标', thought: null },
    { prompt: '分析输入内容', thought: null },
    { prompt: '执行 AI 推理', thought: null },
    { prompt: '生成输出', thought: null }
  ]
})

// 交付物标题
function deliverableTitle(role) {
  const titles = {
    product: 'PRD 产品需求文档',
    architect: 'OpenSpec 系统设计',
    tech_coach: '可行性分析报告',
    developer: '源代码 + PR',
    tester: '测试报告 + Bug 列表',
    ops: 'Docker + CI/CD 配置',
    ghost: '安全审计报告',
    creative: '设计评审意见',
    evolver: '重构优化建议'
  }
  return titles[role] || '交付物'
}

// 交付物卡片样式
function deliverableClass(stage) {
  if (stage.status === 'completed') return 'bg-green-900/30 border border-green-700'
  if (stage.status === 'running') return 'bg-blue-900/30 border border-blue-700'
  if (stage.status === 'failed') return 'bg-red-900/30 border border-red-700'
  return 'bg-gray-800 border border-gray-700'
}

// 交付物状态样式
function deliverableStatusClass(stage) {
  if (stage.status === 'completed') return 'text-green-400 text-lg'
  if (stage.status === 'running') return 'text-blue-400'
  if (stage.status === 'failed') return 'text-red-400'
  return 'text-gray-500'
}

// Architect selection
const architectOptions = ref(null)
const selectedOption = ref(null)
const showArchitectModal = ref(false)

function selectStage(stage) {
  selectedStage.value = stage
  activeTab.value = 'thinking'
  // If architect has output with options, show selection modal
  if (stage.role === 'architect' && stage.output?.options) {
    architectOptions.value = stage.output
    selectedOption.value = null
    showArchitectModal.value = true
  } else {
    architectOptions.value = null
    selectedOption.value = null
    showArchitectModal.value = false
  }
}

function selectOption(opt) {
  selectedOption.value = opt.id
}

async function confirmSelection() {
  if (!selectedOption.value) return
  
  try {
    await axios.post(`${import.meta.env.VITE_API_URL}/api/pipelines/${props.pipelineId}/select`, {
      option: selectedOption.value,
      message: `选择了 ${architectOptions.value.options?.find(o => o.id === selectedOption.value)?.name}`
    })
    
    // Close modal and refresh
    showArchitectModal.value = false
    architectOptions.value = null
    selectedOption.value = null
    selectedStage.value = null
    await store.fetchPipeline(props.pipelineId)
  } catch (e) {
    console.error('选择失败:', e)
  }
}

const roleNames = {
  receptionist: '前台',
  gatekeeper: '守门人',
  product: '产品',
  architect: '架构师',
  tech_coach: '开发教练',
  developer: '开发',
  tester: '测试',
  ops: '运维',
  ghost: '幽灵',
  creative: '创意',
  evolver: '进化'
}

const roleIcons = {
  receptionist: '👋',
  gatekeeper: '🛡️',
  product: '📋',
  architect: '🏗️',
  tech_coach: '🔍',
  developer: '💻',
  tester: '🧪',
  ops: '🚀',
  ghost: '👻',
  creative: '🎨',
  evolver: '🔄'
}

function roleName(role) {
  return roleNames[role] || role
}

function roleIcon(role) {
  return roleIcons[role] || '🤖'
}

function extractOpenSpec(raw) {
  if (!raw) return ''
  try {
    // 尝试提取 YAML 内容
    const match = raw.match(/```yaml\n([\s\S]*?)```/i)
    if (match) return match[1]
    
    // 尝试提取 JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) return JSON.stringify(JSON.parse(jsonMatch[0]), null, 2)
    
    return raw
  } catch {
    return raw
  }
}

function statusClass(status) {
  const classes = {
    pending: 'bg-gray-600 text-gray-300',
    running: 'bg-blue-600 text-white',
    completed: 'bg-green-600 text-white',
    failed: 'bg-red-600 text-white',
    stopped: 'bg-yellow-600 text-white',
    waiting_selection: 'bg-purple-600 text-white',
    paused: 'bg-yellow-500 text-white',
    abandoned: 'bg-gray-700 text-gray-300'
  }
  return classes[status] || classes.pending
}

function statusText(status) {
  const texts = {
    pending: '待处理',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    stopped: '已停止',
    waiting_selection: '等待选择',
    paused: '已暂停',
    abandoned: '已放弃'
  }
  return texts[status] || status
}

function stageClass(stage) {
  if (stage.status === 'completed') return 'bg-green-900/30 border border-green-700'
  if (stage.status === 'running') return 'bg-blue-900/30 border border-blue-700'
  if (stage.status === 'failed') return 'bg-red-900/30 border border-red-700'
  return 'bg-gray-800 border border-gray-700'
}

function stageIconBg(stage) {
  if (stage.status === 'completed') return 'bg-green-500'
  if (stage.status === 'running') return 'bg-blue-500'
  if (stage.status === 'failed') return 'bg-red-500'
  return 'bg-gray-600'
}

function stageStatusClass(status) {
  const classes = {
    pending: 'text-gray-400',
    running: 'text-blue-400',
    completed: 'text-green-400',
    failed: 'text-red-400'
  }
  return classes[status] || 'text-gray-400'
}

function stageStatusText(status) {
  const texts = {
    pending: '等待执行',
    running: '正在执行',
    completed: '已完成',
    failed: '执行失败',
    stopped: '已停止'
  }
  return texts[status] || status
}

function bugSeverityClass(severity) {
  const classes = {
    CRITICAL: 'bg-red-500/20 text-red-400',
    HIGH: 'bg-orange-500/20 text-orange-400',
    MEDIUM: 'bg-yellow-500/20 text-yellow-400',
    LOW: 'bg-gray-500/20 text-gray-400'
  }
  return classes[severity] || classes.LOW
}

function formatTime(isoString) {
  if (!isoString) return '-'
  return new Date(isoString).toLocaleString('zh-CN')
}

function formatLogTime(isoString) {
  if (!isoString) return ''
  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return ''
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`
  } catch {
    return ''
  }
}

async function refreshLogs() {
  logs.value = await store.fetchLogs(props.pipelineId)
}

async function startPipeline() {
  await store.startPipeline(props.pipelineId)
}

async function pausePipeline() {
  await axios.post(`${import.meta.env.VITE_API_URL}/api/pipelines/${props.pipelineId}/pause`)
  await store.fetchPipeline(props.pipelineId)
}

async function resumePipeline() {
  await store.startPipeline(props.pipelineId)
}

const showAbandonModal = ref(false)
const abandonReason = ref('')

async function abandonPipeline() {
  try {
    await axios.post(`${import.meta.env.VITE_API_URL}/api/pipelines/${props.pipelineId}/abandon`, {
      reason: abandonReason.value
    })
    showAbandonModal.value = false
    await store.fetchPipeline(props.pipelineId)
  } catch (e) {
    console.error('放弃失败:', e)
  }
}

function copyUrl(url) {
  navigator.clipboard.writeText(url)
}

let intervalId = null

// Auto-show architect modal when waiting for selection
watch(() => pipeline.value?.status, (newStatus) => {
  if (newStatus === 'waiting_selection' && pipeline.value?.stages) {
    const architectStage = pipeline.value.stages.find(s => s.role === 'architect')
    if (architectStage?.output?.options) {
      architectOptions.value = architectStage.output
      showArchitectModal.value = true
    }
  }
})

onMounted(async () => {
  await store.fetchPipeline(props.pipelineId)
  await refreshLogs()
  store.subscribe(props.pipelineId)
  
  // Poll for updates
  intervalId = setInterval(async () => {
    await store.fetchPipeline(props.pipelineId)
    await refreshLogs()
  }, 3000)
  
  // 监听 WebSocket Agent 输出
  if (store.socket) {
    store.socket.on('agent:output', ({ pipelineId, output }) => {
      if (pipelineId === props.pipelineId) {
        // 实时追加日志
        logs.value.push({
          timestamp: new Date().toISOString(),
          type: 'agent_log',
          message: output.trim()
        })
      }
    })
    
    store.socket.on('pipeline:stage:updated', ({ pipelineId, stage }) => {
      if (pipelineId === props.pipelineId && stage.thinking) {
        // 更新当前阶段的思考数据
        store.fetchPipeline(props.pipelineId)
      }
    })
  }
})

watch(() => props.pipelineId, async (newId) => {
  if (newId) {
    await store.fetchPipeline(newId)
    await refreshLogs()
    store.subscribe(newId)
  }
})

onUnmounted(() => {
  if (intervalId) clearInterval(intervalId)
})
</script>
