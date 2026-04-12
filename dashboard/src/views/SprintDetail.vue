<template>
  <div v-if="sprint" class="sprint-detail">
    <!-- Header -->
    <div class="sprint-header">
      <div class="header-left">
        <el-button text @click="$emit('back')" class="back-btn">
          <el-icon><ArrowLeft /></el-icon>
        </el-button>
        <div class="header-info">
          <h2 class="sprint-title">{{ sprint.name }}</h2>
          <div class="header-meta">
            <el-tag :type="getStatusType(sprint.status)" size="small" effect="dark">
              {{ getStatusText(sprint.status) }}
            </el-tag>
            <el-tag v-if="scenarioLabel" type="info" size="small" effect="plain">
              {{ scenarioLabel.title }}
            </el-tag>
            <span class="sprint-id">{{ sprint.id.slice(0, 12) }}</span>
          </div>
        </div>
      </div>
      <div class="header-actions">
        <el-button v-if="sprint.status === 'pending'" type="primary" @click="startSprint">
          开始冲刺 <el-icon><VideoPlay /></el-icon>
        </el-button>
        <el-button v-if="sprint.status === 'running'" type="danger" plain @click="showCancelConfirm = true">
          取消冲刺
        </el-button>
      </div>
    </div>

    <!-- 执行流程 -->
    <div class="execution-flow">
      <h3 class="section-title">执行流程</h3>
      <div class="pipeline-steps" role="list">
        <div
          v-for="(stage, index) in pipelineStages"
          :key="stage.id"
          class="pipeline-step"
          :class="{
            'is-active': activeStageIndex === index,
            'is-current': currentStageIndex === index,
            'is-completed': stage.status === 'completed' || stage.status === 'confirmed',
            'is-failed': stage.status === 'failed',
            'is-running': stage.status === 'running'
          }"
          role="listitem"
        >
          <button
            type="button"
            class="pipeline-card"
            :disabled="!isStageAccessible(index)"
            @click="selectStage(index)"
          >
            <div class="pipeline-card-top">
              <div class="pipeline-badge">
                <el-icon v-if="stage.status === 'completed' || stage.status === 'confirmed'"><Check /></el-icon>
                <el-icon v-else-if="stage.status === 'failed'"><Close /></el-icon>
                <el-icon v-else-if="stage.status === 'running'"><Loading class="is-loading" /></el-icon>
                <span v-else>{{ stage.icon }}</span>
              </div>
              <div class="pipeline-title">
                <div class="pipeline-title-row">
                  <span class="pipeline-name">{{ stage.name }}</span>
                  <el-tag size="small" :type="getStageStatusType(stage.status)" effect="plain">
                    {{ getStageStatusText(stage.status) }}
                  </el-tag>
                </div>
                <div v-if="stage.agents?.length" class="pipeline-meta">
                  <div class="pipeline-meta-label">Agents</div>
                  <div class="pipeline-meta-items">
                    <span v-for="a in stageAgentsSorted(stage)" :key="a.role" class="pipeline-agent">
                      <span class="pipeline-agent-icon">{{ a.icon }}</span>
                      <span class="pipeline-agent-name">{{ a.name }}</span>
                    </span>
                  </div>
                </div>
                <div v-if="stage.skills?.length" class="pipeline-meta">
                  <div class="pipeline-meta-label">Skills</div>
                  <div class="pipeline-meta-items pipeline-skills" :title="stage.skills.join(', ')">
                    {{ formatStageSkills(stage.skills) }}
                  </div>
                </div>
              </div>
            </div>

            <div v-if="currentStageIndex === index" class="pipeline-current-indicator">
              当前管道
            </div>
          </button>

          <div v-if="index < pipelineStages.length - 1" class="pipeline-connector" aria-hidden="true">
            <div class="pipeline-connector-line"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 当前阶段详情 -->
    <div v-if="currentStage" class="stage-detail">
      <div class="stage-header">
        <div class="stage-header-left">
          <span class="stage-icon">{{ currentStage.icon }}</span>
          <div>
            <h3 class="stage-title">{{ currentStage.name }}</h3>
            <p class="stage-desc">{{ currentStage.description }}</p>
            <div v-if="currentStage.agents?.length" class="agents-row" style="margin-top: 8px;">
              <span
                v-for="a in stageAgentsSorted(currentStage)"
                :key="a.role"
                class="agent-chip"
              >
                <span class="agent-icon">{{ a.icon }}</span>
                <span class="agent-name">{{ a.name }}</span>
              </span>
            </div>
            <div v-if="currentStage.skills?.length" class="skills-row" style="margin-top: 6px;">
              <el-tag
                v-for="sk in currentStage.skills"
                :key="sk"
                size="small"
                effect="plain"
                class="skill-tag"
              >
                {{ sk }}
              </el-tag>
            </div>
          </div>
        </div>
        <div class="stage-actions">
          <el-button 
            v-if="!isDeveloperStageSelected" 
            type="primary" 
            :loading="isExecuting"
            @click="executeCurrentStage"
          >
            <el-icon><VideoPlay /></el-icon> 执行当前阶段
          </el-button>
          <el-button 
            v-if="!isDeveloperStageSelected && getRerunIterationForStage(currentStage)"
            :loading="isExecuting"
            @click="rerunCurrentStage"
          >
            <el-icon><RefreshRight /></el-icon> 重新执行
          </el-button>
        </div>
      </div>

      <!-- 用户输入 -->
      <div v-if="currentIterationNeedsInput" class="user-input-section">
        <h4 class="detail-section-title">
          <el-icon><Edit /></el-icon>
          用户输入
        </h4>
        <el-input
          v-model="userInput"
          type="textarea"
          :rows="4"
          :placeholder="getInputPlaceholder()"
        />
        <div class="user-input-actions">
          <el-button type="primary" @click="confirmInput">
            确认并执行 <el-icon><Check /></el-icon>
          </el-button>
        </div>
      </div>

      <!-- 输出内容 -->
      <div v-if="selectedStageOutput" class="detail-section">
        <h4 class="detail-section-title">
          <el-icon><Document /></el-icon>
          Agent 输出
        </h4>
        <el-input
          v-model="editableOutput"
          type="textarea"
          :rows="12"
          placeholder="Agent 输出内容..."
          class="output-textarea"
        />
        <div class="output-actions">
          <el-button @click="copyOutput">
            <el-icon><CopyDocument /></el-icon> 复制
          </el-button>
          <el-button type="success" @click="confirmAndNextStage">
            <el-icon><Check /></el-icon> 确认输出，进入下一阶段
          </el-button>
        </div>
      </div>

      <!-- Developer Task Console（仅 Developer 阶段，显示在 Agent 输出之后） -->
      <div v-if="isDeveloperStageSelected" class="detail-section developer-task-console">
        <h4 class="detail-section-title">
          <el-icon><Connection /></el-icon>
          Developer Task Console（手动逐条 + Diff）
        </h4>

        <div class="developer-console-top">
          <div class="developer-console-stat">
            <span class="label">当前游标</span>
            <strong>{{ developerTaskState?.cursor || 1 }} / {{ developerTaskState?.totalTasks || 0 }}</strong>
          </div>
          <div class="developer-console-stat" v-if="developerTaskState?.currentTask">
            <span class="label">当前任务</span>
            <span class="value">{{ developerTaskState.currentTask.text }}</span>
          </div>
          <div class="developer-console-actions">
            <el-button
              type="primary"
              :loading="developerTaskExecuting"
              :disabled="isExecuting || developerRoleIndex === null"
              @click="executeNextDeveloperTask"
            >
              <el-icon><VideoPlay /></el-icon> 执行下一条
            </el-button>
            <el-button :loading="developerTaskLoading" @click="loadDeveloperTaskConsole">
              刷新
            </el-button>
          </div>
        </div>

        <div class="developer-console-body">
          <div class="run-list">
            <div class="run-list-title">执行记录</div>
            <div class="run-list-items">
              <button
                v-for="run in developerTaskRuns"
                :key="run.taskIndex"
                class="run-item"
                :class="{
                  active: selectedTaskRunIndex === run.taskIndex,
                  fail: run.status === 'TASK_FAIL',
                  warn: run.status === 'TASK_WARN'
                }"
                @click="selectDeveloperTaskRun(run.taskIndex)"
              >
                <span class="idx">#{{ run.taskIndex }}</span>
                <span class="status">{{ run.status?.replace('TASK_', '') || 'END' }}</span>
                <span class="title">{{ run.title }}</span>
              </button>
            </div>
          </div>

          <div class="run-detail" v-if="selectedTaskRunDetail">
            <div class="run-detail-head">
              <div>
                <strong>#{{ selectedTaskRunDetail.taskIndex }} {{ selectedTaskRunDetail.title }}</strong>
                <div class="meta">
                  <el-tag size="small" :type="selectedTaskRunDetail.status === 'TASK_FAIL' ? 'danger' : selectedTaskRunDetail.status === 'TASK_WARN' ? 'warning' : 'success'">
                    {{ selectedTaskRunDetail.status }}
                  </el-tag>
                  <el-tag size="small" effect="plain">risk={{ selectedTaskRunDetail.riskLevel }}</el-tag>
                  <el-tag size="small" effect="plain">files={{ selectedTaskRunDetail.files?.length || 0 }}</el-tag>
                </div>
              </div>
            </div>

            <div class="run-detail-error" v-if="selectedTaskRunDetail.errorCode">
              <el-alert :title="`${selectedTaskRunDetail.errorCode}: ${selectedTaskRunDetail.message || ''}`" type="warning" :closable="false" />
            </div>

            <div class="run-files" v-if="selectedTaskRunDetail.files?.length">
              <div class="run-files-list">
                <button
                  v-for="f in selectedTaskRunDetail.files"
                  :key="f.relPath"
                  class="run-file"
                  :class="{ active: selectedTaskRunFilePath === f.relPath }"
                  @click="selectedTaskRunFilePath = f.relPath"
                >
                  {{ f.relPath }}
                </button>
              </div>
              <div class="run-files-diff">
                <pre class="diff-pre"><span v-for="(line, i) in selectedTaskRunDiffLines" :key="i" :class="`diff-${line.type}`">{{ line.text }}
