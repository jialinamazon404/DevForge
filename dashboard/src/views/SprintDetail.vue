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
            <div class="flex items-center space-x-1">
              <span class="px-2 py-0.5 bg-vue-darker rounded text-xs text-gray-400 font-mono">
                {{ sprint.id.slice(0, 8) }}
              </span>
              <button
                @click="copySprintId"
                class="p-1.5 text-gray-400 hover:text-vue-primary transition-colors"
                title="复制完整 ID"
              >
                <svg v-if="!showCopySuccess" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <svg v-else class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </div>
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
        <!-- 角色产出大纲 -->
        <div class="bg-vue-darker rounded-vue p-4">
          <h3 class="text-gray-400 text-sm mb-2">角色产出大纲</h3>
          
          <!-- 显示上一角色的执行记录 -->
          <div v-if="executionLog" class="space-y-3">
            <div class="flex items-center space-x-3 bg-vue-card rounded-vue p-3">
              <span class="text-2xl">{{ currentIteration?.roleInfo?.icon || '🤖' }}</span>
              <div>
                <div class="text-white font-medium">{{ currentIteration?.roleInfo?.name || '-' }}</div>
                <div class="text-xs text-green-400">✅ 已完成</div>
              </div>
            </div>
            
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div class="bg-vue-card rounded-vue p-3">
                <div class="text-gray-500 text-xs mb-1">🛠️ 使用 Skill</div>
                <div class="text-white">{{ executionLog.skill }}</div>
              </div>
              <div class="bg-vue-card rounded-vue p-3">
                <div class="text-gray-500 text-xs mb-1">⏱️ 耗时</div>
                <div class="text-white">{{ executionLog.duration }}</div>
              </div>
            </div>
            
            <div class="bg-vue-card rounded-vue p-3">
              <div class="text-gray-500 text-xs mb-2">📝 执行步骤</div>
              <div class="flex flex-wrap gap-2">
                <span 
                  v-for="step in executionLog.steps" 
                  :key="step.id"
                  class="px-2 py-1 bg-vue-darker rounded text-xs text-vue-primary"
                >
                  {{ step.name }}
                </span>
              </div>
            </div>
            
            <div v-if="executionLog.outputFiles?.length > 0" class="bg-vue-card rounded-vue p-3">
              <div class="text-gray-500 text-xs mb-2">📁 产出文件</div>
              <div class="space-y-1">
                <div 
                  v-for="file in executionLog.outputFiles" 
                  :key="file.path"
                  class="flex items-center justify-between text-sm"
                >
                  <span class="text-gray-300">{{ file.name }}</span>
                  <button 
                    @click="openPreview(file.path)"
                    class="text-vue-primary hover:text-vue-secondary"
                  >
                    查看
                  </button>
                </div>
              </div>
            </div>
            
            <div v-if="executionLog.outputPreview" class="bg-vue-card rounded-vue p-3">
              <div class="flex items-center justify-between mb-2">
                <div class="text-gray-500 text-xs">📄 输出预览</div>
                <button 
                  @click="showOutputPreview = !showOutputPreview"
                  class="text-xs text-vue-primary hover:text-vue-secondary"
                >
                  {{ showOutputPreview ? '收起' : '展开' }}
                </button>
              </div>
              <div v-if="showOutputPreview" class="text-xs text-gray-400 bg-vue-darker rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                {{ executionLog.outputPreview }}
              </div>
              <div v-else class="text-xs text-gray-500 truncate">
                {{ executionLog.outputPreview.slice(0, 100) }}...
              </div>
            </div>
            
            <div class="flex justify-end pt-2">
              <button
                @click="submitUserInput"
                class="px-4 py-2 bg-gradient-to-r from-vue-primary to-vue-secondary text-white rounded-vue text-sm font-medium transition-all hover:shadow-vue-glow"
              >
                执行 {{ currentIteration?.roleInfo?.name }} ✓
              </button>
            </div>
          </div>
          
          <!-- Product 角色：直接显示冲刺需求 -->
          <div v-else-if="isProductRole && sprint?.rawInput" class="space-y-3">
            <div class="text-white bg-vue-card rounded-vue p-3 max-h-[200px] overflow-auto">
              {{ sprint.rawInput }}
            </div>
            <div class="flex justify-end space-x-3">
              <button
                v-if="isProductRole && currentIteration?.status === 'completed'"
                @click="rerunIteration"
                class="px-4 py-2 bg-yellow-600/20 border border-yellow-600/50 text-yellow-400 hover:bg-yellow-600/30 rounded-vue text-sm transition-all"
              >
                重新生成 🔄
              </button>
              <button
                @click="submitUserInput"
                :disabled="!canAutoExecute"
                class="px-4 py-2 bg-gradient-to-r from-vue-primary to-vue-secondary disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-vue text-sm font-medium transition-all hover:shadow-vue-glow"
              >
                执行 ✓
              </button>
            </div>
          </div>
          
          <div v-else class="text-gray-500 italic">
            等待上一角色完成...
          </div>
          
          <!-- Tester 角色：环境地址输入 -->
          <div v-if="isTesterRole" class="mt-4 space-y-3 bg-vue-card rounded-vue p-4">
            <h3 class="text-gray-400 text-sm font-medium">🧪 测试环境配置</h3>
            <div class="text-xs text-gray-500">
              如有测试环境地址，Tester 将执行完整的运行时测试；否则执行静态代码审查
            </div>
            <div class="flex items-center space-x-2">
              <input
                v-model="testEnvironmentUrl"
                type="text"
                placeholder="输入测试环境地址，如 http://localhost:3000"
                class="flex-1 bg-vue-darker border border-vue-border rounded-vue px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-vue-primary"
              />
              <button
                @click="saveEnvironmentUrl"
                class="px-3 py-2 bg-vue-primary/20 border border-vue-primary/50 text-vue-primary hover:bg-vue-primary/30 rounded-vue text-sm whitespace-nowrap"
              >
                保存地址
              </button>
            </div>
            <div v-if="testEnvironmentUrl" class="text-xs text-green-400">
              ✅ 已配置环境: {{ testEnvironmentUrl }}
            </div>
          </div>
          
          <!-- 其他角色：用户输入 -->
          <div v-if="canInput && !executionLog" class="space-y-3">
            <textarea
              v-model="userInput"
              rows="4"
              class="w-full bg-vue-darker border border-vue-border rounded-vue px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-vue-primary resize-y min-h-[100px] max-h-[300px] overflow-auto"
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
                v-if="!isProductRole && currentIteration?.status === 'completed'"
                @click="rerunIteration"
                class="px-4 py-2 bg-yellow-600/20 border border-yellow-600/50 text-yellow-400 hover:bg-yellow-600/30 rounded-vue text-sm transition-all"
              >
                重新生成 🔄
              </button>
              <button
                @click="submitUserInput"
                :disabled="!userInput.trim()"
                class="px-4 py-2 bg-gradient-to-r from-vue-primary to-vue-secondary disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-vue text-sm font-medium transition-all hover:shadow-vue-glow"
              >
                确认输入 ✓
              </button>
            </div>
          </div>
          
          <div v-else-if="currentIteration?.userInput" class="text-white max-h-[300px] overflow-auto bg-vue-darker rounded-vue p-3">
            <pre class="text-sm whitespace-pre-wrap font-mono">{{ formatAsJson(currentIteration.userInput) }}</pre>
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
            <span v-if="currentIteration?.status === 'running'" class="ml-2 text-vue-primary">
              (步骤 {{ currentStepIndex + 1 }})
            </span>
          </div>
          
          <!-- Tester 角色：显示摘要 -->
          <div v-if="currentIteration?.role === 'tester' && testerSummary" class="space-y-3">
            <div v-if="testerSummary.type === 'environment'" class="bg-yellow-900/30 border border-yellow-700 rounded-vue p-4">
              <div class="flex items-center space-x-2 text-yellow-400">
                <span class="text-xl">⚠️</span>
                <span class="font-medium">{{ testerSummary.message }}</span>
              </div>
              <div class="mt-3 text-sm text-yellow-300/70">
                可选择"确认并继续"跳过运行时测试，或补充环境地址后重新执行
              </div>
              <div class="mt-3 flex items-center space-x-2">
                <input
                  v-model="testEnvironmentUrl"
                  type="text"
                  placeholder="输入测试环境地址，如 http://localhost:3000"
                  class="flex-1 bg-vue-darker border border-vue-border rounded-vue px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-vue-primary"
                />
                <button
                  @click="saveEnvironmentUrl"
                  class="px-3 py-2 bg-vue-primary/20 border border-vue-primary/50 text-vue-primary hover:bg-vue-primary/30 rounded-vue text-sm"
                >
                  保存地址
                </button>
              </div>
              <button
                @click="skipAndContinue"
                class="mt-3 w-full px-4 py-2 bg-yellow-600/20 border border-yellow-600/50 text-yellow-400 hover:bg-yellow-600/30 rounded-vue text-sm font-medium transition-all"
              >
                确认并继续（跳过运行时测试）➡
              </button>
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
          
          <!-- 输出文件列表 -->
          <div v-else-if="currentIteration?.output || currentIteration?.status === 'running' || (isProductRole && currentIteration?.status === 'waiting_input')" class="space-y-4">
            <!-- 文件列表显示 -->
            <div class="space-y-3">
              <h3 class="text-gray-400 text-sm font-medium mb-4">
                📁 输出文件
                <span v-if="currentIteration?.status === 'running'" class="text-yellow-400 ml-2">(执行中...)</span>
              </h3>
              <div 
                v-for="file in currentOutputFiles" 
                :key="file.path"
                class="flex items-center justify-between bg-vue-darker rounded-vue p-3 border border-vue-border hover:border-vue-primary/50 transition-colors"
                :class="{ 'opacity-50': file.loading }"
              >
                <div class="flex items-center space-x-3">
                  <span v-if="file.loading" class="text-xl animate-spin">⏳</span>
                  <span v-else class="text-xl">{{ file.icon }}</span>
                  <div>
                    <div class="text-gray-200 text-sm font-medium">
                      {{ file.name }}
                      <span v-if="file.loading" class="text-yellow-400 text-xs ml-2">生成中...</span>
                      <span v-else-if="!file.exists && !file.loading" class="text-gray-500 text-xs ml-2">(未生成)</span>
                    </div>
                    <div class="text-gray-500 text-xs">{{ (file.source === 'project' ? projectBasePath : workspaceBasePath) + file.path }}</div>
                  </div>
                </div>
                <div class="flex space-x-2">
                  <button
                    v-if="file.exists && !file.loading"
                    @click="openPreview(file)"
                    class="px-3 py-1.5 bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 rounded text-xs transition-colors"
                  >
                    预览
                  </button>
                  <button
                    v-if="file.exists && !file.loading"
                    @click="openFile(file.path, file.source)"
                    class="px-3 py-1.5 bg-vue-primary/20 text-vue-primary hover:bg-vue-primary/30 rounded text-xs transition-colors"
                  >
                    打开
                  </button>
                  <button
                    v-if="file.exists && !file.loading"
                    @click="downloadFile(file.path, file.source)"
                    class="px-3 py-1.5 bg-gray-600/20 text-gray-300 hover:bg-gray-600/40 rounded text-xs transition-colors"
                  >
                    下载
                  </button>
                  <span v-if="file.loading" class="px-3 py-1.5 text-gray-500 text-xs">
                    等待...
                  </span>
                  <span v-if="!file.exists && !file.loading" class="px-3 py-1.5 text-gray-600 text-xs">
                    -
                  </span>
                </div>
              </div>
            </div>
            
            <!-- 可编辑输出文本框 -->
            <div v-if="currentIteration?.status === 'completed'" class="mt-4 pt-4 border-t border-vue-border">
              <div class="flex items-center justify-between mb-2">
                <h3 class="text-gray-400 text-sm font-medium">
                  📝 输出内容（可编辑）
                </h3>
                <button
                  @click="saveEditedOutput"
                  class="px-3 py-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded text-xs transition-colors"
                >
                  保存修改
                </button>
              </div>
              <textarea
                v-model="editedOutput"
                rows="8"
                class="w-full bg-vue-darker border border-vue-border rounded-vue px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-vue-primary resize-y font-mono text-sm"
                placeholder="Agent 输出内容，可在此修改..."
              ></textarea>
            </div>
            
            <!-- 执行中状态 -->
            <div v-if="currentIteration?.status === 'running'" class="text-center py-4">
              <div class="animate-spin w-8 h-8 border-2 border-vue-primary border-t-transparent rounded-full mx-auto mb-3"></div>
              <p class="text-gray-400">Agent 正在执行...</p>
              <div v-if="progressLog" class="mt-3 text-vue-primary text-sm animate-pulse">
                {{ progressLog }}
              </div>
            </div>
            
            <!-- 确认/重新生成按钮 -->
            <div v-if="canConfirm" class="flex justify-end space-x-3 pt-4 border-t border-vue-border">
              <button
                v-if="currentIteration?.status !== 'running'"
                @click="rerunIteration"
                class="px-4 py-2 bg-yellow-600/20 border border-yellow-600/50 text-yellow-400 hover:bg-yellow-600/30 rounded-vue text-sm transition-all"
              >
                重新生成 🔄
              </button>
              <button
                @click="confirmOutput"
                :disabled="currentIteration?.status === 'running'"
                :class="currentIteration?.status === 'running' 
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-vue-primary to-vue-secondary text-white hover:shadow-vue-glow'"
                class="px-4 py-2 rounded-vue text-sm font-medium transition-all"
              >
                {{ currentIteration?.status === 'running' ? '执行中...' : (isProductRole && currentIteration?.status === 'waiting_input' ? '开始执行 ✓' : '确认输出 ✓') }}
              </button>
            </div>
          </div>
          <div v-else-if="currentIteration?.status === 'running'" class="text-center py-4">
            <div class="animate-spin w-8 h-8 border-2 border-vue-primary border-t-transparent rounded-full mx-auto mb-3"></div>
            <p class="text-gray-400">Agent 正在执行...</p>
            <div v-if="progressLog" class="mt-3 text-vue-primary text-sm animate-pulse">
              {{ progressLog }}
            </div>
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

    <!-- 预览弹窗 -->
    <div v-if="showPreview" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closePreview"></div>
      <div class="relative bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl mx-4 h-[80vh] flex flex-col border border-vue-border">
        <!-- 头部 -->
        <div class="flex items-center justify-between p-4 border-b border-vue-border">
          <div class="flex items-center space-x-3">
            <span class="text-2xl">{{ previewFile?.icon }}</span>
            <div>
              <h3 class="text-lg font-semibold text-white">{{ previewFile?.name }}</h3>
              <p class="text-xs text-gray-500">{{ previewFile?.path }}</p>
            </div>
          </div>
          <div class="flex space-x-2">
            <button
              @click="downloadFile(previewFile?.path)"
              class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
            >
              下载
            </button>
            <button
              @click="closePreview"
              class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
            >
              关闭
            </button>
          </div>
        </div>
        <!-- 内容 -->
        <div class="flex-1 overflow-auto p-4">
          <div v-if="previewLoading" class="flex items-center justify-center h-full">
            <div class="animate-spin w-8 h-8 border-2 border-vue-primary border-t-transparent rounded-full"></div>
          </div>
          <div v-else-if="previewError" class="flex items-center justify-center h-full">
            <div class="text-center">
              <div class="text-4xl mb-4">❌</div>
              <p class="text-red-400">{{ previewError }}</p>
            </div>
          </div>
          <pre v-else class="text-gray-300 text-sm whitespace-pre-wrap font-mono">{{ previewContent }}</pre>
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
const editedOutput = ref('')
const showCancelConfirm = ref(false)
const showCopySuccess = ref(false)
const progressLog = ref('')
const showOutputPreview = ref(false)

