<template>
  <div class="login-container">
    <el-card class="login-card">
      <template #header>
        <div class="card-header">BiliDataMonitor</div>
      </template>
      <el-form @submit.prevent="handleLogin">
        <el-form-item label="用户名">
          <el-input v-model="username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="password" type="password" placeholder="请输入密码" show-password />
        </el-form-item>
        <el-form-item v-if="apiKey">
          <el-alert type="success" :closable="false" show-icon>
            <template #title>
              <span>登录成功！您的 API Key（已自动保存）：</span>
            </template>
            <div style="word-break: break-all; font-family: monospace; font-size: 12px; margin-top: 4px">
              {{ apiKey }}
            </div>
          </el-alert>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="handleLogin" style="width: 100%">
            登录
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { monitorApi } from '../api/monitor'

const router = useRouter()
const username = ref('')
const password = ref('')
const apiKey = ref('')
const loading = ref(false)

async function handleLogin() {
  if (!username.value || !password.value) {
    ElMessage.warning('请填写用户名和密码')
    return
  }
  loading.value = true
  try {
    const res = await monitorApi.login(username.value, password.value)
    // 保存 API Key（服务器生成，每用户独立）
    localStorage.setItem('api_key', res.apiKey)
    localStorage.setItem('user_role', res.role)
    localStorage.setItem('username', username.value)
    apiKey.value = res.apiKey
    ElMessage.success('登录成功')
    setTimeout(() => router.push('/'), 1500)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #f5f7fa;
}
.login-card { width: 420px; }
.card-header { font-size: 20px; font-weight: bold; text-align: center; }
</style>
