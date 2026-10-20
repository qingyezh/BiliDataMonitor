// B站 Cookie 健康检查（nav isLogin）
// 时间戳持久化到 cookie_config.json.health，避免重启后「距上次更新」被重置为 0
import fs from 'node:fs'
import { COOKIE_PATH, getCookie } from './config.js'
import { logger } from './logger.js'
import { createHash } from 'node:crypto'

export const COOKIE_CHECK_INTERVAL_MS = 15 * 60 * 1000
export const COOKIE_STALE_HOURS = 72

export interface CookieHealth {
  configured: boolean
  valid: boolean
  code: number | null
  message: string | null
  lastCheckedAt: number | null
  lastValidAt: number | null
  lastSavedAt: number | null
  /** true = 已配置且有效，但距「上次更新」超过 72h，建议刷新 */
  stale: boolean
  reason: 'ok' | 'empty' | 'invalid' | 'stale' | 'unchecked'
}

interface PersistedHealth {
  valid: boolean
  code: number | null
  message: string | null
  lastCheckedAt: number | null
  lastValidAt: number | null
  lastSavedAt: number | null
  /** cookie 内容指纹：内容变化时可识别为「已更新」 */
  cookieHash: string | null
}

const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

function emptyPersisted(): PersistedHealth {
  return {
    valid: false,
    code: null,
    message: null,
    lastCheckedAt: null,
    lastValidAt: null,
    lastSavedAt: null,
    cookieHash: null,
  }
}

function hashCookie(cookie: string): string {
  return createHash('sha256').update(cookie.trim()).digest('hex').slice(0, 32)
}

function readCookieFile(): Record<string, unknown> {
  try {
    if (fs.existsSync(COOKIE_PATH)) {
      return JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf-8'))
    }
  } catch {
    /* ignore */
  }
  return {}
}