// 预览弹窗状态
const showPreview = ref(false)
const previewFile = ref(null)
const previewContent = ref('')
const previewLoading = ref(false)
const previewError = ref('')

// Tester 环境地址
const testEnvironmentUrl = ref('')

// 当前步骤索引（用于步骤执行）
const currentStepIndex = ref(0)

// 执行记录数据
const executionLog = ref(null)

// 上一角色的输出（作为当前角色的输入）
const previousOutput = computed(() => {
  if (selectedIterationIndex.value === null || selectedIterationIndex.value === 0) return null
  const prevIteration = sprint.value?.iterations[selectedIterationIndex.value - 1]
  return prevIteration?.output || null
})

// 加载上一角色的执行记录
async function loadExecutionLog() {
  if (selectedIterationIndex.value === null || selectedIterationIndex.value === 0) {
    executionLog.value = null
    return
  }
  
  const prevRoleIndex = selectedIterationIndex.value - 1
  const prevIteration = sprint.value?.iterations[prevRoleIndex]
  const role = prevIteration?.role
  
  if (!role) {
    executionLog.value = null
    return
  }
  
  try {
    const paddedIndex = String(prevRoleIndex + 1).padStart(2, '0')
    const baseUrl = import.meta.env.VITE_API_BASE || 'http://localhost:3000'
    const response = await fetch(`${baseUrl}/api/sprints/${props.sprintId}/file?file=execution-log/${paddedIndex}-${role}.json`)
    if (response.ok) {
      const data = await response.json()
      // API 返回格式: { type: 'file', content: '...' }
      if (data.type === 'file' && data.content) {
        executionLog.value = JSON.parse(data.content)
      } else {
        executionLog.value = data
      }
    } else {
      executionLog.value = null
    }
  } catch (e) {
    console.log('加载执行记录失败:', e)
    executionLog.value = null
  }
}

