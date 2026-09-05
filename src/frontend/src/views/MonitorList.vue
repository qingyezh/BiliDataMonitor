<template>
  <div>
    <!-- 顶部操作区 -->
    <div class="content-card">
      <div class="card-title" style="display: flex; justify-content: space-between; align-items: center">
        <span>📋 监测任务</span>
        <div style="display: flex; gap: 8px">
          <el-button v-if="isRoot" size="small" type="warning" :loading="refreshing" @click="handleRefreshAll">
            <el-icon><Refresh /></el-icon> 立即刷新全部
          </el-button>
          <el-button v-if="isRoot" size="small" type="primary" @click="showCreateDialog = true">
            <el-icon><Plus /></el-icon> 新增任务
          </el-button>
        </div>
      </div>
      <div style="color: var(--text-secondary); font-size: 12px; margin-top: 4px">
        系统启动后每 {{ settings.interval_minutes }} 分钟自动轮询一次监测数据
      </div>
    </div>

    <!-- 任务列表 -->
    <div class="content-card">
      <el-table :data="tasks" stripe v-loading="loading">
        <el-table-column type="index" label="#" width="50" align="center" />
        <el-table-column label="类型" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.task_type === 'up' ? 'primary' : row.task_type === 'video' ? 'success' : row.task_type === 'dynamic' ? 'warning' : 'info'" size="small">
              {{ row.task_type === 'up' ? 'UP主' : row.task_type === 'video' ? '视频' : row.task_type === 'dynamic' ? '动态' : '专栏' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link type="primary" @click="$router.push(`/detail/${row.task_type}/${row.target}`)">
              {{ row.name }}
            </el-link>
          </template>
        </el-table-column>
        <el-table-column label="目标" min-width="140">
          <template #default="{ row }">
            <span style="font-family: monospace; font-size: 12px" :title="row.target">{{ row.target.length > 16 ? row.target.slice(0, 8) + '...' + row.target.slice(-6) : row.target }}</span>
          </template>
        </el-table-column>
        <el-table-column label="指标摘要" min-width="280">
          <template #default="{ row }">
            <span v-if="row.task_type === 'up' && row.summary" style="font-size: 12px; white-space: nowrap">
              {{ row.summary.total_videos }}视频 · 播放{{ formatNum(row.summary.total_views) }} · 弹幕{{ formatNum(row.summary.total_danmaku) }} · 评论{{ formatNum(row.summary.total_comments) }}
            </span>
            <span v-else-if="row.task_type === 'video' && row.summary" style="font-size: 12px">
              播放{{ formatNum(row.summary.last_play) }} · 样本{{ row.summary.sample_count }}次
            </span>
            <span v-else-if="row.task_type === 'dynamic' && row.summary" style="font-size: 12px">
              点赞{{ formatNum(row.summary.like_count) }} · 评论{{ formatNum(row.summary.reply_count) }} · 转发{{ formatNum(row.summary.forward_count) }}
            </span>
            <span v-else-if="row.task_type === 'column' && row.summary" style="font-size: 12px">
              点赞{{ formatNum(row.summary.like_count) }} · 评论{{ formatNum(row.summary.reply_count) }} · 收藏{{ formatNum(row.summary.favorite_count) }}
            </span>
            <span v-else style="color: var(--text-secondary); font-size: 12px">暂无数据</span>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="80" align="center">
          <template #default="{ row }">
            <el-switch v-if="isRoot" :model-value="row.enabled === 1" @change="(v: string | number | boolean) => toggleEnabled(row, v)" size="small" />
            <span v-else style="font-size: 12px">{{ row.enabled === 1 ? '是' : '否' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="上次运行" width="160" align="center">
          <template #default="{ row }">
            <span style="font-size: 12px">{{ formatTimestamp(row.last_run_at) || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tooltip :content="row.error || ''" placement="top" :disabled="!row.error">
              <el-tag :type="statusLabel(row.last_status).type" size="small">{{ statusLabel(row.last_status).text }}</el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center" fixed="right">
          <template #default="{ row }">
            <div style="display: flex; gap: 4px; justify-content: center">
              <el-button size="small" text type="primary" @click="$router.push(`/detail/${row.task_type}/${row.target}`)">详情</el-button>
              <el-button v-if="isRoot" size="small" text type="success" :loading="refreshingId === row.id" @click="refreshOne(row)">刷新</el-button>
              <el-button v-if="isRoot" size="small" text type="danger" @click="removeTask(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && tasks.length === 0" description="暂无监测任务，点击右上角「新增任务」开始监测" />
    </div>

    <!-- 新增任务对话框 -->
    <el-dialog v-model="showCreateDialog" title="新增监测任务" width="460px">
      <el-form label-width="90px">
        <el-form-item label="任务类型">
          <el-radio-group v-model="createForm.task_type">
            <el-radio-button value="up">UP主（UID）</el-radio-button>
            <el-radio-button value="video">视频（BV号）</el-radio-button>
            <el-radio-button value="dynamic">动态</el-radio-button>
            <el-radio-button value="column">专栏</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="createForm.task_type === 'up' ? 'UP主UID' : createForm.task_type === 'video' ? '视频BV号' : createForm.task_type === 'dynamic' ? '动态ID' : '专栏CV号'">
          <el-input v-model="createForm.target" :placeholder="createForm.task_type === 'up' ? '输入UP主UID（如 3546597658987119）' : createForm.task_type === 'video' ? '输入视频BV号（如 BV1aWuG6mEyN）' : createForm.task_type === 'dynamic' ? '输入动态ID（如 1242949793748090912）' : '输入专栏CV号（如 12345）'" />
        </el-form-item>
        <el-form-item v-if="createForm.task_type === 'up'" label="最新视频数">
          <el-input-number v-model="createForm.max_videos" :min="0" :max="500" />
          <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px">0 = 监测全部视频</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { monitorApi, type MonitorTask, type AppSettings } from '../api/monitor'
import { formatNum, formatTimestamp, statusLabel } from '../utils/format'

const tasks = ref<MonitorTask[]>([])
const settings = ref<AppSettings>({ port: 8123, interval_minutes: 30, default_max_videos: 10, cookie_mask: '', open_browser: true })
const loading = ref(false)
const refreshing = ref(false)
const refreshingId = ref<number | null>(null)
const creating = ref(false)
const showCreateDialog = ref(false)
const createForm = ref({ task_type: 'up' as 'up' | 'video', target: '', max_videos: 10 })
const isRoot = localStorage.getItem('user_role') === 'root'

async function loadTasks() {
  loading.value = true
  try {
    tasks.value = await monitorApi.listTasks()
  } catch {
    ElMessage.error('加载任务失败')
  } finally {
    loading.value = false
  }
}

async function loadSettings() {
  try {
    settings.value = await monitorApi.settings()
  } catch { /* ignore */ }
}

async function handleCreate() {
  const target = createForm.value.target.trim()
  if (!target) {
    ElMessage.warning('请输入目标')
    return
  }
  creating.value = true
  try {
    await monitorApi.createTask({
      task_type: createForm.value.task_type,
      target,
      max_videos: createForm.value.max_videos,
    })
    ElMessage.success('创建成功')
    showCreateDialog.value = false
    createForm.value.target = ''
    await loadTasks()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '创建失败')
  } finally {
    creating.value = false
  }
}

async function toggleEnabled(row: MonitorTask, val: string | number | boolean) {
  try {
    await monitorApi.updateTask(row.id, { enabled: val ? 1 : 0 })
    row.enabled = val ? 1 : 0
    ElMessage.success(val ? '已启用' : '已停用')
  } catch {
    ElMessage.error('操作失败')
  }
}

async function refreshOne(row: MonitorTask) {
  refreshingId.value = row.id
  try {
    await monitorApi.refreshTask(row.id)
    ElMessage.success(`「${row.name}」刷新完成`)
    await loadTasks()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '刷新失败')
  } finally {
    refreshingId.value = null
  }
}

async function handleRefreshAll() {
  refreshing.value = true
  try {
    const r = await monitorApi.refreshAll()
    ElMessage.success(`刷新完成：成功 ${r.ok}，失败 ${r.error}`)
    await loadTasks()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '刷新失败')
  } finally {
    refreshing.value = false
  }
}

async function removeTask(row: MonitorTask) {
  try {
    await ElMessageBox.confirm(`确认删除任务「${row.name}」？其所有数据将被清除。`, '删除任务', { type: 'warning' })
    await monitorApi.deleteTask(row.id)
    ElMessage.success('已删除')
    await loadTasks()
  } catch (e: any) {
    if (e !== 'cancel' && e?.message !== 'cancel') ElMessage.error('删除失败')
  }
}

let refreshTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  loadTasks()
  loadSettings()
  // 每5分钟静默刷新
  refreshTimer = setInterval(() => {
    loadTasks()
  }, 5 * 60 * 1000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>
