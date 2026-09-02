<template>
  <el-config-provider :locale="zhCn">
    <div class="layout">
      <header class="header">
        <div class="brand" @click="$router.push('/')">
          <span class="logo">📊</span>
          <span>BiliDataMonitor</span>
        </div>
        <nav>
          <el-button link @click="$router.push('/')">监测列表</el-button>
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
import zhCn from 'element-plus/es/locale/lang/zh-cn'
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
.main { flex: 1; padding: 20px 24px; max-width: 1400px; width: 100%; margin: 0 auto; }
.content-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.card-title { font-weight: 600; font-size: 15px; margin-bottom: 12px; }
</style>