// 是否是 Tester 角色
const isTesterRole = computed(() => currentIteration.value?.role === 'tester')

const currentIteration = computed(() => {
  if (selectedIterationIndex.value === null) return null
  return sprint.value?.iterations[selectedIterationIndex.value]
})

// 当前 iteration 是否可以确认（必须在完成状态且有输出）
const canConfirm = computed(() => {
  const iter = currentIteration.value
  if (!iter) return false
  // Product 角色在 waiting_input 状态时也可以确认执行
  if (iter.role === 'product' && iter.status === 'waiting_input') {
    return true
  }
  return iter.status === 'completed' && iter.output && iter.output.trim().length > 0
})

// Product 角色特殊处理：不需要额外输入，直接使用冲刺需求
const isProductRole = computed(() => currentIteration.value?.role === 'product')

// 是否可以输入（角色处于可执行状态）
const canInput = computed(() => {
  const iter = currentIteration.value
  if (!iter) return false
  // 状态为 waiting_input/ready/pending 且有用户输入时可以执行
  return ['waiting_input', 'ready', 'pending'].includes(iter.status) && 
         iter.userInput && iter.userInput.trim().length > 0
})

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
  store.socket.on('iteration:completed', ({ sprintId }) => {
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
  
  // 监听实时进度
  store.socket.on('agent:progress', ({ message }) => {
    progressLog.value = message
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
    tech_coach: '输入需要特别关注的可行性点...',
    developer: '输入对开发的特殊要求...',
    tester: '输入对测试的特殊要求...',
    ops: '输入对部署的特殊要求...',
    evolver: '输入优化建议...'
  }
  return placeholders[role] || '输入你的需求或反馈...'
}

async function submitUserInput() {
  // Product 角色：使用冲刺需求作为输入
  // 其他角色：使用上一角色的输出作为输入
  const input = isProductRole.value 
    ? (sprint.value?.rawInput || '') 
    : (previousOutput.value || '')
  
  if (!input.trim()) return
  
  await store.inputIteration(props.sprintId, selectedIterationIndex.value, input)
  await store.fetchSprint(props.sprintId)
  
  // 重置步骤索引，从第 0 步开始执行
  currentStepIndex.value = 0
  await store.executeIteration(props.sprintId, selectedIterationIndex.value, currentStepIndex.value)
}

async function saveEditedOutput() {
  try {
    await store.updateIterationOutput(props.sprintId, selectedIterationIndex.value, editedOutput.value)
    alert('保存成功！')
  } catch (e) {
    console.error('保存失败:', e)
    alert('保存失败: ' + e.message)
  }
}

async function confirmOutput() {
  const currentIndex = selectedIterationIndex.value
  const currentOutput = editedOutput.value || sprint.value?.iterations[currentIndex]?.output || ''
  
  try {
    // 传递当前输出以实现双向同步
    const result = await store.confirmIteration(props.sprintId, currentIndex, currentOutput)
    if (!result) {
      alert('确认失败，请重试')
      return
    }
    await store.fetchSprint(props.sprintId)
    
    // 自动选择下一个角色并执行
    const nextIndex = currentIndex + 1
    if (nextIndex < sprint.value?.iterations.length) {
      selectedIterationIndex.value = nextIndex
      
      const prevOutput = sprint.value?.iterations[currentIndex]?.output || ''
      userInput.value = prevOutput
      
      // 重置步骤索引，从第 0 步开始
      currentStepIndex.value = 0
      
      // 自动执行下一角色
      await store.executeIteration(props.sprintId, nextIndex, 0)
    }
  } catch (e) {
    console.error('确认输出失败:', e)
    alert('确认失败: ' + e.message)
  }
}

async function rerunIteration() {
  await store.rerunIteration(props.sprintId, selectedIterationIndex.value)
  // 触发 Agent 重新执行，使用当前步骤索引
  await store.executeIteration(props.sprintId, selectedIterationIndex.value, currentStepIndex.value)
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

async function copySprintId() {
  const text = sprint.value?.id || ''
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    showCopySuccess.value = true
    setTimeout(() => { showCopySuccess.value = false }, 2000)
  } catch (e) {
    console.error('复制失败:', e)
  }
}

async function saveEnvironmentUrl() {
  if (!testEnvironmentUrl.value.trim()) {
    alert('请输入环境地址')
    return
  }
  try {
    await store.updateEnvironment(props.sprintId, selectedIterationIndex.value, testEnvironmentUrl.value.trim())
    alert('环境地址已保存')
  } catch (e) {
    console.error('保存环境地址失败:', e)
    alert('保存失败: ' + e.message)
  }
}

async function skipAndContinue() {
  await confirmOutput()
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

function formatOutput(output) {
  if (!output) return ''
  // 直接返回，不做过滤，让后端处理
  return output
}

function formatAsJson(input) {
  if (!input) return ''
  
  // 尝试直接解析整个输入
  try {
    const parsed = JSON.parse(input)
    return JSON.stringify(parsed, null, 2)
  } catch {}
  
  // 尝试提取 JSON 代码块
  const jsonBlockMatch = input.match(/```json\n?([\s\S]*?)```/i)
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1])
      return JSON.stringify(parsed, null, 2)
    } catch {}
  }
  
  // 如果都不是，返回原始文本
  return input
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