</span></pre>
              </div>
            </div>
            <div v-else class="run-no-files">该任务无文件写入（可能 NO_CHANGE）。</div>
          </div>
        </div>
      </div>

      <div v-if="selectedStageTaskMetrics.total > 0" class="detail-section">
        <h4 class="detail-section-title">
          <el-icon><CircleCheckFilled /></el-icon>
          任务落盘指标
        </h4>
        <div class="task-metrics-cards">
          <div class="task-metric-card">
            <div class="task-metric-label">任务总数</div>
            <div class="task-metric-value">{{ selectedStageTaskMetrics.total }}</div>
          </div>
          <div class="task-metric-card success">
            <div class="task-metric-label">成功</div>
            <div class="task-metric-value">{{ selectedStageTaskMetrics.success }}</div>
          </div>
          <div class="task-metric-card danger">
            <div class="task-metric-label">失败</div>
            <div class="task-metric-value">{{ selectedStageTaskMetrics.failed }}</div>
          </div>
          <div class="task-metric-card warning">
            <div class="task-metric-label">高风险任务</div>
            <div class="task-metric-value">{{ selectedStageTaskMetrics.highRisk }}</div>
          </div>
        </div>

        <div class="task-metrics-warning" v-if="selectedStageTaskMetrics.failed > 0">
          <el-tag v-if="selectedStageTaskMetrics.noFileBlocks > 0" type="danger" effect="plain">
            NO_FILE_BLOCKS × {{ selectedStageTaskMetrics.noFileBlocks }}
          </el-tag>
          <el-tag v-if="selectedStageTaskMetrics.writeZero > 0" type="danger" effect="plain">
            WRITE_ZERO × {{ selectedStageTaskMetrics.writeZero }}
          </el-tag>
          <el-tag v-if="selectedStageTaskMetrics.missingTests > 0" type="warning" effect="plain">
            MISSING_TEST_FILE_BLOCKS × {{ selectedStageTaskMetrics.missingTests }}
          </el-tag>
        </div>

        <div class="task-metrics-table-wrap" v-if="selectedStageTaskMetrics.items.length">
          <div class="task-metrics-table-actions">
            <el-switch
              v-model="showOnlyFailedTaskMetrics"
              size="small"
              active-text="只看失败"
              inactive-text="全部"
            />
          </div>
          <table class="task-metrics-table">
            <thead>
              <tr>
                <th>状态</th>
                <th>风险</th>
                <th>fileBlocks</th>
                <th>written</th>
                <th>错误码</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in filteredStageTaskMetricItems" :key="item.id">
                <td>
                  <el-tag :type="item.ok ? 'success' : 'danger'" size="small" effect="dark">
                    {{ item.ok ? 'OK' : 'FAIL' }}
                  </el-tag>
                </td>
                <td>{{ item.risk }}</td>
                <td>{{ item.fileBlocks }}</td>
                <td>{{ item.written }}</td>
                <td>{{ item.errorCode || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 输出文件列表（预期路径 + 固定说明） -->
      <div v-if="currentStage?.outputFiles?.length > 0" class="detail-section">
        <h4 class="detail-section-title">
          <el-icon><Folder /></el-icon>
          输出文件（预期）
        </h4>
        <ul class="output-files-list">
          <li
            v-for="file in currentStage.outputFiles"
            :key="file.path"
            class="output-file-row"
            :class="{ 'file-exists': file.exists }"
          >
            <div class="output-file-main">
              <div class="output-file-title-row">
                <el-icon v-if="file.isDir" class="output-file-icon"><Folder /></el-icon>
                <el-icon v-else class="output-file-icon"><Document /></el-icon>
                <span class="file-name">{{ file.name }}</span>
                <code class="file-path">{{ file.path }}</code>
              </div>
              <p class="file-description">
                {{ file.description || '该路径在冲刺 workspace 中的预期产出说明。' }}
              </p>
            </div>
            <div class="file-actions">
              <el-button
                text
                size="small"
                @click.stop="openPreview({ ...file, path: file.path })"
                title="预览"
              >
                <el-icon><View /></el-icon>
              </el-button>
              <el-button
                text
                size="small"
                @click.stop="openFileInBrowser(file.path, 'sprint')"
                title="打开"
              >
                <el-icon><TopRight /></el-icon>
              </el-button>
              <el-button
                text
                size="small"
                @click.stop="downloadFile(file.path, 'sprint')"
                title="下载"
              >
                <el-icon><Download /></el-icon>
              </el-button>
            </div>
          </li>
        </ul>
      </div>

      <!-- 历史记录 -->
      <div v-if="selectedStageHistory.length > 0" class="detail-section">
        <h4 class="detail-section-title">
          <el-icon><Clock /></el-icon>
          历史记录
        </h4>
        <el-timeline>
          <el-timeline-item
            v-for="(item, index) in selectedStageHistory"
            :key="index"
            :timestamp="formatTime(item.timestamp)"
            placement="top"
          >
            <el-card size="small" class="history-card">
              <p class="history-text">{{ item.output || '执行中...' }}</p>
            </el-card>
          </el-timeline-item>
        </el-timeline>
      </div>
    </div>

    <!-- 预览弹窗 -->
    <el-dialog
      v-model="previewVisible"
      :title="previewFile?.name || '文件预览'"
      width="80%"
      :before-close="closePreview"
    >
      <div v-if="previewLoading" class="preview-loading">
        <el-icon class="is-loading" size="40"><Loading /></el-icon>
        <p>加载中...</p>
      </div>
      <div v-else-if="previewError" class="preview-error">
        <p style="color: #f56c6c;">{{ previewError }}</p>
      </div>
      <pre v-else class="preview-content">{{ previewContent }}</pre>
      <template #footer>
        <div class="preview-footer">
          <el-button @click="closePreview">关闭</el-button>
          <el-button v-if="previewFile" @click="downloadFile(previewFile.path, 'sprint')">
            <el-icon><Download /></el-icon> 下载
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useProjectStore } from '../stores/project'
import {
  ROUTES,
  SCENARIO_LABELS,
  getStagesForScenario,
  getRerunStepOptions
} from '../config/sprintStageConfig.js'
import { parseTaskExecutionMetrics } from '../utils/taskMetrics.js'
import { ElMessage } from 'element-plus'
import { 
  VideoPlay, Document, Connection, CircleCheck, Loading, 
  ArrowLeft, RefreshRight, CircleCheckFilled, CopyDocument,
  Close, Edit, Folder, Clock, Minus, CircleClose,
  View, TopRight, Download, Check
} from '@element-plus/icons-vue'

const props = defineProps({
  sprintId: { type: String, required: true }
})

const emit = defineEmits(['back'])

const store = useProjectStore()
const sprint = ref(null)
const activeStageIndex = ref(0)
const selectedStage = ref(null)
const userInput = ref('')
const editableOutput = ref('')
const isExecuting = ref(false)
const showOnlyFailedTaskMetrics = ref(false)
/** 分步重跑：各角色当前选中的 stepIndex（与后端一致，0 起） */
const partialStepByRole = ref({})
/** 正在执行的分步重跑 `role-stepIndex`，用于按钮 loading */
const partialRerunLoading = ref('')
const markStageRecoveryLoading = ref(false)

/** 代码开发：opencode | cursor_auto，与 sprint.developerBackend 同步 */
const developerBackendChoice = ref('opencode')

// 预览相关状态
const previewFile = ref(null)
const previewContent = ref('')
const previewLoading = ref(false)
const previewError = ref('')
const previewVisible = ref(false)
const developerTaskState = ref(null)
const developerTaskRuns = ref([])
const selectedTaskRunIndex = ref(null)
const selectedTaskRunDetail = ref(null)
const selectedTaskRunFilePath = ref('')
const developerTaskLoading = ref(false)
const developerTaskExecuting = ref(false)
const showCancelConfirm = ref(false)

const currentIterationNeedsInput = computed(() => {
  const stage = currentStage.value
  if (!stage) return false
  const sorted = sortStageIterationsByPipeline(stage.iterations || [])
  const nextToRun = sorted.find(i => ['waiting_input', 'ready'].includes(i.status))
  return !!nextToRun
})

const scenarioLabel = computed(() => {
  const sc = sprint.value?.scenario || 'BUILD'
  return SCENARIO_LABELS[sc] || SCENARIO_LABELS.BUILD
})

const showDeveloperBackendPicker = computed(() => {
  const roles = sprint.value?.roles
  return Array.isArray(roles) && roles.includes('developer')
})

const isDeveloperStageSelected = computed(() => {
  const stage = currentStage.value
  return !!stage?.agents?.some(a => a.role === 'developer')
})

const developerRoleIndex = computed(() => {
  const idx = sprint.value?.iterations?.findIndex(i => i.role === 'developer')
  return idx >= 0 ? idx : null
})

const selectedTaskRunFile = computed(() => {
  if (!selectedTaskRunDetail.value?.files?.length) return null
  const chosen = selectedTaskRunFilePath.value
  return selectedTaskRunDetail.value.files.find(f => f.relPath === chosen) || selectedTaskRunDetail.value.files[0]
})

function buildDiffLines(beforeText, afterText) {
  const a = String(beforeText || '').split('\n')
  const b = String(afterText || '').split('\n')
  const out = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const left = i < a.length ? a[i] : null
    const right = j < b.length ? b[j] : null
    if (left !== null && right !== null && left === right) {
      out.push({ type: 'context', text: `  ${left}` })
      i++
      j++
      continue
    }
    if (left !== null && (j + 1 < b.length) && left === b[j + 1]) {
      out.push({ type: 'add', text: `+ ${b[j]}` })
      j++
      continue
    }
    if (right !== null && (i + 1 < a.length) && a[i + 1] === right) {
      out.push({ type: 'remove', text: `- ${a[i]}` })
      i++
      continue
    }
    if (left !== null) {
      out.push({ type: 'remove', text: `- ${left}` })
      i++
    }
    if (right !== null) {
      out.push({ type: 'add', text: `+ ${right}` })
      j++
    }
  }
  return out
}

