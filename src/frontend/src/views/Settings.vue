<template>
  <div v-loading="loading">
    <!-- 上排：监测设置 + 调度器状态 两列 -->
    <div class="settings-top-row">
      <div class="content-card settings-col">
        <div class="card-title">⚙️ 监测设置</div>
        <el-form label-width="140px" size="default" style="max-width: 520px">
          <el-form-item label="轮询间隔">
            <el-select v-model="settings.interval_minutes" style="width: 200px">
              <el-option v-for="m in [5, 10, 15, 30, 60, 120, 240, 360, 720, 1440]" :key="m" :value="m" :label="m >= 1440 ? '24小时' : m >= 60 ? `${m / 60}小时` : `${m}分钟`" />
            </el-select>
            <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px">系统启动后每间隔自动轮询，即时生效</span>
          </el-form-item>
          <el-form-item label="默认监测数">
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

      <div class="settings-right">
        <div class="content-card settings-col">
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

        <div class="content-card settings-col">
          <div class="card-title">🖥️ 系统</div>
          <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap">
            <el-button v-if="isRoot" size="small" type="primary" :loading="backupLoading" @click="backupDatabase">备份数据库</el-button>
            <el-button v-if="isRoot" size="small" type="danger" @click="clearAllData">清除数据</el-button>
            <el-button v-if="isRoot" size="small" type="primary" plain @click="$router.push('/users')">用户管理</el-button>
            <el-button v-if="isRoot" size="small" @click="showPasswordDialog = true">修改密码</el-button>
          </div>
        </div>
      </div>
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
            <!-- 单按钮：未编辑=修改；编辑中=覆盖（无有效内容灰色，有内容可点）点击即保存 -->
            <el-button
              v-if="isRoot"
              :type="cookieEditing ? (cookieValid ? 'primary' : 'default') : 'default'"
              :disabled="cookieEditing && !cookieValid"
              :loading="savingCookies"
              @click="onCookieButtonClick"
            >
              {{ cookieEditing ? '覆盖' : '修改' }}
            </el-button>
          </div>
          <div v-if="cookieHealthLine || cookieAgeLabel" class="cookie-health-row">
            <div
              class="cookie-health"
              :class="`cookie-age-${cookieAgeLevel}`"
              :style="{ color: cookieHealthColor }"
            >
              <span v-if="cookieAgeLabel" class="cookie-age-box" :class="`cookie-age-${cookieAgeLevel}`">
                距上次更新 {{ cookieAgeLabel }}
              </span>
              <span class="cookie-health-text">{{ cookieHealthLine }}</span>
            </div>
          </div>
        </el-form-item>
      </el-form>
    </div>

    <!-- 近重复历史点清理 -->
    <div class="content-card" v-if="isRoot">
      <div class="card-title" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
        <span>🧹 近重复数据点清理</span>
        <el-button size="small" type="primary" :loading="dupScanning" @click="scanNearDuplicates">扫描</el-button>
        <el-button
          v-if="dupPairs.length"
          size="small"
          plain
          type="warning"
          @click="selectAllSuggested"
        >
          按推荐全选（{{ dupPairs.length }}）
        </el-button>
        <el-button
          v-if="dupSelection.some(x => x)"
          size="small"
          plain
          @click="clearDupSelection"
        >
          清空选择
        </el-button>
        <span style="font-size: 12px; color: var(--text-secondary)">同一目标相邻点间隔 &lt; 4s（双实例脏数据），两点并列展示，请勾选要删除的一条</span>
      </div>
      <el-empty v-if="!dupScanning && !dupPairs.length && dupScanned" description="未发现近重复点" :image-size="60" />
      <div v-for="(p, i) in dupPairs" :key="i" class="dup-pair">
        <div class="dup-head">
          <el-tag size="small">{{ typeLabel(p.kind) }}</el-tag>
          <span class="dup-target">{{ p.target }}</span>
          <span class="dup-gap">Δt {{ p.gapMs }}ms</span>
          <el-button size="small" text type="primary" @click="suggestSelect(p)">按建议勾选较小值</el-button>
        </div>
        <el-radio-group v-model="dupSelection[i]" size="small">
          <el-radio :value="Number(p.a.id)">
            id={{ p.a.id }} · {{ formatTimestamp(Number(p.a.created_at)) }} ·
            <span v-for="(v, k) in metricPreview(p.a)" :key="k" style="margin-left: 6px">{{ k }} {{ v }}</span>
          </el-radio>
          <el-radio :value="Number(p.b.id)">
            id={{ p.b.id }} · {{ formatTimestamp(Number(p.b.created_at)) }} ·
            <span v-for="(v, k) in metricPreview(p.b)" :key="k" style="margin-left: 6px">{{ k }} {{ v }}</span>
          </el-radio>
        </el-radio-group>
      </div>
      <div v-if="dupPairs.length" style="margin-top: 12px">
        <el-button type="danger" size="small" :loading="dupDeleting" :disabled="!dupSelection.some(x => x)" @click="deleteSelectedDups">
          删除选中（{{ dupSelection.filter(x => x).length }}）
        </el-button>
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Key } from '@element-plus/icons-vue'
import { monitorApi, type AppSettings, type NearDuplicatePair, type HistoryKind, type CookieHealth } from '../api/monitor'
import { formatTimestamp, formatNum } from '../utils/format'