// 输出文件列表配置
const outputFilesConfig = {
  gatekeeper: [
    { name: '路由决策', icon: '🚪', path: 'output/route-decision.md', source: 'sprint' }
  ],
  product: [
    { name: '用户画像', icon: '👤', path: 'product/user-personas.md', source: 'sprint' },
    { name: '用户故事', icon: '📝', path: 'product/user-stories.md', source: 'sprint' },
    { name: '功能清单', icon: '✅', path: 'product/functional-requirements.md', source: 'sprint' },
    { name: '界面布局', icon: '🎨', path: 'product/ui-layout.md', source: 'sprint' },
    { name: '交互流程', icon: '🔀', path: 'product/user-journey.md', source: 'sprint' },
    { name: 'PRD 文档', icon: '📋', path: 'product/prd.md', source: 'sprint' }
  ],
  architect: [
    { name: '系统架构', icon: '🏗️', path: 'architect/architecture.md', source: 'sprint' },
    { name: 'API 设计', icon: '📡', path: 'output/architect-step2.md', source: 'sprint' },
    { name: '数据库设计', icon: '🗄️', path: 'output/architect-step3.md', source: 'sprint' },
    { name: 'OpenSpec Changes', icon: '📋', path: 'openspec/changes/', source: 'project', category: 'dir' }
  ],
  tech_coach: [
    { name: '技术实现文档', icon: '📝', path: 'tech-coach/tech-implementation.md', source: 'sprint' },
    { name: '用户故事', icon: '📖', path: 'output/user-stories.md', source: 'sprint' },
    { name: '技术可行性', icon: '🔍', path: 'output/tech-feasibility.md', source: 'sprint' }
  ],
  developer: [
    { name: 'README', icon: '📖', path: 'src/README.md', source: 'project' },
    { name: 'API 文档', icon: '📚', path: 'src/API.md', source: 'project' },
    { name: '前端代码', icon: '💻', path: 'src/frontend/', source: 'project', category: 'dir' },
    { name: '后端代码', icon: '⚙️', path: 'src/backend/', source: 'project', category: 'dir' }
  ],
  tester: [
    { name: '测试用例', icon: '📝', path: 'tester/test-cases.md', source: 'sprint' },
    { name: '测试结果', icon: '📊', path: 'tester/test-results.md', source: 'sprint' },
    { name: '安全扫描', icon: '🔒', path: 'tester/security-scan.md', source: 'sprint' },
    { name: '测试报告', icon: '🧪', path: 'tester/test-report.md', source: 'sprint' },
    { name: '安全报告', icon: '🛡️', path: 'tester/security-report.md', source: 'sprint' }
  ],
  ops: [
    { name: '部署配置', icon: '⚙️', path: 'ops/ops-config.md', source: 'sprint' },
    { name: 'Dockerfile', icon: '🐳', path: 'ops/Dockerfile', source: 'sprint' },
    { name: 'Docker Compose', icon: '📦', path: 'ops/docker-compose.yml', source: 'sprint' }
  ],
  ghost: [
    { name: '安全审计', icon: '👻', path: 'ghost/security-report.md', source: 'sprint' }
  ],
  evolver: [
    { name: '重构建议', icon: '🔄', path: 'evolver/evolver-report.md', source: 'sprint' }
  ],
  creative: [
    { name: '设计评审', icon: '🎨', path: 'output/design-review.md', source: 'sprint' }
  ]
}

