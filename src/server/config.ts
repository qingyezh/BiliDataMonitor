// 全局设置读写（app/config/settings.json）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppSettings } from './types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const APP_DIR = path.resolve(__dirname, '../../../app')
export const CONFIG_DIR = path.join(APP_DIR, 'config')
export const DATA_DIR = path.join(APP_DIR, 'data')
export const LOGS_DIR = path.join(APP_DIR, 'logs')
export const WEB_DIR = path.join(APP_DIR, 'web')
export const DB_PATH = path.join(DATA_DIR, 'monitor.db')
export const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.json')
export const COOKIE_PATH = path.join(CONFIG_DIR, 'cookie_config.json')
export const ROOT_DIR = path.resolve(__dirname, '../../..')

export const DEFAULT_SETTINGS: AppSettings = {
  port: 8123,
  interval_minutes: 30,
  default_max_videos: 10,
  cookie_mask: '',
  open_browser: true,
}

let cached: AppSettings | null = null

export function ensureAppDirs(): void {
  for (const d of [APP_DIR, CONFIG_DIR, DATA_DIR, LOGS_DIR, WEB_DIR]) {
    fs.mkdirSync(d, { recursive: true })
  }
}

export function loadSettings(): AppSettings {
  if (cached) return cached
  let loaded: AppSettings = { ...DEFAULT_SETTINGS }
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
      loaded = { ...DEFAULT_SETTINGS, ...raw }
    }
  } catch (e) {
    console.error('读取设置失败，使用默认值:', e)
  }
  cached = loaded
  return cached
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  // 过滤 undefined 字段，避免覆盖默认值（如 port）
  const merged: Partial<AppSettings> = {}
  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v
  }
  const next: AppSettings = { ...current, ...merged }
  // 校验范围
  next.interval_minutes = Math.min(1440, Math.max(5, next.interval_minutes))
  next.port = Math.min(65535, Math.max(1024, next.port))
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf-8')
  cached = next
  return next
}

export function getCookie(): string {
  try {
    if (fs.existsSync(COOKIE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf-8'))
      return (raw.bilibili || '').trim()
    }
  } catch (e) {
    console.error('读取 cookie 失败:', e)
  }
  return ''
}

/** Cookie 掩码：前4位 + *** + 后4位（与 CrawlerAnalysis 一致） */
export function maskCookie(cookie: string): string {
  if (!cookie) return ''
  if (cookie.length <= 8) return '***'
  return `${cookie.slice(0, 4)}***${cookie.slice(-4)}`
}

export function saveCookie(cookie: string): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  const existing = fs.existsSync(COOKIE_PATH)
    ? JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf-8'))
    : {}
  existing.bilibili = (cookie || '').trim()
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(existing, null, 2), 'utf-8')
  refreshCookieMask()
}

export function refreshCookieMask(): void {
  const cookie = getCookie()
  const s = loadSettings()
  s.cookie_mask = maskCookie(cookie)
  cached = s
}
