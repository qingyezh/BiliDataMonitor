<template>
  <div v-loading="loading">
    <div class="content-card">
      <div class="card-title">⚙️ 监测设置</div>
      <el-form label-width="140px" size="default" style="max-width: 520px">
        <el-form-item label="轮询间隔">
          <el-select v-model="settings.interval_minutes" style="width: 200px">
            <el-option v-for="m in [5, 10, 15, 30, 60, 120, 240, 360, 720, 1440]" :key="m" :value="m" :label="m >= 1440 ? '24小时' : m >= 60 ? `${m / 60}小时` : `${m}分钟`" />
          </el-select>
          <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px">系统启动后每间隔自动轮询，即时生效</span>
        </el-form-item>
        <el-form-item label="默认监测视频数">
          <el-input-number v-model="settings.default_max_videos" :min="0" :max="500" />
          <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px">新增UP主任务时的默认「最新N个」，0=全部</span>
        </el-form-item>
        <el-form-item label="服务端口">
          <el-input-number v-model="settings.port" :min="1024" :max="65535" />
          <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px">修改后需重启服务生效</span>
        </el-form-item>
        <el-form-item>
          <el-button v-if="isRoot" type="primary" :loading="saving" @click="saveSettings">保存设置</el-button>
          <span v-if="!isRoot" style="color: var(--text-secondary); font-size: 12px">仅 root 用户可修改设置</span>
        </el-form-item>
      </el-form>
    </div>

    <!-- Cookie 管理（同 CrawlerAnalysis 模式） -->
    <div class="content-card">
      <div class="card-title"><el-icon style="margin-right: 6px; color: #f56c6c"><Key /></el-icon> Cookie 管理</div>
      <el-form label-width="100px" style="max-width: 640px">
        <el-form-item label="B站 Cookie">
          <div style="display: flex; align-items: center; gap: 8px; width: 100%">
            <el-input
              v-if="cookieEditing"
              v-model="cookieInput"
              type="textarea"
              :rows="2"
              placeholder="粘贴新的 Cookie（将覆盖已有配置）"
            />
            <el-input
              v-else
              :model-value="cookieStatus.configured ? cookieStatus.masked : '未配置'"
              disabled
            />
            <el-button v-if="!cookieEditing && isRoot" @click="startCookieEdit">覆盖</el-button>
            <el-button v-else-if="isRoot" @click="cancelCookieEdit">取消</el-button>
          </div>
        </el-form-item>
      </el-form>
      <div class="card-footer" style="margin-top: 12px">
        <el-button v-if="isRoot" type="primary" :loading="savingCookies" @click="saveCookies">保存 Cookie</el-button>
      </div>
    </div>

    <div class="content-card">
      <div class="card-title">⏰ 调度器状态</div>
      <el-descriptions :column="2" border size="small" style="max-width: 560px">
        <el-descriptions-item label="运行状态">
          <el-tag :type="scheduler.running ? 'success' : 'danger'" size="small">{{ scheduler.running ? '运行中' : '已停止' }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="执行中">
          <el-tag :type="scheduler.in_flight ? 'warning' : 'info'" size="small">{{ scheduler.in_flight ? '正在轮询' : '空闲' }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="任务数">{{ scheduler.task_counts?.enabled }}/{{ scheduler.task_counts?.total }}</el-descriptions-item>
        <el-descriptions-item label="上次轮询">{{ formatTimestamp(scheduler.last_run_at) || '—' }}</el-descriptions-item>
        <el-descriptions-item label="下次轮询">{{ formatTimestamp(scheduler.next_run_at) || '—' }}</el-descriptions-item>
        <el-descriptions-item label="间隔">{{ scheduler.interval_minutes }} 分钟</el-descriptions-item>
      </el-descriptions>
    </div>

    <div class="content-card">
      <div class="card-title">🖥️ 系统</div>
      <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap">
        <div v-if="isRoot" style="display: flex; align-items: center; gap: 8px">
          <span>开机自启动</span>
          <el-switch v-model="autostartEnabled" :loading="autostartLoading" @change="toggleAutostart" />
        </div>
        <el-button v-if="isRoot" size="small" type="primary" :loading="backupLoading" @click="backupDatabase">备份数据库</el-button>
        <el-button v-if="isRoot" size="small" type="danger" @click="clearAllData">清除数据</el-button>
        <el-button v-if="isRoot" size="small" type="danger" plain @click="shutdownServer">关闭服务</el-button>
        <el-button v-if="isRoot" size="small" type="primary" plain @click="$router.push('/users')">用户管理</el-button>
        <el-button v-if="isRoot" size="small" @click="showPasswordDialog = true">修改密码</el-button>
      </div>
    </div>
    <!-- 修改密码对话框 -->
    <el-dialog v-model="showPasswordDialog" title="修改密码" width="400px">
      <el-form label-width="80px">
        <el-form-item label="旧密码">
          <el-input v-model="passwordForm.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="passwordForm.newPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="passwordForm.confirmPassword" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showPasswordDialog = false">取消</el-button>
        <el-button type="primary" @click="changePassword">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Key } from '@element-plus/icons-vue'
import { monitorApi, type AppSettings } from '../api/monitor'
import { formatTimestamp } from '../utils/format'

const loading = ref(false)
const saving = ref(false)
const settings = ref<AppSettings>({ port: 8123, interval_minutes: 30, default_max_videos: 10, cookie_mask: '', open_browser: true })
const scheduler = ref<any>({})
const autostartEnabled = ref(false)
const autostartLoading = ref(false)
const backupLoading = ref(false)
const isRoot = localStorage.getItem('user_role') === 'root'
const showPasswordDialog = ref(false)
const passwordForm = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })

