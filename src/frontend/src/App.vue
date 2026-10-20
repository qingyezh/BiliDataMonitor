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

async function refreshCookieHealth() {
  try {
    cookieHealth.value = await monitorApi.cookieHealth()
  } catch {
    /* 未登录或网络失败时静默 */
  }
}

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void refreshCookieHealth()
  timer = setInterval(() => {
    void refreshCookieHealth()
  }, 5 * 60 * 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
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
.main { flex: 1; padding: 20px 24px; max-width: 1400px; width: 100%; margin: 0 auto; }
.content-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.card-title { font-weight: 600; font-size: 15px; margin-bottom: 12px; }
</style>
