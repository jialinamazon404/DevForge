<template>
  <div class="json-tree bg-vue-darker rounded-vue p-3 text-sm">
    <div v-if="isArray" class="array-container">
      <div class="flex items-center justify-between mb-2">
        <span class="text-gray-400">Array[{{ data.length }}]</span>
        <button @click="$emit('update:modelValue', data)" class="text-xs text-vue-primary hover:underline">
          保存更改
        </button>
      </div>
      <div v-for="(item, index) in data" :key="index" class="json-array-item ml-4 border-l-2 border-vue-border pl-3 py-1">
        <JsonTree :modelValue="item" @update:modelValue="updateArrayItem(index, $event)" :depth="depth + 1" />
      </div>
    </div>
    <div v-else-if="isObject" class="object-container">
      <div class="flex items-center justify-between mb-2">
        <span class="text-gray-400">Object</span>
        <button @click="$emit('update:modelValue', data)" class="text-xs text-vue-primary hover:underline">
          保存更改
        </button>
      </div>
      <div v-for="(value, key) in data" :key="key" class="json-object-item">
        <div class="flex items-start py-1">
          <button @click="toggle(key)" class="mr-1 text-gray-500 hover:text-white transition-colors">
            {{ expanded[key] ? '▼' : '▶' }}
          </button>
          <span class="text-cyan-400 mr-2">{{ key }}:</span>
          
          <!-- 对象/数组类型 -->
          <span v-if="isObjectOrArray(value)" @click="toggle(key)" class="text-gray-300 cursor-pointer hover:text-vue-primary">
            {{ isArrayValue(value) ? 'Array' : 'Object' }}{{ isArrayValue(value) ? `[${value.length}]` : '' }}
          </span>
          
          <!-- 展开显示子元素 -->
          <div v-else-if="expanded[key]" class="ml-4 w-full">
            <JsonTree :modelValue="value" @update:modelValue="updateValue(key, $event)" :depth="depth + 1" />
          </div>
          
          <!-- 基本类型值 -->
          <div v-else class="flex items-center">
            <span :class="getValueClass(value)" @click="startEdit(key, value)" class="cursor-pointer hover:underline">
              {{ formatValue(value) }}
            </span>
            <input 
              v-if="editingKey === key" 
              v-model="editValue" 
              @blur="finishEdit"
              @keyup.enter="finishEdit"
              @keyup.escape="cancelEdit"
              class="ml-2 px-2 py-0.5 bg-vue-card border border-vue-border rounded text-white text-sm focus:outline-none focus:border-vue-primary"
              :class="getInputClass(value)"
            />
          </div>
        </div>
      </div>
    </div>
    <div v-else class="primitive-value">
      <span :class="getValueClass(data)" @click="startEdit('root', data)" class="cursor-pointer hover:underline">
        {{ formatValue(data) }}
      </span>
      <input 
        v-if="editingKey === 'root'" 
        v-model="editValue" 
        @blur="finishEdit"
        @keyup.enter="finishEdit"
        class="ml-2 px-2 py-0.5 bg-vue-card border border-vue-border rounded text-white text-sm focus:outline-none focus:border-vue-primary"
        :class="getInputClass(data)"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  modelValue: {
    type: [Object, Array, String, Number, Boolean, null],
    default: () => ({})
  },
  depth: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits(['update:modelValue'])

const expanded = ref({})
const editingKey = ref(null)
const editValue = ref('')

// 判断类型
const isObject = computed(() => props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue))
const isArray = computed(() => Array.isArray(props.modelValue))
const isArrayValue = (val) => Array.isArray(val)
const isObjectOrArray = (val) => val && typeof val === 'object'

// 格式化显示
const formatValue = (val) => {
  if (val === null) return 'null'
  if (typeof val === 'string') return `"${val}"`
  if (typeof val === 'boolean') return val ? 'true' : 'false'
  return String(val)
}

// 获取值的样式类
const getValueClass = (val) => {
  if (val === null) return 'text-gray-500'
  if (typeof val === 'string') return 'text-green-400'
  if (typeof val === 'number') return 'text-blue-400'
  if (typeof val === 'boolean') return 'text-purple-400'
  return 'text-gray-300'
}

// 获取输入框样式类
const getInputClass = (val) => {
  if (typeof val === 'string') return ''
  if (typeof val === 'number') return ''
  return ''
}

// 展开/折叠
const toggle = (key) => {
  expanded.value[key] = !expanded.value[key]
}

const isExpanded = (key) => !!expanded.value[key]

// 编辑功能
const startEdit = (key, value) => {
  editingKey.value = key
  editValue.value = typeof value === 'string' ? value : String(value)
}

const cancelEdit = () => {
  editingKey.value = null
  editValue.value = ''
}

const finishEdit = () => {
  if (editingKey.value === null) return
  
  let newValue = editValue.value
  
  // 尝试转换类型
  if (!isNaN(Number(editValue.value)) && editValue.value.trim() !== '') {
    newValue = Number(editValue.value)
  } else if (editValue.value === 'true') {
    newValue = true
  } else if (editValue.value === 'false') {
    newValue = false
  } else if (editValue.value === 'null') {
    newValue = null
  }
  
  // 更新值
  if (editingKey.value === 'root') {
    emit('update:modelValue', newValue)
  } else if (isObject.value) {
    const updated = { ...props.modelValue }
    updated[editingKey.value] = newValue
    emit('update:modelValue', updated)
  }
  
  editingKey.value = null
  editValue.value = ''
}

const updateValue = (key, newVal) => {
  const updated = { ...props.modelValue }
  updated[key] = newVal
  emit('update:modelValue', updated)
}

const updateArrayItem = (index, newVal) => {
  const updated = [...props.modelValue]
  updated[index] = newVal
  emit('update:modelValue', updated)
}

// 默认展开第一层
watch(() => props.modelValue, (val) => {
  if (val && typeof val === 'object') {
    Object.keys(val).forEach(key => {
      if (props.depth === 0) {
        expanded.value[key] = true
      }
    })
  }
}, { immediate: true })
</script>

<style scoped>
.json-tree {
  font-family: 'Monaco', 'Menlo', monospace;
  line-height: 1.6;
}

.json-array-item,
.json-object-item {
  margin-top: 4px;
}

.json-key {
  color: #22d3ee;
}
</style>