const selectedTaskRunDiffLines = computed(() => {
  const file = selectedTaskRunFile.value
  if (!file) return []
  return buildDiffLines(file.beforeContent, file.afterContent)
})

function formatStageSkills(skills) {
  const list = Array.isArray(skills) ? skills : []
  if (list.length <= 2) return list.join(', ')
  return `${list.slice(0, 2).join(', ')} +${list.length - 2}`
}

watch(
  () => sprint.value?.developerBackend,
  (v) => {
    if (v === 'cursor_auto' || v === 'opencode') {
      developerBackendChoice.value = v
    }
  },
  { immediate: true }
)

function getPipelineRoleOrder() {
  const r = sprint.value?.roles
  if (r && r.length) return r
  const sc = sprint.value?.scenario || 'BUILD'
  return ROUTES[sc] || ROUTES.BUILD
}

function roleOrderIndex(role) {
  const order = getPipelineRoleOrder()
  const i = order.indexOf(role)
  return i === -1 ? 999 : i
}

function resolveRoleIndex(iteration) {
  if (!iteration || !sprint.value?.iterations?.length) return 0
  if (typeof iteration.roleIndex === 'number') return iteration.roleIndex
  const idx = sprint.value.iterations.findIndex(
    i => i.role?.toLowerCase() === iteration.role?.toLowerCase()
  )
  return idx >= 0 ? idx : 0
}

function sortStageIterationsByPipeline(stageIterations) {
  if (!stageIterations?.length) return []
  return [...stageIterations].sort(
    (a, b) => roleOrderIndex(a.role) - roleOrderIndex(b.role)
  )
}

