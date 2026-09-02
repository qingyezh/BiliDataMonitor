import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import crypto from 'node:crypto'
import {
  loadRoot, verifyRootPassword, verifyUserPassword,
  changeRootPassword, generateApiKey, setRootApiKey, setUserApiKey,
  addUser, removeUser, loadUsers, isUserLocked, unlockUser, getLockedUsers,
  loadSessions, saveSessions,
} from '../auth.js'

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  // 登录（root 或普通用户）
  app.post('/login', async (req, reply) => {
    const { username, password } = req.body as { username: string; password: string }
    const root = loadRoot()
    let role: 'root' | 'user' | null = null
    if (username === root.username && verifyRootPassword(password)) {
      role = 'root'
    } else if (verifyUserPassword(username, password)) {
      // 检查账号是否被锁定
      if (isUserLocked(username)) {
        return reply.code(403).send({ success: false, message: '账号已被风控锁定，请联系管理员解锁' })
      }
      role = 'user'
    }
    if (!role) {
      return reply.code(401).send({ success: false, message: '用户名或密码错误' })
    }

    // 生成独立 API Key（128位字母数字混合）
    const apiKey = generateApiKey()

    // 存储 API Key 哈希
    if (role === 'root') {
      setRootApiKey(apiKey)
    } else {
      setUserApiKey(username, apiKey)
    }

    // 创建 session
    const token = crypto.randomBytes(32).toString('hex')
    const sessions = loadSessions()
    sessions.set(token, { username, role, apiKey, createdAt: Date.now() })
    saveSessions(sessions)

    reply.setCookie('token', token, {
      path: '/', httpOnly: true, maxAge: 7 * 24 * 3600, sameSite: 'lax',
    })
    return { success: true, data: { role, apiKey } }
  })

  // 检查登录状态
  app.get('/check', async (req) => {
    const token = req.cookies?.token
    const sessions = loadSessions()
    const session = token ? sessions.get(token) : null
    return { success: true, data: { loggedIn: !!session, role: session?.role, username: session?.username } }
  })

  // 退出登录
  app.post('/logout', async (req, reply) => {
    const token = req.cookies?.token
    if (token) {
      const sessions = loadSessions()
      sessions.delete(token)
      saveSessions(sessions)
    }
    reply.clearCookie('token', { path: '/' })
    return { success: true }
  })

  // --- root 专属接口 ---

  // 修改 root 密码
  app.put('/password', { preHandler: [requireRootHandler] }, async (req) => {
    const { oldPassword, newPassword } = req.body as { oldPassword: string; newPassword: string }
    if (changeRootPassword(oldPassword, newPassword)) {
      return { success: true, message: '密码已修改' }
    }
    return { success: false, message: '旧密码错误' }
  })

  // 查看普通用户列表
  app.get('/users', { preHandler: [requireRootHandler] }, async () => {
    const users = loadUsers().map(u => ({ username: u.username, locked: u.locked || false, lockedAt: u.lockedAt }))
    return { success: true, data: users }
  })

  // 添加普通用户
  app.post('/users', { preHandler: [requireRootHandler] }, async (req, reply) => {
    const { username, password } = req.body as { username: string; password: string }
    if (!username || !password) return reply.code(400).send({ success: false, message: '缺少参数' })
    if (addUser(username, password)) return { success: true, message: '用户已添加' }
    return reply.code(400).send({ success: false, message: '用户名已存在' })
  })

  // 删除普通用户
  app.delete('/users/:username', { preHandler: [requireRootHandler] }, async (req, reply) => {
    const { username } = req.params as { username: string }
    if (removeUser(username)) return { success: true, message: '用户已删除' }
    return reply.code(404).send({ success: false, message: '用户不存在' })
  })

  // 解锁被风控锁定的用户
  app.post('/users/:username/unlock', { preHandler: [requireRootHandler] }, async (req, reply) => {
    const { username } = req.params as { username: string }
    if (unlockUser(username)) return { success: true, message: '用户已解锁' }
    return reply.code(404).send({ success: false, message: '用户不存在' })
  })

  // 查看被风控锁定的用户
  app.get('/locked-users', { preHandler: [requireRootHandler] }, async () => {
    const lockedUsers = getLockedUsers()
    return { success: true, data: lockedUsers }
  })
}

async function requireRootHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!req.session || req.session.role !== 'root') {
    reply.code(403).send({ success: false, message: '需要 root 权限' })
  }
}