function persistHealth(h: PersistedHealth): void {
  try {
    const existing = readCookieFile()
    existing.health = h
    fs.mkdirSync(COOKIE_PATH.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
    fs.writeFileSync(COOKIE_PATH, JSON.stringify(existing, null, 2), 'utf-8')
  } catch (e) {
    logger.warn(`[Cookie] 健康时间戳写入失败: ${(e as Error).message}`)
  }
}

function loadPersisted(): PersistedHealth {
  const raw = readCookieFile()
  const h = raw.health
  if (!h || typeof h !== 'object') return emptyPersisted()
  const o = h as Partial<PersistedHealth>
  return {
    valid: Boolean(o.valid),
    code: typeof o.code === 'number' ? o.code : null,
    message: typeof o.message === 'string' ? o.message : null,
    lastCheckedAt: typeof o.lastCheckedAt === 'number' ? o.lastCheckedAt : null,
    lastValidAt: typeof o.lastValidAt === 'number' ? o.lastValidAt : null,
    lastSavedAt: typeof o.lastSavedAt === 'number' ? o.lastSavedAt : null,
    cookieHash: typeof o.cookieHash === 'string' ? o.cookieHash : null,
  }
}

let memory: PersistedHealth = loadPersisted()
let checking = false
let timer: ReturnType<typeof setInterval> | null = null

/** 「距上次更新」锚点：优先 lastSavedAt（用户保存 Cookie），其次 lastValidAt */
export function updateAnchorAt(h: Pick<CookieHealth, 'lastSavedAt' | 'lastValidAt'>): number | null {
  return h.lastSavedAt ?? h.lastValidAt ?? null
}

export function getCachedCookieHealth(): CookieHealth {
  return decorate(memory)
}

function decorate(h: PersistedHealth): CookieHealth {
  const configured = Boolean(getCookie())
  const base = {
    valid: h.valid,
    code: h.code,
    message: h.message,
    lastCheckedAt: h.lastCheckedAt,
    lastValidAt: h.lastValidAt,
    lastSavedAt: h.lastSavedAt,
  }
  if (!configured) {
    return { ...base, configured: false, valid: false, stale: false, reason: 'empty' }
  }
  if (h.lastCheckedAt === null) {
    return { ...base, configured: true, valid: false, stale: false, reason: 'unchecked' }
  }
  const anchor = updateAnchorAt(base)
  const stale =
    !h.valid ||
    (anchor !== null && Date.now() - anchor > COOKIE_STALE_HOURS * 3600 * 1000)
  let reason: CookieHealth['reason'] = 'ok'
  if (!h.valid) reason = 'invalid'
  else if (stale) reason = 'stale'
  return { ...base, configured: true, valid: h.valid, stale, reason }
}

/** 写入 cookie 后标记「已更新」时间锁，并立即检查 */
export async function onCookieSaved(): Promise<CookieHealth> {
  const cookie = getCookie().trim()
  memory = {
    ...memory,
    lastSavedAt: Date.now(),
    cookieHash: cookie ? hashCookie(cookie) : null,
  }
  persistHealth(memory)
  await checkCookieHealth(true)
  return getCachedCookieHealth()
}

export async function checkCookieHealth(force = false): Promise<CookieHealth> {
  if (checking) return getCachedCookieHealth()
  checking = true
  try {
    const cookie = getCookie().trim()
    const now = Date.now()
    if (!cookie) {
      memory = {
        ...emptyPersisted(),
        lastCheckedAt: now,
        lastValidAt: memory.lastValidAt,
        lastSavedAt: memory.lastSavedAt,
        cookieHash: memory.cookieHash,
      }
      persistHealth(memory)
      return getCachedCookieHealth()
    }

    const cookieHash = hashCookie(cookie)
    // 内容变了但未走 save 接口（例如手工改文件）→ 记为一次更新
    if (memory.cookieHash && memory.cookieHash !== cookieHash && !memory.lastSavedAt) {
      memory = { ...memory, lastSavedAt: now, cookieHash }
    } else if (!memory.cookieHash) {
      memory = { ...memory, cookieHash }
      // 首次纳入管理：若无 lastSavedAt，用当前 cookie 的保存时间来自文件 mtime
      if (!memory.lastSavedAt) {
        try {
          memory.lastSavedAt = Math.floor(fs.statSync(COOKIE_PATH).mtimeMs)
        } catch {
          memory.lastSavedAt = now
        }
      }
      persistHealth(memory)
    } else if (memory.cookieHash !== cookieHash) {
      memory = { ...memory, lastSavedAt: now, cookieHash }
      persistHealth(memory)
    }

    // 避免过于频繁（force 用于保存后立即校验）
    if (!force && memory.lastCheckedAt && now - memory.lastCheckedAt < COOKIE_CHECK_INTERVAL_MS - 60_000) {
      return getCachedCookieHealth()
    }

    let code: number | null = null
    let valid = false
    let message: string | null = null
    try {
      const res = await fetch(`${NAV_URL}?_=${now}`, {
        headers: {
          Cookie: cookie,
          'User-Agent': USER_AGENT,
          Referer: 'https://www.bilibili.com/',
          Origin: 'https://www.bilibili.com',
        },
        signal: AbortSignal.timeout(10_000),
      })
      const data = (await res.json()) as { code?: number; message?: string; msg?: string; data?: { isLogin?: boolean } }
      code = typeof data.code === 'number' ? data.code : null
      valid = data.code === 0 && data.data?.isLogin === true
      message = data.message || data.msg || null
      if (data.code === 0 && data.data?.isLogin === false) {
        valid = false
        message = '登录态无效'
      }
    } catch (e) {
      message = (e as Error).message || '网络错误'
      code = null
      valid = false
    }

    memory = {
      valid,
      code,
      message,
      lastCheckedAt: now,
      // lastValidAt 仅表示「最近一次校验通过」，不等于用户更新 Cookie
      lastValidAt: valid ? now : memory.lastValidAt,
      lastSavedAt: memory.lastSavedAt,
      cookieHash,
    }
    persistHealth(memory)
    if (!valid) {
      logger.warn(`[Cookie] 健康检查失败 code=${code} msg=${message || '未知'}`)
    } else {
      logger.info(
        `[Cookie] 健康检查通过（isLogin=true）上次更新=${memory.lastSavedAt ? new Date(memory.lastSavedAt).toISOString() : '—'}`,
      )
    }
    return getCachedCookieHealth()
  } finally {
    checking = false
  }
}

export function startCookieHealthMonitor(): void {
  if (timer) return
  memory = loadPersisted()
  logger.info(
    `[Cookie] 已加载持久化时间戳 lastSavedAt=${memory.lastSavedAt ? new Date(memory.lastSavedAt).toISOString() : 'null'}`,
  )
  void checkCookieHealth(true)
  timer = setInterval(() => {
    void checkCookieHealth(false)
  }, COOKIE_CHECK_INTERVAL_MS)
  logger.info('[Cookie] 健康检查已启动：每 15 分钟校验登录态，距上次更新超 72h 告警')
}

export function stopCookieHealthMonitor(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
