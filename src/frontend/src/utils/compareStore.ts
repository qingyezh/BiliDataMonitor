// 对比集：sessionStorage 持久化，列表/详情/对比页共享
import type { CompareTarget, HistoryKind } from '../api/monitor'

const KEY = 'bili_compare_targets'
const ALIAS_KEY = 'bili_compare_alias_v1'
const UI_KEY = 'bili_compare_ui_v1'
export const COMPARE_MAX = 6

export interface CompareUiSettings {
  metricKey?: string
  histMode?: 'raw' | 'delta'
  scaleMode?: 'abs' | 'growth' | 'index'
  timeAxis?: 'calendar' | 'relative'
  chartGapMinutes?: number
  logMode?: boolean
  showAvgLine?: boolean
  showTrend?: boolean
  overlayPage?: boolean
  showAll?: boolean
  dateRange?: [string, string] | null
  t0Start?: number
  t0End?: number
  t0Unit?: 'hour' | 'day'
  t0ShowAll?: boolean
}

export function loadCompareTargets(): CompareTarget[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((x: CompareTarget) => x && x.type && x.target)
  } catch {
    return []
  }
}

export function saveCompareTargets(list: CompareTarget[]): void {
  sessionStorage.setItem(KEY, JSON.stringify(list.slice(0, COMPARE_MAX)))
}

export function hasCompareTarget(type: HistoryKind, target: string): boolean {
  return loadCompareTargets().some(t => t.type === type && t.target === target)
}

export function toggleCompareTarget(item: CompareTarget): { ok: boolean; added: boolean; list: CompareTarget[] } {
  const list = loadCompareTargets()
  const idx = list.findIndex(t => t.type === item.type && t.target === item.target)
  if (idx >= 0) {
    list.splice(idx, 1)
    saveCompareTargets(list)
    return { ok: true, added: false, list }
  }
  if (list.length >= COMPARE_MAX) {
    return { ok: false, added: false, list }
  }
  list.push(item)
  saveCompareTargets(list)
  return { ok: true, added: true, list }
}

export function removeCompareTarget(type: HistoryKind, target: string): CompareTarget[] {
  const list = loadCompareTargets().filter(t => !(t.type === type && t.target === target))
  saveCompareTargets(list)
  return list
}

export function clearCompareTargets(): void {
  sessionStorage.removeItem(KEY)
}

/** URL ↔ 对比集 */
export function encodeCompareQuery(list: CompareTarget[], extra: Record<string, string> = {}): string {
  const ids = list.map(t => `${t.type}:${t.target}`).join(',')
  const q = new URLSearchParams({ ...extra })
  if (ids) q.set('ids', ids)
  return q.toString()
}

export function parseCompareQuery(ids: string | undefined | null): CompareTarget[] {
  if (!ids) return []
  return ids
    .split(',')
    .map(part => {
      const i = part.indexOf(':')
      if (i <= 0) return null
      const type = part.slice(0, i) as HistoryKind
      const target = part.slice(i + 1)
      if (!['up', 'video', 'dynamic', 'column'].includes(type) || !target) return null
      return { type, target, name: target }
    })
    .filter(Boolean) as CompareTarget[]
}

// ── 对比条目别名：localStorage，按登录账号分桶 ──

export const ALIAS_MAX_LEN = 20
const ANON_USER = '__anon__'

function aliasKey(type: HistoryKind | string, target: string): string {
  return `${type}:${target}`
}

function loadAliasRoot(): Record<string, Record<string, string>> {
  try {
    const raw = localStorage.getItem(ALIAS_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw)
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function saveAliasRoot(data: Record<string, Record<string, string>>): void {
  localStorage.setItem(ALIAS_KEY, JSON.stringify(data))
}

/** 读取当前账号下的别名表 */
export function loadAliasMap(username: string | null | undefined): Record<string, string> {
  const u = username || ANON_USER
  const map = loadAliasRoot()[u]
  return map && typeof map === 'object' ? { ...map } : {}
}

/** 设置别名；alias 空白/空串 = 清除 */
export function setCompareAlias(
  username: string | null | undefined,
  type: HistoryKind | string,
  target: string,
  alias: string | null | undefined
): Record<string, string> {
  const u = username || ANON_USER
  const data = loadAliasRoot()
  if (!data[u] || typeof data[u] !== 'object') data[u] = {}
  const key = aliasKey(type, target)
  const trimmed = (alias ?? '').trim().slice(0, ALIAS_MAX_LEN)
  if (!trimmed) {
    delete data[u][key]
  } else {
    data[u][key] = trimmed
  }
  saveAliasRoot(data)
  return { ...data[u] }
}

export function clearCompareAlias(
  username: string | null | undefined,
  type: HistoryKind | string,
  target: string
): Record<string, string> {
  return setCompareAlias(username, type, target, '')
}

export function getCompareAlias(
  username: string | null | undefined,
  type: HistoryKind | string,
  target: string
): string {
  return loadAliasMap(username)[aliasKey(type, target)] || ''
}

export function compareAliasId(type: HistoryKind | string, target: string): string {
  return aliasKey(type, target)
}

// ── 对比页工具栏设置：localStorage，按账号分桶，刷新不丢 ──

function uiUserKey(username: string | null | undefined): string {
  return username || '__anon__'
}

export function loadCompareUiSettings(username: string | null | undefined): CompareUiSettings | null {
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (!raw) return null
    const root = JSON.parse(raw)
    const data = root?.[uiUserKey(username)]
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

export function saveCompareUiSettings(username: string | null | undefined, settings: CompareUiSettings): void {
  try {
    const raw = localStorage.getItem(UI_KEY)
    const root = raw ? JSON.parse(raw) : {}
    const u = uiUserKey(username)
    root[u] = { ...(root[u] || {}), ...settings }
    localStorage.setItem(UI_KEY, JSON.stringify(root))
  } catch {
    /* 忽略配额/隐私模式错误 */
  }
}