/** 本阶段内下一个应执行的角色（流水线顺序，且 tech_coach 先于 architect） */
function getExecutableIterationForStage(stage) {
  if (!sprint.value?.iterations?.length || !stage?.agents?.length) return null

  // 不依赖 stage.iterations（它可能因为映射/状态同步问题为空），直接用 stage.agents 去 sprint.iterations 里定位
  const agents = stageAgentsSorted(stage)
  const stageRoles = new Set(agents.map(a => String(a.role || '').toLowerCase()).filter(Boolean))
  for (const a of agents) {
    const it = sprint.value.iterations.find(
      i => (i.role || '').toLowerCase() === (a.role || '').toLowerCase()
    )
    if (!it) continue
    if (it.status === 'completed' || it.status === 'confirmed') continue
    // 含 running：交给 POST /execute，由后端区分僵死状态自愈与真实执行中(409)
    return it
  }

  // 兜底 1：如果 stage.iterations 映射到了内容（但上面的按 role 没对上），则从这里找
  const mapped = sortStageIterationsByPipeline(stage.iterations || [])
  for (const it of mapped) {
    if (!it) continue
    if (it.status === 'completed' || it.status === 'confirmed') continue
    return it
  }

  // 兜底 2：使用 sprint.currentRoleIndex（若该角色属于本 stage）
  const idx = sprint.value?.currentRoleIndex
  if (Number.isFinite(Number(idx)) && sprint.value.iterations[idx]) {
    const it = sprint.value.iterations[idx]
    const r = String(it.role || '').toLowerCase()
    if (stageRoles.has(r)) {
      if (it.status !== 'completed' && it.status !== 'confirmed') {
        return it
      }
    }
  }

  return null
}

function getRerunIterationForStage(stage) {
  const sorted = sortStageIterationsByPipeline(stage.iterations || [])
  for (let i = sorted.length - 1; i >= 0; i--) {
    const it = sorted[i]
    if (it?.status === 'failed') return it
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    const it = sorted[i]
    if (['completed', 'confirmed'].includes(it.status) || (it.output && it.output.trim())) {
      return it
    }
  }
  return sorted[sorted.length - 1] || null
}

function stageAgentsSorted(stage) {
  if (!stage?.agents) return []
  return [...stage.agents].sort(
    (a, b) => roleOrderIndex(a.role) - roleOrderIndex(b.role)
  )
}

/** 本阶段内每个角色都已「确认输出」（confirmed），才允许切到流程的下一阶段 */
function isStageFullyDone(stage) {
  const sorted = sortStageIterationsByPipeline(stage.iterations || [])
  if (!sorted.length) return false
  return sorted.every(i => i.status === 'confirmed')
}

/** 展示「整段标为已确认」恢复（本阶段尚未全部 confirmed 时） */
const showMarkStageRecovery = computed(() => {
  if (!sprint.value || sprint.value.status === 'pending') return false
  const stage = pipelineStages.value[activeStageIndex.value]
  if (!stage?.id || !stage.iterations?.length) return false
  return !isStageFullyDone(stage)
})

// ========== 阶段状态聚合 ==========
const pipelineStages = computed(() => {
  const cfg = getStagesForScenario(sprint.value?.scenario)
  if (!sprint.value) return cfg.map(s => ({ ...s, status: 'pending' }))

  const iterations = sprint.value.iterations || []

  return cfg.map(stage => {
    const stageIterations = sortStageIterationsByPipeline(
      stage.agents
        .map(agent => iterations.find(i => i.role?.toLowerCase() === agent.role?.toLowerCase()))
        .filter(Boolean)
    )

    let status = 'pending'
    if (stageIterations.length === 0) {
      status = 'pending'
    } else if (stageIterations.some(i => i.status === 'running')) {
      status = 'running'
    } else if (stageIterations.some(i => i.status === 'waiting_input')) {
      status = 'waiting_input'
    } else if (stageIterations.every(i => i.status === 'completed' || i.status === 'confirmed')) {
      status = 'completed'
    } else if (stageIterations.some(i => i.status === 'failed')) {
      status = 'failed'
    } else if (stageIterations.some(i => i.status === 'ready')) {
      status = 'waiting_input'
    }

    return {
      ...stage,
      status,
      iterations: stageIterations
    }
  })
})

/** 当前选中阶段内，按流水线顺序第一个有内容的 Agent 输出（只读，不在 computed 里写 editableOutput） */
const selectedStageOutput = computed(() => {
  if (!sprint.value?.iterations?.length) return null
  const stage = pipelineStages.value[activeStageIndex.value]
  if (!stage) return null
  for (const agent of stageAgentsSorted(stage)) {
    const iteration = sprint.value.iterations.find(
      i => (i.role || '').toLowerCase() === (agent.role || '').toLowerCase()
    )
    if (iteration?.output) return iteration.output
  }
  return null
})

// 当前阶段
const currentStage = computed(() => {
  return pipelineStages.value[activeStageIndex.value] || null
})

// 当前阶段索引（含 failed，避免开发失败后「当前管道」误指第一步）
const currentStageIndex = computed(() => {
  for (let i = pipelineStages.value.length - 1; i >= 0; i--) {
    const stage = pipelineStages.value[i]
    if (
      stage.status === 'completed' ||
      stage.status === 'running' ||
      stage.status === 'waiting_input' ||
      stage.status === 'failed'
    ) {
      return i
    }
  }
  return 0
})

// 获取 Agent 状态
function getAgentStatus(agent) {
  if (!sprint.value) return { status: 'pending' }
  const iteration = sprint.value.iterations?.find(
    i => i.role?.toLowerCase() === agent.role?.toLowerCase()
  )
  return {
    status: iteration?.status || 'pending',
    iteration
  }
}

// 获取当前工作中的 Agent
function getWorkingAgent(stage) {
  if (!sprint.value || !stage.agents) return null
  const runningAgent = stage.agents.find(agent => {
    const iteration = sprint.value.iterations?.find(
      i => i.role?.toLowerCase() === agent.role?.toLowerCase()
    )
    return iteration?.status === 'running'
  })
  return runningAgent || null
}

// 检查阶段是否可访问（上一阶段已完成/已确认/失败时均可进入，便于查看部署等；执行仍由后端串行校验）
function isStageAccessible(index) {
  if (index === 0) return true
  const prevStage = pipelineStages.value[index - 1]
  return ['completed', 'confirmed', 'failed'].includes(prevStage?.status)
}

function selectStage(index) {
  if (isStageAccessible(index)) {
    activeStageIndex.value = index
    selectedStage.value = index
  }
}

const selectedStageHistory = computed(() => {
  if (!sprint.value) return null
  const stageIndex = selectedStage.value !== null ? selectedStage.value : activeStageIndex.value
  const stage = pipelineStages.value[stageIndex]
  if (!stage) return []
  
  // 如果没有匹配到 iteration，直接从 sprint.iterations 查找
  if (stage.iterations.length === 0) {
    for (const agent of stage.agents) {
      const iteration = sprint.value.iterations?.find(i => i.role === agent.role)
      if (iteration?.history) return iteration.history
    }
    return []
  }
  
  return stage.iterations[0].history || []
})

const hasWaitingInput = computed(() => {
  if (!sprint.value) return false
  const stage = pipelineStages.value[activeStageIndex.value]
  if (!stage) return false
  return stage.status === 'waiting_input' || stage.status === 'pending'
})

const isStageRunning = computed(() => {
  if (!sprint.value) return false
  const stage = pipelineStages.value[activeStageIndex.value]
  return stage?.status === 'running'
})

const selectedStageTaskMetrics = computed(() => {
  if (!isDeveloperStageSelected.value) {
    return parseTaskExecutionMetrics('')
  }
  const output = editableOutput.value || selectedStageOutput.value || ''
  return parseTaskExecutionMetrics(output)
})

