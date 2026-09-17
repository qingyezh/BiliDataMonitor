// 对比集：sessionStorage 持久化，列表/详情/对比页共享
import type { CompareTarget, HistoryKind } from '../api/monitor'

const KEY = 'bili_compare_targets'
export const COMPARE_MAX = 6

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
