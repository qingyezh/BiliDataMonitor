// B站 Cookie 健康检查（nav isLogin）
import { getCookie } from './config.js'
import { logger } from './logger.js'

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
  /** true = 已配置且有效，但距 lastValidAt/lastSavedAt 超过 72h，建议刷新 */
  stale: boolean
  reason: 'ok' | 'empty' | 'invalid' | 'stale' | 'unchecked'
}

type PersistedHealth = Omit<CookieHealth, 'configured' | 'stale' | 'reason'>

const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

let memory: PersistedHealth = {
  valid: false,
  code: null,
  message: null,
  lastCheckedAt: null,
  lastValidAt: null,
  lastSavedAt: null,
}

let checking = false
let timer: ReturnType<typeof setInterval> | null = null

export function getCachedCookieHealth(): CookieHealth {
  return decorate(memory)
}

function decorate(h: PersistedHealth): CookieHealth {
  const configured = Boolean(getCookie())
  if (!configured) {
    return { ...h, configured: false, valid: false, stale: false, reason: 'empty' }
  }
  if (h.lastCheckedAt === null) {
    return { ...h, configured: true, valid: false, stale: false, reason: 'unchecked' }
  }
  const anchor = Math.max(h.lastValidAt || 0, h.lastSavedAt || 0)
  const stale =
    !h.valid ||
    (anchor > 0 && Date.now() - anchor > COOKIE_STALE_HOURS * 3600 * 1000)
  let reason: CookieHealth['reason'] = 'ok'
  if (!h.valid) reason = 'invalid'
  else if (stale) reason = 'stale'
  return { ...h, configured: true, valid: h.valid, stale, reason }
}

/** 写入 cookie 后标记新保存时间，并立即检查一次 */
export async function onCookieSaved(): Promise<CookieHealth> {
  memory = { ...memory, lastSavedAt: Date.now() }
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
        valid: false,
        code: null,
        message: '未配置 Cookie',
        lastCheckedAt: now,
        lastValidAt: memory.lastValidAt,
        lastSavedAt: memory.lastSavedAt,
      }
      return getCachedCookieHealth()
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
      lastValidAt: valid ? now : memory.lastValidAt,
      lastSavedAt: memory.lastSavedAt,
    }
    if (!valid) {
      logger.warn(`[Cookie] 健康检查失败 code=${code} msg=${message || '未知'}`)
    } else {
      logger.info('[Cookie] 健康检查通过（isLogin=true）')
    }
    return getCachedCookieHealth()
  } finally {
    checking = false
  }
}

export function startCookieHealthMonitor(): void {
  if (timer) return
  void checkCookieHealth(true)
  timer = setInterval(() => {
    void checkCookieHealth(false)
  }, COOKIE_CHECK_INTERVAL_MS)
  logger.info('[Cookie] 健康检查已启动：每 15 分钟校验登录态，过期或 72h 未刷新告警')
}

export function stopCookieHealthMonitor(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