const filteredStageTaskMetricItems = computed(() => {
  if (!showOnlyFailedTaskMetrics.value) return selectedStageTaskMetrics.value.items
  return selectedStageTaskMetrics.value.items.filter(item => !item.ok && !item.warn)
})

async function loadDeveloperTaskConsole() {
  if (!props.sprintId || !isDeveloperStageSelected.value) return
  developerTaskLoading.value = true
  try {
    const [state, runs] = await Promise.all([
      store.fetchDeveloperState(props.sprintId),
      store.fetchDeveloperTaskRuns(props.sprintId)
    ])
    developerTaskState.value = state
    developerTaskRuns.value = runs.slice().sort((a, b) => (b.taskIndex || 0) - (a.taskIndex || 0))
    if (!selectedTaskRunIndex.value && developerTaskRuns.value.length > 0) {
      await selectDeveloperTaskRun(developerTaskRuns.value[0].taskIndex)
    }
  } finally {
    developerTaskLoading.value = false
  }
}

async function selectDeveloperTaskRun(taskIndex) {
  selectedTaskRunIndex.value = taskIndex
  const detail = await store.fetchDeveloperTaskRunDetail(props.sprintId, taskIndex)
  selectedTaskRunDetail.value = detail
  selectedTaskRunFilePath.value = detail?.files?.[0]?.relPath || ''
}

async function executeNextDeveloperTask() {
  if (!props.sprintId || developerRoleIndex.value === null) return
  developerTaskExecuting.value = true
  isExecuting.value = true
  try {
    await store.executeIteration(props.sprintId, developerRoleIndex.value, null, {
      developerBackend: developerBackendChoice.value
    })
    ElMessage.success('已启动下一条任务执行')
    await loadSprint()
    await loadDeveloperTaskConsole()
  } catch (e) {
    ElMessage.error(e.message || '执行失败')
  } finally {
    developerTaskExecuting.value = false
    isExecuting.value = false
  }
}

/** 当前阶段内支持「分步重跑」的角色（多步骤角色） */
const partialRerunAgents = computed(() => {
  const sc = sprint.value?.scenario || 'BUILD'
  const stage = pipelineStages.value[activeStageIndex.value]
  if (!stage?.agents) return []
  return stage.agents.filter(a => getRerunStepOptions(a.role, sc).length > 0)
})

watch(
  partialRerunAgents,
  agents => {
    const next = { ...partialStepByRole.value }
    for (const a of agents) {
      if (next[a.role] === undefined) {
        next[a.role] = a.role === 'architect' ? 4 : 0
      }
    }
    partialStepByRole.value = next
  },
  { immediate: true, deep: true }
)

function getIterationRoleIndex(role) {
  const r = (role || '').toLowerCase()
  const idx = sprint.value?.iterations?.findIndex(i => (i.role || '').toLowerCase() === r)
  return idx >= 0 ? idx : null
}

async function persistDeveloperBackend() {
  if (!sprint.value?.id) return
  const updated = await store.updateSprint(sprint.value.id, {
    developerBackend: developerBackendChoice.value
  })
  if (updated) {
    sprint.value = updated
    ElMessage.success('已保存代码开发引擎选项')
  }
}

async function markCurrentStageConfirmed() {
  const stage = pipelineStages.value[activeStageIndex.value]
  if (!stage?.id) return
  markStageRecoveryLoading.value = true
  try {
    await store.markStageConfirmed(props.sprintId, stage.id)
    ElMessage.success(`已标记「${stage.name}」为已确认，可继续下一阶段`)
    await loadSprint()
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  } finally {
    markStageRecoveryLoading.value = false
  }
}

async function executePartialRerun(role) {
  const ri = getIterationRoleIndex(role)
  if (ri === null) {
    ElMessage.error('未找到该角色的迭代')
    return
  }
  const stepIndex = partialStepByRole.value[role]
  if (stepIndex === undefined) {
    ElMessage.error('请选择步骤')
    return
  }
  const scenario = sprint.value?.scenario || 'BUILD'
  const opts = getRerunStepOptions(role, scenario)
  if (!opts.some(o => o.stepIndex === stepIndex)) {
    ElMessage.error('步骤无效')
    return
  }

  isExecuting.value = true
  partialRerunLoading.value = `${role}-${stepIndex}`
  try {
    await store.executeIteration(
      props.sprintId,
      ri,
      stepIndex,
      role === 'developer' ? { developerBackend: developerBackendChoice.value } : {}
    )
    ElMessage.success('已启动执行，请等待 Agent 完成')
    await loadSprint()
  } catch (e) {
    console.error('分步重跑失败:', e)
    ElMessage.error(e.message || '执行失败')
  } finally {
    isExecuting.value = false
    partialRerunLoading.value = ''
  }
}

function getStageStatusType(status) {
  const types = {
    pending: 'info',
    waiting_input: 'warning',
    running: '',
    completed: 'success',
    failed: 'danger'
  }
  return types[status] || 'info'
}

function getStageStatusText(status) {
  const texts = {
    pending: '待执行',
    waiting_input: '等待输入',
    running: '执行中',
    completed: '已完成',
    failed: '失败'
  }
  return texts[status] || status
}

function getInputPlaceholder() {
  const stage = currentStage.value
  if (!stage?.agents?.length) return '请输入...'
  
  const sorted = sortStageIterationsByPipeline(stage.iterations || [])
  const nextRole = sorted.find(i => ['pending', 'ready'].includes(i.status))
  
  const placeholders = {
    product: '请输入产品需求描述...',
    tech_coach: '请输入对技术方案的修改意见（可选）...',
    architect: '请输入对架构设计的修改意见（可选）...',
    developer: '请输入对代码开发的修改意见（可选）...',
    tester: '请输入对测试报告的修改意见（可选）...',
    ops: '请输入对部署配置的修改意见（可选）...'
  }
  
  return placeholders[nextRole?.role] || '请输入...'
}

function getStatusType(status) {
  const types = { pending: 'info', running: 'warning', completed: 'success', failed: 'danger' }
  return types[status] || 'info'
}

function getStatusText(status) {
  const texts = { pending: '待开始', running: '进行中', completed: '已完成', failed: '失败' }
  return texts[status] || status
}

function formatTime(timestamp) {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleString('zh-CN')
}

// ========== 操作 ==========
async function startSprint() {
  try {
    await store.startSprint(props.sprintId)
    await loadSprint()
  } catch (e) {
    console.error('启动冲刺失败:', e)
  }
}

async function executeCurrentStage() {
  const stage = pipelineStages.value[activeStageIndex.value]
  if (!stage) return

  const iteration = getExecutableIterationForStage(stage)
  if (!iteration) {
    const roles = (stage?.agents || []).map(a => a.role).filter(Boolean).join(', ')
    const snap = (sprint.value?.iterations || [])
      .filter(i => (i?.role || '') && (roles.includes(i.role)))
      .map(i => `${i.role}:${i.status}`)
      .join(' | ')
    ElMessage.info(`本阶段没有可执行的角色（roles=${roles || '-'}）。${snap ? `状态: ${snap}` : ''}`)
    return
  }

  isExecuting.value = true
  try {
    await store.executeIteration(
      props.sprintId,
      resolveRoleIndex(iteration),
      null,
      iteration.role === 'developer' ? { developerBackend: developerBackendChoice.value } : {}
    )
    ElMessage.success('已启动执行，请等待 Agent 完成')
    await loadSprint()
  } catch (e) {
    console.error('执行失败:', e)
    ElMessage.error(e?.message || '执行失败')
  } finally {
    isExecuting.value = false
  }
}