const loading = ref(false)
const saving = ref(false)
const settings = ref<AppSettings>({ port: 8123, interval_minutes: 30, default_max_videos: 10, cookie_mask: '', open_browser: true })
const scheduler = ref<any>({})
const backupLoading = ref(false)
const isRoot = localStorage.getItem('user_role') === 'root'
const showPasswordDialog = ref(false)
const passwordForm = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })

// Cookie 管理（同 CrawlerAnalysis 模式）
const cookieStatus = ref<{ configured: boolean; masked: string }>({ configured: false, masked: '' })
const cookieHealth = ref<CookieHealth | null>(null)
const nowTick = ref(Date.now())
let healthTickTimer: ReturnType<typeof setInterval> | null = null
const cookieEditing = ref(false)
const cookieInput = ref('')
const savingCookies = ref(false)

// 近重复清理
const dupScanning = ref(false)
const dupScanned = ref(false)
const dupDeleting = ref(false)
const dupPairs = ref<NearDuplicatePair[]>([])
const dupSelection = ref<number[]>([])

function typeLabel(t: HistoryKind) {
  return ({ up: 'UP', video: '视频', dynamic: '动态', column: '专栏' } as const)[t] || t
}

function metricPreview(row: Record<string, number | string>) {
  const keys = ['total_views', 'total_danmaku', 'total_comments', 'play', 'video_review', 'comment', 'like_count', 'reply_count', 'forward_count', 'favorite_count']
  const out: Record<string, string> = {}
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && k !== 'id' && k !== 'created_at') {
      out[k] = formatNum(Number(row[k]))
    }
  }
  return out
}

function suggestSelect(p: NearDuplicatePair) {
  const i = dupPairs.value.indexOf(p)
  if (i >= 0) dupSelection.value[i] = p.suggestDropId
}

/** 自动勾选全部推荐删除（累计指标较小的一侧） */
function selectAllSuggested() {
  dupSelection.value = dupPairs.value.map(p => Number(p.suggestDropId) || 0)
  ElMessage.success(`已按推荐勾选 ${dupSelection.value.filter(x => x).length} 条`)
}

function clearDupSelection() {
  dupSelection.value = dupPairs.value.map(() => 0)
}

async function scanNearDuplicates() {
  dupScanning.value = true
  try {
    dupPairs.value = await monitorApi.nearDuplicates(4000, 200)
    dupSelection.value = dupPairs.value.map(() => 0)
    dupScanned.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '扫描失败')
  } finally {
    dupScanning.value = false
  }
}