// 实际存在的文件列表
const existingFiles = ref([])

// 加载实际文件列表
async function loadExistingFiles() {
  if (!props.sprintId) return
  const files = await store.fetchSprintFiles(props.sprintId)
  existingFiles.value = files
}

const currentOutputFiles = computed(() => {
  const role = currentIteration.value?.role
  const iterationStatus = currentIteration.value?.status
  if (!role || !outputFilesConfig[role]) return []
  
  // 如果正在执行，显示所有文件为 loading 状态
  if (iterationStatus === 'running') {
    return outputFilesConfig[role].map(f => ({
      ...f,
      exists: false,
      loading: true
    }))
  }
  
  // 正常状态：根据实际存在返回
  return outputFilesConfig[role].map(f => {
    const exists = existingFiles.value.some(ef => ef.path === f.path)
    return {
      ...f,
      exists,
      loading: false
    }
  })
})

// 当 sprint 刷新时重新加载文件
watch(() => sprint.value?.status, (newStatus) => {
  if (newStatus === 'running') {
    loadExistingFiles()
  }
})

// 当切换迭代器时重新加载文件
watch(() => selectedIterationIndex.value, () => {
  loadExistingFiles()
  // 加载 Tester 的环境地址
  if (isTesterRole.value) {
    testEnvironmentUrl.value = currentIteration.value?.testEnvironmentUrl || ''
  }
  // 加载上一角色的执行记录
  loadExecutionLog()
  // 重置步骤索引
  currentStepIndex.value = 0
  // 重置输出预览状态
  showOutputPreview.value = false
})