async function rerunCurrentStage() {
  const stage = pipelineStages.value[activeStageIndex.value]
  if (!stage) return

  const iteration = getRerunIterationForStage(stage)
  if (!iteration) return

  const roleIndex = resolveRoleIndex(iteration)
  isExecuting.value = true
  try {
    const data = await store.rerunIteration(props.sprintId, roleIndex)
    if (data == null) {
      ElMessage.error(store.error || '重新执行失败')
      return
    }
    await loadSprint()
    const it = sprint.value?.iterations?.[roleIndex]
    if (!it || it.status !== 'ready') {
      ElMessage.warning('状态异常，未能启动 Agent')
      return
    }
    await store.executeIteration(
      props.sprintId,
      roleIndex,
      null,
      it.role === 'developer' ? { developerBackend: developerBackendChoice.value } : {}
    )
    ElMessage.success('已重新启动执行')
    await loadSprint()
  } catch (e) {
    console.error('重新执行失败:', e)
    ElMessage.error(e?.message || '重新执行失败')
  } finally {
    isExecuting.value = false
  }
}

async function confirmInput() {
  if (!userInput.value.trim()) return

  const stage = pipelineStages.value[activeStageIndex.value]
  if (!stage) return

  const sorted = sortStageIterationsByPipeline(stage.iterations || [])
  let iteration =
    sorted.find(i => ['waiting_input', 'pending', 'ready'].includes(i.status)) || sorted[0]
  if (!iteration) return

  try {
    await store.inputIteration(props.sprintId, resolveRoleIndex(iteration), userInput.value)
    await store.executeIteration(
      props.sprintId,
      resolveRoleIndex(iteration),
      null,
      iteration.role === 'developer' ? { developerBackend: developerBackendChoice.value } : {}
    )
    await loadSprint()
  } catch (e) {
    console.error('确认失败:', e)
  }
}

function copyOutput() {
  navigator.clipboard.writeText(editableOutput.value)
}

async function confirmAndNextStage() {
  const stage = pipelineStages.value[activeStageIndex.value]
  if (!stage) return

  const sorted = sortStageIterationsByPipeline(stage.iterations || [])
  // 优先确认「刚跑完、仍为 completed」的角色；否则退化为有产出的第一个
  let iteration = sorted.find(i => i.status === 'completed')
  if (!iteration) {
    iteration = sorted.find(i => i.output)
  }
  if (!iteration) {
    console.warn('没有找到可确认的 iteration')
    return
  }

  const currentOutput = editableOutput.value || selectedStageOutput.value || ''

  try {
    await store.confirmIteration(props.sprintId, resolveRoleIndex(iteration), currentOutput)
    await loadSprint()

    const stageAfter = pipelineStages.value[activeStageIndex.value]
    if (
      stageAfter &&
      isStageFullyDone(stageAfter) &&
      activeStageIndex.value < pipelineStages.value.length - 1
    ) {
      userInput.value = currentOutput
      activeStageIndex.value++
      await loadSprint()
    }
  } catch (e) {
    console.error('确认失败:', e)
    alert('确认失败: ' + e.message)
  }
}

// 预览/打开/下载功能
async function openPreview(file) {
  previewFile.value = file
  previewContent.value = ''
  previewError.value = ''
  previewLoading.value = true
  previewVisible.value = true

  try {
    const source = file.source || 'sprint'
    const response = await fetch(
      `/api/sprints/${props.sprintId}/file?file=${encodeURIComponent(file.path)}&source=${source}`
    )
    const data = await response.json()
    
    if (data.error) {
      previewError.value = data.error
    } else if (data.tree) {
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
  previewFile.value = null
  previewContent.value = ''
  previewError.value = ''
  previewVisible.value = false
}

function openFileInBrowser(filePath, source = 'sprint') {
  const baseUrl = source === 'project' 
    ? `/api/local-project/content?path=${encodeURIComponent(filePath)}`
    : `/api/sprints/${props.sprintId}/file?file=${encodeURIComponent(filePath)}`
  window.open(baseUrl, '_blank')
}

function downloadFile(filePath, source = 'sprint') {
  const baseUrl = source === 'project'
    ? `/api/local-project/content?path=${encodeURIComponent(filePath)}`
    : `/api/sprints/${props.sprintId}/file?file=${encodeURIComponent(filePath)}`
  const link = document.createElement('a')
  link.href = baseUrl
  link.download = filePath.split('/').pop()
  link.click()
}

async function loadSprint() {
  try {
    sprint.value = await store.fetchSprint(props.sprintId)
    updateActiveStageIndex()
    editableOutput.value = selectedStageOutput.value ?? ''
    if (isDeveloperStageSelected.value) {
      await loadDeveloperTaskConsole()
    }
  } catch (e) {
    console.error('加载 sprint 失败:', e)
  }
}

function updateActiveStageIndex() {
  if (!sprint.value) return

  const stages = pipelineStages.value
  if (!stages.length) {
    activeStageIndex.value = 0
    return
  }

  // 优先聚焦「第一个尚未完成」的阶段（待执行/等待输入/执行中/失败），便于技术设计完成后自动落在代码开发
  const firstIncomplete = stages.findIndex(s =>
    ['pending', 'waiting_input', 'running', 'failed'].includes(s.status)
  )
  if (firstIncomplete >= 0) {
    activeStageIndex.value = firstIncomplete
    return
  }

  // 全部已完成：停在最后一格
  activeStageIndex.value = Math.max(0, stages.length - 1)
}

onMounted(() => {
  loadSprint()
})

watch(() => props.sprintId, () => {
  loadSprint()
})

watch(activeStageIndex, (val) => {
  selectedStage.value = val
  editableOutput.value = selectedStageOutput.value ?? ''
})
</script>

<style scoped>
.sprint-detail {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

/* Header */
.sprint-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Execution Flow */
.execution-flow {
  margin-bottom: 24px;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 8px;
}

.section-title {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.pipeline-steps {
  display: flex;
  align-items: stretch;
  gap: 14px;
  overflow-x: auto;
  padding: 8px 4px;
}

.pipeline-step {
  display: flex;
  align-items: stretch;
  gap: 12px;
}

.pipeline-card {
  position: relative;
  width: 260px;
  min-height: 118px;
  text-align: left;
  border: 1px solid #e4e7ed;
  border-radius: 12px;
  background: #ffffff;
  padding: 12px 12px;
  cursor: pointer;
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease,
    border-color 0.12s ease,
    background 0.12s ease;
}

.pipeline-card:hover:not(:disabled) {
  border-color: rgba(64, 158, 255, 0.6);
  box-shadow: 0 8px 24px rgba(64, 158, 255, 0.14);
  transform: translateY(-1px);
}

.pipeline-card:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  filter: grayscale(0.15);
}

.pipeline-card-top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.pipeline-badge {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(144, 147, 153, 0.12);
  color: #606266;
  flex: 0 0 auto;
  font-size: 16px;
}

.pipeline-title {
  min-width: 0;
  flex: 1;
}

.pipeline-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pipeline-name {
  font-size: 14px;
  font-weight: 650;
  color: #303133;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pipeline-meta {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}

.pipeline-meta-label {
  width: 44px;
  flex: 0 0 auto;
  font-size: 11px;
  color: #909399;
  line-height: 18px;
}

.pipeline-meta-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  min-width: 0;
  flex: 1;
}

.pipeline-agent {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(64, 158, 255, 0.08);
  color: #409eff;
  font-size: 12px;
  max-width: 100%;
}

.pipeline-agent-name {
  color: #606266;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.pipeline-skills {
  font-size: 12px;
  color: #606266;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pipeline-current-indicator {
  position: absolute;
  right: 10px;
  bottom: 10px;
  font-size: 11px;
  font-weight: 600;
  color: #409eff;
  background: rgba(64, 158, 255, 0.10);
  border: 1px solid rgba(64, 158, 255, 0.22);
  padding: 2px 8px;
  border-radius: 999px;
}

.pipeline-connector {
  display: flex;
  align-items: center;
}

.pipeline-connector-line {
  width: 18px;
  height: 2px;
  border-radius: 999px;
  background: #dcdfe6;
  position: relative;
  overflow: hidden;
}

/* Status theming */
.pipeline-step.is-completed .pipeline-badge {
  background: rgba(103, 194, 58, 0.14);
  color: #67c23a;
}

.pipeline-step.is-running .pipeline-badge {
  background: rgba(230, 162, 60, 0.16);
  color: #e6a23c;
}

.pipeline-step.is-failed .pipeline-badge {
  background: rgba(245, 108, 108, 0.16);
  color: #f56c6c;
}

.pipeline-step.is-completed .pipeline-connector-line {
  background: rgba(103, 194, 58, 0.45);
}

.pipeline-step.is-running .pipeline-connector-line {
  background: rgba(230, 162, 60, 0.45);
}

.pipeline-step.is-failed .pipeline-connector-line {
  background: rgba(245, 108, 108, 0.45);
}

.pipeline-step.is-current .pipeline-card {
  border-color: rgba(64, 158, 255, 0.8);
  box-shadow: 0 10px 30px rgba(64, 158, 255, 0.18);
}

.pipeline-step.is-current .pipeline-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  height: 3px;
  border-radius: 12px 12px 0 0;
  background: linear-gradient(90deg, rgba(64, 158, 255, 0.4), rgba(64, 158, 255, 1), rgba(64, 158, 255, 0.4));
  background-size: 200% 100%;
  animation: df-flow 1.6s linear infinite;
}

.pipeline-step.is-current .pipeline-connector-line::after {
  content: '';
  position: absolute;
  left: -30%;
  top: 0;
  height: 100%;
  width: 40%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.9), transparent);
  animation: df-scan 1.2s linear infinite;
}