async function deleteSelectedDups() {
  const picks = dupSelection.value.map((id, i) => (id ? { id, pair: dupPairs.value[i] } : null)).filter(Boolean) as { id: number; pair: NearDuplicatePair }[]
  if (!picks.length) return
  try {
    await ElMessageBox.confirm(
      `将删除勾选的 ${picks.length} 条历史快照，不可恢复。两点都已展示，请确认删除的是错误数据。`,
      '删除近重复点',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  dupDeleting.value = true
  try {
    for (const p of picks) {
      await monitorApi.deleteHistoryPoint(p.pair.kind, p.id)
    }
    ElMessage.success(`已删除 ${picks.length} 条`)
    await scanNearDuplicates()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '删除失败')
  } finally {
    dupDeleting.value = false
  }
}

async function loadAll() {
  loading.value = true
  try {
    const [s, sch, ck, ch] = await Promise.all([
      monitorApi.settings().catch(() => null),
      monitorApi.schedulerStatus().catch(() => null),
      monitorApi.cookieStatus().catch(() => null),
      monitorApi.cookieHealth().catch(() => null),
    ])
    if (s) settings.value = s
    if (sch) scheduler.value = sch
    if (ck) cookieStatus.value = ck
    if (ch) cookieHealth.value = ch
  } finally {
    loading.value = false
  }
}

const cookieHealthLine = computed(() => {
  const h = cookieHealth.value
  if (!h || !h.configured) return ''
  const fmt = (ts: number | null) => (ts ? formatTimestamp(ts) : '—')
  const base = `上次检查 ${fmt(h.lastCheckedAt)} · 登录态 ${h.valid ? '有效' : h.reason === 'stale' ? '有效但超时' : '无效'}`
  if (h.reason === 'invalid') return `${base}（${h.message || '请更新 Cookie'}）`
  if (h.reason === 'stale') return `${base} · 已超 72 小时，建议更新`
  if (h.reason === 'unchecked') return 'Cookie 尚未检查，服务启动后约 15 分钟内完成'
  return `${base} · 最近有效 ${fmt(h.lastValidAt)}`
})

/** 距上次更新锚点：有效校验时间与保存时间取较新者 */
const cookieUpdatedAnchor = computed(() => {
  const h = cookieHealth.value
  if (!h || !h.configured) return null
  return Math.max(h.lastValidAt || 0, h.lastSavedAt || 0) || null
})

const cookieAgeHours = computed(() => {
  const anchor = cookieUpdatedAnchor.value
  if (!anchor) return null
  return Math.max(0, (nowTick.value - anchor) / 3_600_000)
})

const cookieAgeLabel = computed(() => {
  const h = cookieAgeHours.value
  if (h === null) return ''
  return `${h.toFixed(1)} 小时`
})

/** 绿 <48h；黄 48–72h；红 >72h 或登录态无效 */
const cookieAgeLevel = computed<'ok' | 'warn' | 'danger'>(() => {
  const h = cookieHealth.value
  if (!h || !h.configured) return 'ok'
  if (!h.valid || h.reason === 'invalid') return 'danger'
  const hours = cookieAgeHours.value
  if (hours === null) return 'warn'
  if (hours > 72) return 'danger'
  if (hours >= 48) return 'warn'
  return 'ok'
})

const cookieHealthColor = computed(() => {
  const level = cookieAgeLevel.value
  if (level === 'danger') return '#f56c6c'
  if (level === 'warn') return '#e6a23c'
  return '#67c23a'
})

function startCookieEdit() {
  cookieEditing.value = true
  cookieInput.value = ''
}

/** 输入框是否为有效 Cookie（非空且像 Cookie 串） */
const cookieValid = computed(() => {
  const v = cookieInput.value.trim()
  if (v.length < 20) return false
  return v.includes('=') && (v.includes(';') || v.toLowerCase().includes('sessdata') || v.includes('bili_jct'))
})

/** 单按钮：修改 → 进入编辑；覆盖 → 有效时自动保存 */
function onCookieButtonClick() {
  if (!cookieEditing.value) {
    startCookieEdit()
    return
  }
  if (!cookieValid.value) return
  void saveCookies()
}

async function saveCookies() {
  if (!cookieValid.value) {
    ElMessage.warning('请输入有效 Cookie')
    return
  }
  savingCookies.value = true
  try {
    await monitorApi.saveCookie(cookieInput.value.trim())
    ElMessage.success('Cookie 已保存')
    cookieEditing.value = false
    cookieInput.value = ''
    cookieStatus.value = await monitorApi.cookieStatus()
    cookieHealth.value = await monitorApi.cookieHealth().catch(() => null)
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

onMounted(() => {
  void loadAll()
  healthTickTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 60 * 1000)
})

onUnmounted(() => {
  if (healthTickTimer) clearInterval(healthTickTimer)
})

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

<style scoped>
.settings-top-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
  align-items: stretch;
}
.settings-col {
  margin-bottom: 0;
  min-width: 0;
}
.settings-right {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.settings-top-row > .settings-col {
  height: 100%;
}
.settings-right .settings-col {
  flex: 1 1 auto;
}
@media (max-width: 1100px) {
  .settings-top-row {
    grid-template-columns: 1fr;
  }
}
.cookie-health-row {
  margin-top: 8px;
}
.cookie-health {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  line-height: 1.4;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
}
.cookie-health-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cookie-age-box {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 7.5em;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  line-height: 1.5;
  color: #fff;
}
.cookie-health.cookie-age-ok {
  background: rgba(103, 194, 58, 0.12);
  border-color: rgba(103, 194, 58, 0.35);
}
.cookie-health.cookie-age-warn {
  background: rgba(230, 162, 60, 0.14);
  border-color: rgba(230, 162, 60, 0.4);
}
.cookie-health.cookie-age-danger {
  background: rgba(245, 108, 108, 0.14);
  border-color: rgba(245, 108, 108, 0.45);
}
.cookie-age-box.cookie-age-ok {
  background: #67c23a;
}
.cookie-age-box.cookie-age-warn {
  background: #e6a23c;
}
.cookie-age-box.cookie-age-danger {
  background: #f56c6c;
}
.dup-pair {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
  background: var(--bg);
}
.dup-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.dup-target {
  font-weight: 600;
  word-break: break-all;
}
.dup-gap {
  color: #e6a23c;
  font-size: 12px;
}
.dup-pair :deep(.el-radio) {
  display: flex;
  margin-right: 0;
  margin-bottom: 4px;
  white-space: normal;
  height: auto;
}
</style>
