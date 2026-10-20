<template>
  <el-config-provider :locale="zhCn">
    <div class="layout">
      <header class="header">
        <div class="brand" @click="$router.push('/')">
          <span class="logo">📊</span>
          <span>BiliDataMonitor</span>
        </div>
        <nav>
          <el-tooltip
            v-if="cookieAlert"
            :content="cookieAlert.tip"
            placement="bottom"
          >
            <span class="cookie-alert" :title="cookieAlert.tip" @click="$router.push('/settings')">
              <el-badge is-dot type="danger" class="cookie-badge">
                <span class="cookie-alert-icon" aria-label="Cookie 需要关注">⚠️</span>
              </el-badge>
            </span>
          </el-tooltip>
          <el-tooltip
            v-if="cookieAgeLabel"
            :content="`距上次更新 ${cookieAgeLabel} · 点击打开设置`"
            placement="bottom"
          >
            <span
              class="cookie-age-chip"
              :class="`cookie-age-${cookieAgeLevel}`"
              @click="$router.push('/settings')"
            >
              Cookie {{ cookieAgeLabel }}
            </span>
          </el-tooltip>
          <el-button link @click="$router.push('/')">监测列表</el-button>
          <el-button link @click="$router.push('/compare')">对比</el-button>
          <el-button link @click="$router.push('/settings')">设置</el-button>
        </nav>
      </header>
      <main class="main">
        <router-view />
      </main>
    </div>
  </el-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { monitorApi, type CookieHealth } from './api/monitor'

const cookieHealth = ref<CookieHealth | null>(null)
/** 每分钟刷新，驱动时长文案 */
const nowTick = ref(Date.now())
const cookieAlert = computed(() => {
  const h = cookieHealth.value
  if (!h || !h.configured) return null
  if (h.reason === 'invalid') {
    return {
      tip: `B站 Cookie 已失效${h.message ? `（${h.message}）` : ''}，请点击前往设置更新`,
    }
  }
  if (h.reason === 'stale') {
    return {
      tip: 'B站 Cookie 已超过 72 小时未更新，建议刷新登录态',
    }
  }
  if (h.reason === 'unchecked') {
    return { tip: 'Cookie 尚未完成健康检查，稍候自动校验' }
  }
  return null
})

const cookieAgeHours = computed(() => {
  const h = cookieHealth.value
  if (!h || !h.configured) return null
  // 「距上次更新」= 用户保存 Cookie 的时间；未保存过则退回最近有效校验时间
  const anchor = h.lastSavedAt ?? h.lastValidAt ?? null
  if (!anchor) return null
  return Math.max(0, (nowTick.value - anchor) / 3_600_000)
})

const cookieAgeLabel = computed(() => {
  const h = cookieAgeHours.value
  if (h === null) return ''
  return `${h.toFixed(1)}h`
})

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

async function refreshCookieHealth() {
  try {
    cookieHealth.value = await monitorApi.cookieHealth()
  } catch {
    /* 未登录或网络失败时静默 */
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void refreshCookieHealth()
  timer = setInterval(() => {
    void refreshCookieHealth()
  }, 5 * 60 * 1000)
  tickTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 60 * 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (tickTimer) clearInterval(tickTimer)
})
</script>

<style>
:root {
  --bg: #f5f7fa;
  --card: #fff;
  --text: #303133;
  --text-secondary: #909399;
  --border: #e4e7ed;
  --primary: #409eff;
}
* { box-sizing: border-box; }
html, body, #app { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); }
.layout { display: flex; flex-direction: column; min-height: 100vh; }
.header { display: flex; align-items: center; justify-content: space-between; padding: 0 24px; height: 56px; background: var(--card); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 17px; cursor: pointer; }
.logo { font-size: 20px; }
.header nav { display: flex; align-items: center; gap: 8px; }
.cookie-alert { cursor: pointer; display: inline-flex; align-items: center; margin-right: 4px; }
.cookie-badge .el-badge__content.is-dot { top: 6px; right: 8px; }
.cookie-alert-icon { font-size: 16px; line-height: 1; }
.cookie-age-chip {
  display: inline-flex;
  align-items: center;
  margin-right: 8px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #fff;
  cursor: pointer;
  line-height: 1.5;
}
.cookie-age-chip.cookie-age-ok { background: #67c23a; }
.cookie-age-chip.cookie-age-warn { background: #e6a23c; }
.cookie-age-chip.cookie-age-danger { background: #f56c6c; }
.main { flex: 1; padding: 20px 24px; max-width: 1400px; width: 100%; margin: 0 auto; }
.content-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.card-title { font-weight: 600; font-size: 15px; margin-bottom: 12px; }
</style>
