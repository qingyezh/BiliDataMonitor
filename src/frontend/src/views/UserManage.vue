<template>
  <div class="content-card">
    <div class="card-title">用户管理</div>

    <el-table :data="users" style="width: 100%; margin-bottom: 16px">
      <el-table-column prop="username" label="用户名" />
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag :type="row.locked ? 'danger' : 'success'" size="small">
            {{ row.locked ? '已锁定' : '正常' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button v-if="row.locked" type="warning" size="small" @click="handleUnlock(row.username)">解锁</el-button>
          <el-button type="danger" size="small" @click="handleRemove(row.username)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-form inline style="margin-bottom: 16px">
      <el-form-item label="用户名">
        <el-input v-model="newUsername" placeholder="用户名" />
      </el-form-item>
      <el-form-item label="密码">
        <el-input v-model="newPassword" type="password" placeholder="密码" show-password />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="handleAdd">添加用户</el-button>
      </el-form-item>
    </el-form>

    <el-divider />
    <p style="color: var(--text-secondary); font-size: 13px">
      每个用户登录后会自动生成独立的 API Key，用于请求认证。<br/>
      24小时内连续3次 API Key 校验失败将触发风控锁定，需 root 手动解锁。
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { monitorApi } from '../api/monitor'

const users = ref<{ username: string; locked: boolean; lockedAt?: number }[]>([])
const newUsername = ref('')
const newPassword = ref('')

async function loadUsers() {
  users.value = await monitorApi.getUsers()
}

async function handleAdd() {
  if (!newUsername.value || !newPassword.value) return ElMessage.warning('请填写完整')
  try {
    await monitorApi.addUser(newUsername.value, newPassword.value)
    ElMessage.success('用户已添加')
    newUsername.value = ''
    newPassword.value = ''
    loadUsers()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '添加失败')
  }
}

async function handleRemove(username: string) {
  await ElMessageBox.confirm(`确认删除用户 ${username}？`, '删除用户', { type: 'warning' })
  await monitorApi.removeUser(username)
  ElMessage.success('用户已删除')
  loadUsers()
}

async function handleUnlock(username: string) {
  await ElMessageBox.confirm(`确认解锁用户 ${username}？`, '解锁用户', { type: 'warning' })
  try {
    await monitorApi.unlockUser(username)
    ElMessage.success('用户已解锁')
    loadUsers()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '解锁失败')
  }
}

onMounted(loadUsers)
</script>