@keyframes df-flow {
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}

@keyframes df-scan {
  0% { transform: translateX(0); }
  100% { transform: translateX(260%); }
}

.flow-step:hover {
  border-color: #409eff;
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.2);
}

.flow-step.is-active {
  border-color: #409eff;
  background: #ecf5ff;
}

.flow-step.is-completed {
  border-color: #67c23a;
  background: #f0f9eb;
}

.flow-step.is-failed {
  border-color: #f56c6c;
  background: #fef0f0;
}

.flow-step.is-running {
  border-color: #e6a23c;
  background: #fdf6ec;
}

.step-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #f0f0f0;
  font-size: 16px;
}

.step-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.step-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

/* Stage Detail */
.stage-detail {
  margin-bottom: 20px;
  padding: 16px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
}

.stage-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 16px;
  border-bottom: 1px solid #e4e7ed;
  margin-bottom: 16px;
}

.stage-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stage-icon {
  font-size: 24px;
}

.stage-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.stage-desc {
  margin: 4px 0 0 0;
  font-size: 14px;
  color: #909399;
}

.stage-actions {
  display: flex;
  gap: 8px;
}

/* User Input */
.user-input-section {
  margin-bottom: 20px;
  padding: 16px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
}

.user-input-actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}

.back-btn {
  font-size: 18px;
  color: #606266;
  padding: 8px;
  margin-left: -8px;
  border-radius: 8px;
  transition:
    background-color var(--df-duration-fast, 0.12s) ease,
    color var(--df-duration-fast, 0.12s) ease,
    transform var(--df-duration-fast, 0.12s) ease;
}

.back-btn:hover {
  background: #f5f7fa;
  color: #409eff;
}

.back-btn:active:not(:disabled) {
  background: #ebeef5;
  transform: scale(0.96);
}

.header-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sprint-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sprint-id {
  font-size: 12px;
  color: #909399;
  font-family: monospace;
}

.start-btn {
  min-width: 120px;
}

/* Cards */
.requirement-card,
.stage-detail-card,
.pipeline-card {
  margin-bottom: 20px;
  border-radius: 8px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  color: #303133;
}

.header-icon {
  color: #409eff;
}

.requirement-text {
  color: #606266;
  line-height: 1.6;
  margin: 0;
}

/* Steps Custom */
.el-steps-custom {
  padding: 20px 0;
}

.el-steps-custom .is-clickable {
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.el-steps-custom .is-clickable:hover .el-step__title {
  color: #409eff;
}

.el-steps-custom .is-clickable:hover .step-icon {
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.35);
}

.el-steps-custom .is-clickable:active .step-icon {
  transform: scale(0.92);
}

.step-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  background: #f0f2f5;
  color: #909399;
  transition:
    transform 0.12s ease,
    box-shadow 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease;
}

.el-steps-custom .is-clickable:focus-visible {
  outline: 2px solid #79bbff;
  outline-offset: 4px;
  border-radius: 8px;
}

.step-icon-pending {
  background: #f0f2f5;
  color: #909399;
}

.step-icon-running {
  background: #fdf6ec;
  color: #e6a23c;
}

.step-icon-completed {
  background: #f0f9eb;
  color: #67c23a;
}

.step-icon-failed {
  background: #fef0f0;
  color: #f56c6c;
}

.step-title-custom {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stage-name {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.working-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.working-agent-tag {
  font-size: 12px;
}

.skills-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.skill-tag {
  font-size: 11px;
}

.waiting-info,
.completed-info {
  margin-top: 4px;
}

.step-desc-custom {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.agents-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.agent-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 12px;
}

.agent-chip-running,
.agent-chip-waiting_input {
  background: #fdf6ec;
}

.agent-chip-completed,
.agent-chip-confirmed {
  background: #f0f9eb;
}

.agent-icon {
  font-size: 12px;
}

.agent-name {
  color: #606266;
}

.stage-desc-text {
  font-size: 12px;
  color: #909399;
}

.dev-backend-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 12px 0 0;
  margin-top: 12px;
  border-top: 1px solid #ebeef5;
  font-size: 13px;
}

.dev-backend-label {
  color: #606266;
  font-weight: 500;
}

.dev-backend-hint {
  color: #909399;
  font-size: 12px;
  flex-basis: 100%;
}

/* Stage Action Bar */
.stage-action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0 0;
  border-top: 1px solid #ebeef5;
  margin-top: 16px;
}

.action-left,
.action-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rerun-btn {
  color: #909399;
}

.rerun-btn:hover {
  color: #409eff;
}

/* Detail Card */
.detail-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-header-right {
  margin-left: auto;
}

.detail-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #409eff;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}

.detail-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.detail-section {
  margin-bottom: 20px;
}

.detail-section:last-child {
  margin-bottom: 0;
}

.detail-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  margin: 0 0 10px 0;
}