// 当输出变化时更新可编辑文本框
watch(() => currentIteration.value?.output, (newOutput) => {
  editedOutput.value = newOutput || ''
}, { immediate: true })

// 初始加载
onMounted(() => {
  loadExistingFiles()
})

const workspaceBasePath = computed(() => {
  return `/Users/jialin.chen/WorkSpace/DevForge/workspace/${props.sprintId}/`
})

const projectBasePath = computed(() => {
  const projectId = sprint.value?.projectId || props.sprintId
  return `/Users/jialin.chen/WorkSpace/DevForge/projects/${projectId}/`
})

function getFileUrl(filePath, source) {
  const base = source === 'project' ? projectBasePath.value : workspaceBasePath.value
  return `file://${base}${filePath}`
}

function openFile(filePath, source) {
  const url = getFileUrl(filePath, source)
  window.open(url, '_blank')
}

function downloadFile(filePath, source) {
  const url = getFileUrl(filePath, source)
  const link = document.createElement('a')
  link.href = url
  link.download = filePath.split('/').pop()
  link.click()
}

async function openPreview(file) {
  previewFile.value = file
  previewContent.value = ''
  previewError.value = ''
  previewLoading.value = true
  showPreview.value = true

  try {
    const baseUrl = import.meta.env.VITE_API_BASE || 'http://localhost:3000'
    const response = await fetch(`${baseUrl}/api/sprints/${props.sprintId}/file?file=${encodeURIComponent(file.path)}`)
    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Failed to load file')
    }
    const data = await response.json()
    if (data.type === 'directory') {
      previewContent.value = JSON.stringify(data.tree, null, 2)
    } else {
      previewContent.value = data.content
    }
  } catch (e) {
    previewError.value = e.message || '加载失败'
  } finally {
    previewLoading.value = false
  }
}

function closePreview() {
  showPreview.value = false
  previewFile.value = null
  previewContent.value = ''
  previewError.value = ''
}
</script>