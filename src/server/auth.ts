import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_DIR } from './config.js'

export const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json')
export const USERS_FILE = path.join(CONFIG_DIR, 'users.json')
export const SESSION_FILE = path.join(CONFIG_DIR, 'sessions.json')
export const RISK_FILE = path.join(CONFIG_DIR, 'risk_control.json')

export interface RootConfig {
  username: string
  passwordHash: string
  salt: string
  apiKeyHash: string
}

export interface UserConfig {
  username: string
  passwordHash: string
  salt: string
  apiKeyHash: string
  locked?: boolean
  lockedAt?: number
}

export interface Session {
  username: string
  role: 'root' | 'user'
  apiKey: string
  createdAt: number
}

interface RiskRecord {
  attempts: { timestamp: number }[]
  locked: boolean
  lockedAt?: number
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

export function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  const bytes = crypto.randomBytes(128)
  for (let i = 0; i < 128; i++) {
    result += chars[bytes[i] % chars.length]
  }
  return result
}

export function loadRoot(): RootConfig {
  if (!fs.existsSync(AUTH_FILE)) {
    const salt = crypto.randomBytes(16).toString('hex')
    const config: RootConfig = {
      username: 'qingyeqy',
      passwordHash: hashPassword('qingye@120177', salt),
      salt,
      apiKeyHash: '',
    }
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true })
    fs.writeFileSync(AUTH_FILE, JSON.stringify(config, null, 2))
    process.stderr.write('========================================\n')
    process.stderr.write('  首次运行，已生成默认凭据：\n')
    process.stderr.write('  账号: qingyeqy\n')
    process.stderr.write('  密码: qingye@120177\n')
    process.stderr.write('  请登录后妥善保管 API Key！\n')
    process.stderr.write('========================================\n')
    return config
  }
  return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'))
}

export function loadUsers(): UserConfig[] {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'))
  } catch {
    return []
  }
}

export function saveUsers(users: UserConfig[]) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2))
}

export function loadSessions(): Map<string, Session> {
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'))
    return new Map(Object.entries(data))
  } catch {
    return new Map()
  }
}

export function saveSessions(sessions: Map<string, Session>) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2))
}

export function verifyRootPassword(password: string): boolean {
  const root = loadRoot()
  return hashPassword(password, root.salt) === root.passwordHash
}

export function verifyUserPassword(username: string, password: string): boolean {
  const users = loadUsers()
  const user = users.find(u => u.username === username)
  if (!user) return false
  return hashPassword(password, user.salt) === user.passwordHash
}

export function verifyApiKey(apiKey: string): { valid: boolean; username?: string; role?: 'root' | 'user' } {
  const root = loadRoot()
  if (root.apiKeyHash && hashApiKey(apiKey) === root.apiKeyHash) {
    return { valid: true, username: root.username, role: 'root' }
  }
  const users = loadUsers()
  for (const user of users) {
    if (user.apiKeyHash && hashApiKey(apiKey) === user.apiKeyHash) {
      return { valid: true, username: user.username, role: 'user' }
    }
  }
  return { valid: false }
}

export function setRootApiKey(apiKey: string): void {
  const root = loadRoot()
  root.apiKeyHash = hashApiKey(apiKey)
  fs.writeFileSync(AUTH_FILE, JSON.stringify(root, null, 2))
}

export function setUserApiKey(username: string, apiKey: string): void {
  const users = loadUsers()
  const user = users.find(u => u.username === username)
  if (user) {
    user.apiKeyHash = hashApiKey(apiKey)
    saveUsers(users)
  }
}

export function changeRootPassword(oldPassword: string, newPassword: string): boolean {
  if (!verifyRootPassword(oldPassword)) return false
  const root = loadRoot()
  const newSalt = crypto.randomBytes(16).toString('hex')
  root.salt = newSalt
  root.passwordHash = hashPassword(newPassword, newSalt)
  fs.writeFileSync(AUTH_FILE, JSON.stringify(root, null, 2))
  return true
}

export function addUser(username: string, password: string): boolean {
  const users = loadUsers()
  if (users.some(u => u.username === username)) return false
  const salt = crypto.randomBytes(16).toString('hex')
  users.push({ username, passwordHash: hashPassword(password, salt), salt, apiKeyHash: '' })
  saveUsers(users)
  return true
}

export function removeUser(username: string): boolean {
  const users = loadUsers()
  const idx = users.findIndex(u => u.username === username)
  if (idx === -1) return false
  users.splice(idx, 1)
  saveUsers(users)
  return true
}

// --- 风控管理 ---

function loadRiskData(): Record<string, RiskRecord> {
  try {
    return JSON.parse(fs.readFileSync(RISK_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function saveRiskData(data: Record<string, RiskRecord>) {
  fs.writeFileSync(RISK_FILE, JSON.stringify(data, null, 2))
}

const MAX_ATTEMPTS = 3
const WINDOW_MS = 24 * 60 * 60 * 1000 // 24小时

export function recordFailedAttempt(username: string): void {
  // root 不受风控限制
  const root = loadRoot()
  if (username === root.username) return

  const data = loadRiskData()
  if (!data[username]) {
    data[username] = { attempts: [], locked: false }
  }

  const record = data[username]
  const now = Date.now()

  // 清理过期记录
  record.attempts = record.attempts.filter(a => now - a.timestamp < WINDOW_MS)

  // 记录本次失败
  record.attempts.push({ timestamp: now })

  // 检查是否触发风控
  if (record.attempts.length >= MAX_ATTEMPTS) {
    record.locked = true
    record.lockedAt = now
    // 同时锁定用户
    const users = loadUsers()
    const user = users.find(u => u.username === username)
    if (user) {
      user.locked = true
      user.lockedAt = now
      saveUsers(users)
    }
  }

  saveRiskData(data)
}

export function isUserLocked(username: string): boolean {
  // root 永不锁定
  const root = loadRoot()
  if (username === root.username) return false

  const users = loadUsers()
  const user = users.find(u => u.username === username)
  return user?.locked === true
}

export function unlockUser(username: string): boolean {
  const users = loadUsers()
  const user = users.find(u => u.username === username)
  if (!user) return false

  user.locked = false
  user.lockedAt = undefined
  saveUsers(users)

  // 清除风控记录
  const data = loadRiskData()
  delete data[username]
  saveRiskData(data)

  return true
}

export function getLockedUsers(): { username: string; lockedAt: number }[] {
  const users = loadUsers()
  return users
    .filter(u => u.locked)
    .map(u => ({ username: u.username, lockedAt: u.lockedAt || 0 }))
}