.input-textarea,
.output-textarea {
  margin-bottom: 10px;
}

.input-actions,
.output-actions {
  display: flex;
  gap: 8px;
}

.task-metrics-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.task-metric-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #f8fafc;
  padding: 10px 12px;
}

.task-metric-card.success {
  border-color: #c2e7b0;
  background: #f0f9eb;
}

.task-metric-card.warning {
  border-color: #f5dab1;
  background: #fdf6ec;
}

.task-metric-card.danger {
  border-color: #f5c2c7;
  background: #fef0f0;
}

.task-metric-label {
  font-size: 12px;
  color: #909399;
}

.task-metric-value {
  margin-top: 4px;
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}

.task-metrics-warning {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 6px 0 10px;
}

.task-metrics-table-wrap {
  overflow-x: auto;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

.task-metrics-table-actions {
  display: flex;
  justify-content: flex-end;
  padding: 8px 10px;
  border-bottom: 1px solid #f2f3f5;
  background: #fafafa;
}

.task-metrics-table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
}

.task-metrics-table th,
.task-metrics-table td {
  text-align: left;
  font-size: 12px;
  color: #606266;
  border-bottom: 1px solid #f2f3f5;
  padding: 8px 10px;
  white-space: nowrap;
}

.task-metrics-table th {
  color: #909399;
  font-weight: 600;
  background: #fafafa;
}

.task-metrics-table tr:last-child td {
  border-bottom: none;
}

/* Executing State */
.executing-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 0;
  color: #909399;
}

.executing-state .el-icon {
  color: #409eff;
}

.executing-text {
  margin-top: 12px;
  font-size: 14px;
}

.executing-agent {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 12px 20px;
  background: #f0f9eb;
  border-radius: 8px;
}

.agent-icon-large {
  font-size: 24px;
}

.agent-name-large {
  font-size: 16px;
  font-weight: 500;
  color: #67c23a;
}

/* 流程恢复 */
.recovery-section {
  background: #fdf6ec;
  border: 1px solid #f5dab1;
  border-radius: 8px;
  padding: 12px 16px;
}

.recovery-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: #909399;
  line-height: 1.55;
}

/* 分步重跑 */
.partial-rerun-section {
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px 16px;
}

.partial-rerun-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: #909399;
  line-height: 1.55;
}

.partial-rerun-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.partial-rerun-row:last-child {
  margin-bottom: 0;
}

.partial-rerun-agent {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 120px;
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.partial-rerun-select {
  min-width: 220px;
  flex: 1;
}

/* 输出文件列表 */
.output-files-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.output-file-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 10px;
  background: #f5f7fa;
  border-radius: 8px;
  border: 1px solid #ebeef5;
  font-size: 13px;
  color: #606266;
}

.output-file-row:last-child {
  margin-bottom: 0;
}

.output-file-row.file-exists {
  background: #f0f9eb;
  border-color: #c2e7b0;
}

.output-file-main {
  flex: 1;
  min-width: 0;
}

.output-file-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.output-file-icon {
  flex-shrink: 0;
  color: #409eff;
}

.file-name {
  font-weight: 600;
  color: #303133;
}

.file-path {
  font-size: 12px;
  color: #909399;
  background: rgba(0, 0, 0, 0.04);
  padding: 2px 8px;
  border-radius: 4px;
}

.file-description {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #606266;
}

.file-actions {
  display: flex;
  gap: 4px;
}

.file-actions .el-button {
  padding: 4px;
}

/* Preview */
.preview-loading,
.preview-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: #909399;
}

.preview-content {
  max-height: 500px;
  overflow: auto;
  background: #f5f7fa;
  padding: 16px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
  color: #606266;
}

.preview-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* History */
.history-card {
  border-radius: 6px;
}

.history-text {
  color: #606266;
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.collab-steps-mini {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.collab-mini-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: #ecf5ff;
  color: #409eff;
}

.collaboration-section {
  background: #fafcff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 12px 16px;
}

.collaboration-steps-list {
  margin: 8px 0 0;
  padding-left: 20px;
  color: #606266;
  font-size: 13px;
  line-height: 1.6;
}

.collab-step-title {
  font-weight: 500;
  color: #303133;
  margin-bottom: 4px;
}

.collab-step-num {
  display: inline-block;
  min-width: 18px;
  color: #409eff;
  font-weight: 600;
  margin-right: 4px;
}

.collab-step-detail {
  margin: 0 0 12px;
  font-size: 13px;
  color: #606266;
}

/* Developer Task Console */
.developer-task-console {
  background: linear-gradient(135deg, #f0f9ff 0%, #e6f4ff 100%);
  border: 1px solid #cce5ff;
  border-radius: 12px;
  padding: 16px 20px;
}

.developer-console-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 20px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #d9ecff;
}

.developer-console-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.developer-console-stat .label {
  font-size: 11px;
  color: #909399;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.developer-console-stat strong {
  font-size: 18px;
  color: #303133;
}

.developer-console-stat .value {
  font-size: 13px;
  color: #606266;
  max-width: 400px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.developer-console-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.developer-console-body {
  display: flex;
  gap: 16px;
  min-height: 300px;
}

.run-list {
  width: 200px;
  flex-shrink: 0;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  overflow: hidden;
}

.run-list-title {
  font-size: 12px;
  font-weight: 600;
  color: #606266;
  padding: 10px 12px;
  background: #f5f7fa;
  border-bottom: 1px solid #ebeef5;
}

.run-list-items {
  max-height: 400px;
  overflow-y: auto;
  padding: 6px;
}

.run-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  font-size: 12px;
  transition: background 0.15s;
}

.run-item:hover {
  background: #f5f7fa;
}

.run-item.active {
  background: #ecf5ff;
  border: 1px solid #b3d8ff;
}

.run-item.fail {
  border-left: 3px solid #f56c6c;
}

.run-item.warn {
  border-left: 3px solid #e6a23c;
}

.run-item .idx {
  font-weight: 600;
  color: #409eff;
  min-width: 24px;
}

.run-item .status {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: #f0f9eb;
  color: #67c23a;
}

.run-item.fail .status {
  background: #fef0f0;
  color: #f56c6c;
}

.run-item.warn .status {
  background: #fdf6ec;
  color: #e6a23c;
}

.run-item .title {
  flex: 1;
  color: #606266;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.run-detail {
  flex: 1;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 16px;
  min-width: 0;
}

.run-detail-head {
  margin-bottom: 12px;
}

.run-detail-head strong {
  font-size: 15px;
  color: #303133;
}

.run-detail-head .meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.run-detail-error {
  margin-bottom: 12px;
}

.run-files {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.run-files-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.run-file {
  padding: 4px 10px;
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.run-file:hover {
  border-color: #409eff;
  color: #409eff;
}

.run-file.active {
  background: #ecf5ff;
  border-color: #409eff;
  color: #409eff;
}

.run-files-diff {
  background: #1e1e1e;
  border-radius: 6px;
  padding: 12px;
  max-height: 350px;
  overflow: auto;
}

.diff-pre {
  margin: 0;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
}

.diff-add {
  color: #98c379;
  display: block;
}

.diff-remove {
  color: #e06c75;
  display: block;
}

.diff-context {
  color: #5c6370;
  display: block;
}

.run-no-files {
  color: #909399;
  font-size: 13px;
  text-align: center;
  padding: 40px;
}

.collab-handoff {
  margin: 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
</style>