// Cookie 管理（同 CrawlerAnalysis 模式）
const cookieStatus = ref<{ configured: boolean; masked: string }>({ configured: false, masked: '' })
const cookieEditing = ref(false)
const cookieInput = ref('')
const savingCookies = ref(false)

async function loadAll() {
  loading.value = true
  try {
    const [s, sch, au, ck] = await Promise.all([
      monitorApi.settings().catch(() => null),
      monitorApi.schedulerStatus().catch(() => null),
      monitorApi.autostart().catch(() => null),
      monitorApi.cookieStatus().catch(() => null),
    ])
    if (s) settings.value = s
    if (sch) scheduler.value = sch
    if (au) autostartEnabled.value = !!au.enabled
    if (ck) cookieStatus.value = ck
  } finally {
    loading.value = false
  }
}

function startCookieEdit() {
  cookieEditing.value = true
  cookieInput.value = ''
}

function cancelCookieEdit() {
  cookieEditing.value = false
  cookieInput.value = ''
}

async function saveCookies() {
  if (!cookieInput.value.trim()) {
    ElMessage.warning('请输入 Cookie')
    return
  }
  savingCookies.value = true
  try {
    await monitorApi.saveCookie(cookieInput.value.trim())
    ElMessage.success('Cookie 已保存')
    cookieEditing.value = false
    cookieInput.value = ''
    cookieStatus.value = await monitorApi.cookieStatus()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '保存失败')
  } finally {
    savingCookies.value = false
  }
}

async function saveSettings() {
  saving.value = true
  try {
    await monitorApi.saveSettings({
      interval_minutes: settings.value.interval_minutes,
      default_max_videos: settings.value.default_max_videos,
      port: settings.value.port,
    })
    ElMessage.success('设置已保存（轮询间隔即时生效；端口修改需重启）')
    scheduler.value = await monitorApi.schedulerStatus()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleAutostart(val: boolean | string | number) {
  autostartLoading.value = true
  try {
    if (val) {
      await monitorApi.enableAutostart()
      ElMessage.success('已启用开机自启动')
    } else {
      await monitorApi.disableAutostart()
      ElMessage.success('已关闭开机自启动')
    }
  } catch (e: any) {
    autostartEnabled.value = !val
    ElMessage.error(e?.response?.data?.message || '操作失败')
  } finally {
    autostartLoading.value = false
  }
}

async function backupDatabase() {
  backupLoading.value = true
  try {
    const result = await monitorApi.backupDatabase()
    ElMessage.success(result.message || '备份成功')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '备份失败')
  } finally {
    backupLoading.value = false
  }
}

async function clearAllData() {
  try {
    // 二次确认
    await ElMessageBox.confirm(
      '将清除所有采集数据（视频数据、历史快照、统计缓存），监测任务保留。此操作不可恢复！',
      '清除数据',
      { type: 'warning', confirmButtonText: '清除', confirmButtonClass: 'el-button--danger' }
    )
    await monitorApi.clearAllData()
    ElMessage.success('数据已清除（监测任务已保留）')
    // 刷新页面状态
    location.reload()
  } catch (e: any) {
    if (e !== 'cancel' && e?.message !== 'cancel') ElMessage.error('清除失败')
  }
}

async function shutdownServer() {
  try {
    await ElMessageBox.confirm('确认关闭后端服务？', '关闭服务', { type: 'warning' })
    await fetch('/api/system/shutdown', { method: 'POST' })
    ElMessage.success('服务已关闭')
  } catch (e: any) {
    if (e !== 'cancel' && e?.message !== 'cancel') ElMessage.error('关闭失败')
  }
}

onMounted(loadAll)

async function changePassword() {
  if (!passwordForm.value.oldPassword || !passwordForm.value.newPassword) {
    ElMessage.warning('请填写完整')
    return
  }
  if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    ElMessage.warning('两次密码不一致')
    return
  }
  try {
    await monitorApi.changePassword(passwordForm.value.oldPassword, passwordForm.value.newPassword)
    ElMessage.success('密码已修改，请重新登录')
    showPasswordDialog.value = false
    passwordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
    // 清除登录状态并跳转登录页
    await monitorApi.logout().catch(() => {})
    localStorage.removeItem('api_key')
    localStorage.removeItem('user_role')
    window.location.href = '#/login'
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '修改失败')
  }
}
</script>
