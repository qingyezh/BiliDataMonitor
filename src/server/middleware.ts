import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyApiKey, loadSessions, isUserLocked, recordFailedAttempt, type Session } from './auth.js'

const PUBLIC_PATHS = ['/api/auth/login', '/api/auth/check']

declare module 'fastify' {
  interface FastifyRequest {
    session?: Session
  }
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (PUBLIC_PATHS.some(p => req.url.startsWith(p))) return
  if (!req.url.startsWith('/api/')) return

  // 第一关：API Key 验证（每用户独立）
  const apiKey = req.headers['x-api-key'] as string
  if (!apiKey) {
    return reply.code(401).send({ success: false, message: '缺少 API Key' })
  }
  const keyResult = verifyApiKey(apiKey)
  if (!keyResult.valid) {
    return reply.code(401).send({ success: false, message: 'API Key 无效，请重新登录' })
  }

  // 第二关：检查账号是否被锁定
  if (keyResult.username && isUserLocked(keyResult.username)) {
    return reply.code(403).send({ success: false, message: '账号已被风控锁定，请联系管理员解锁' })
  }

  // 第三关：Cookie 登录态验证
  const token = req.cookies?.token
  const sessions = loadSessions()
  const session = token ? sessions.get(token) : undefined
  if (!session) {
    // 记录失败尝试（用于风控）
    if (keyResult.username) {
      recordFailedAttempt(keyResult.username)
    }
    return reply.code(401).send({ success: false, message: '未登录' })
  }

  // 验证 API Key 与 session 用户匹配
  if (session.username !== keyResult.username) {
    // 记录失败尝试（用于风控）
    if (keyResult.username) {
      recordFailedAttempt(keyResult.username)
    }
    return reply.code(401).send({ success: false, message: 'API Key 与登录用户不匹配' })
  }

  req.session = session
}

export async function requireRoot(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.session || req.session.role !== 'root') {
    reply.code(403).send({ success: false, message: '需要 root 权限' })
  }
}
