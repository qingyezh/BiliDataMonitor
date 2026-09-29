// 对比集：sessionStorage 持久化，列表/详情/对比页共享
import type { CompareTarget, HistoryKind } from '../api/monitor'

const KEY = 'bili_compare_targets'
const ALIAS_KEY = 'bili_compare_alias_v1'
const UI_KEY = 'bili_compare_ui_v1'
const GROUP_KEY = 'bili_compare_groups'
const GROUP_ALIAS_KEY = 'bili_compare_group_alias_v1'
export const COMPARE_MAX = 6
export type MergeMode = 'sum' | 'avg' | 'max' | 'min'

function targetKey(type: HistoryKind | string, target: string): string {
  return `${type}:${target}`
}

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
  const key = targetKey(type, target)
  const list = loadCompareTargets().filter(t => !(t.type === type && t.target === target))
  saveCompareTargets(list)
  // 同步组：移出所在组；剩 <2 则解散该组
  const groups: CompareGroupDef[] = []
  for (const g of loadGroupsRoot()) {
    if (!g.members.includes(key)) {
      groups.push(g)
      continue
    }
    const rest = g.members.filter(m => m !== key)
    if (rest.length >= 2) groups.push({ id: groupIdOf(rest), members: rest, mergeMode: g.mergeMode })
  }
  saveGroupsRoot(groups)
  return list
}

export function clearCompareTargets(): void {
  sessionStorage.removeItem(KEY)
  sessionStorage.removeItem(GROUP_KEY)
}

/** URL ↔ 对比集；同组成员用 `~` 连接 */
export function encodeCompareQuery(list: CompareTarget[], extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ ...extra })
  if (list.length) {
    // 按展示项编码：未传 groups 时退化为单条列表
    const groups = loadGroupsRoot()
    const groupOf = new Map<string, CompareGroupDef>()
    for (const g of groups) for (const m of g.members) groupOf.set(m, g)
    const emitted = new Set<string>()
    const parts: string[] = []
    for (const t of list) {
      const key = targetKey(t.type, t.target)
      const g = groupOf.get(key)
      if (g) {
        if (emitted.has(g.id)) continue
        emitted.add(g.id)
        const members = list
          .map(x => targetKey(x.type, x.target))
          .filter(k => g.members.includes(k))
        parts.push((members.length >= 2 ? members : [key]).join('~'))
      } else {
        parts.push(key)
      }
    }
    q.set('ids', parts.join(','))
  }
  return q.toString()
}

export function parseCompareQuery(ids: string | undefined | null): {
  targets: CompareTarget[]
  groups: CompareGroupDef[]
} {
  if (!ids) return { targets: [], groups: [] }
  const targets: CompareTarget[] = []
  const groups: CompareGroupDef[] = []
  const seen = new Set<string>()
  ids
    .split(',')
    .forEach(part => {
      const memberKeys = part
        .split('~')
        .map(p => p.trim())
        .filter(Boolean)
      const parsed: CompareTarget[] = []
      for (const mk of memberKeys) {
        const i = mk.indexOf(':')
        if (i <= 0) continue
        const type = mk.slice(0, i) as HistoryKind
        const target = mk.slice(i + 1)
        if (!['up', 'video', 'dynamic', 'column'].includes(type) || !target) continue
        const key = targetKey(type, target)
        if (seen.has(key)) continue
        seen.add(key)
        const item = { type, target, name: target }
        parsed.push(item)
        targets.push(item)
      }
      if (parsed.length >= 2) {
        const members = parsed.map(p => targetKey(p.type, p.target))
        groups.push({ id: groupIdOf(members), members, mergeMode: 'sum' })
      }
    })
  return { targets, groups }
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

// ── 对比分组：sessionStorage 存组结构；组别名 localStorage 按账号分桶 ──

export interface CompareGroupDef {
  /** 成员签名 id（排序后成员 key 的 join），同成员集合稳定 */
  id: string
  members: string[]
  mergeMode: MergeMode
}

export function groupIdOf(members: string[]): string {
  return [...members].sort().join('|')
}

function loadGroupsRoot(): CompareGroupDef[] {
  try {
    const raw = sessionStorage.getItem(GROUP_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter((g: CompareGroupDef) => g && Array.isArray(g.members) && g.members.length >= 2)
      .map((g: CompareGroupDef) => ({
        id: groupIdOf(g.members),
        members: [...g.members],
        mergeMode: (['sum', 'avg', 'max', 'min'] as const).includes(g.mergeMode) ? g.mergeMode : 'sum',
      }))
  } catch {
    return []
  }
}

function saveGroupsRoot(groups: CompareGroupDef[]): void {
  if (!groups.length) {
    sessionStorage.removeItem(GROUP_KEY)
    return
  }
  sessionStorage.setItem(GROUP_KEY, JSON.stringify(groups))
}

export function loadCompareGroups(): CompareGroupDef[] {
  return loadGroupsRoot()
}

export function saveCompareGroups(groups: CompareGroupDef[]): void {
  saveGroupsRoot(groups.filter(g => g.members.length >= 2))
}

/** 合并所选成员为一组；返回新组列表。已在同组则原样返回。 */
export function mergeMembersToGroup(memberKeys: string[], mode: MergeMode = 'sum'): CompareGroupDef[] {
  const keys = [...new Set(memberKeys)].filter(Boolean)
  if (keys.length < 2) return loadGroupsRoot()
  const groups = loadGroupsRoot().filter(g => !g.members.some(m => keys.includes(m)))
  const def: CompareGroupDef = { id: groupIdOf(keys), members: keys, mergeMode: mode }
  groups.push(def)
  saveGroupsRoot(groups)
  return groups
}

/** 解散一组（或按成员键解散其所属组） */
export function ungroupByGroupId(id: string): CompareGroupDef[] {
  const groups = loadGroupsRoot().filter(g => g.id !== id)
  saveGroupsRoot(groups)
  return groups
}

export function ungroupByMember(memberKey: string): CompareGroupDef[] {
  const groups = loadGroupsRoot().filter(g => !g.members.includes(memberKey))
  saveGroupsRoot(groups)
  return groups
}

export function removeMemberFromGroup(memberKey: string): CompareGroupDef[] {
  const groups: CompareGroupDef[] = []
  for (const g of loadGroupsRoot()) {
    if (!g.members.includes(memberKey)) {
      groups.push(g)
      continue
    }
    const rest = g.members.filter(m => m !== memberKey)
    if (rest.length >= 2) {
      groups.push({ id: groupIdOf(rest), members: rest, mergeMode: g.mergeMode })
    }
  }
  saveGroupsRoot(groups)
  return groups
}

export function setGroupMergeMode(id: string, mode: MergeMode): CompareGroupDef[] {
  const groups = loadGroupsRoot().map(g => (g.id === id ? { ...g, mergeMode: mode } : g))
  saveGroupsRoot(groups)
  return groups
}

export function clearCompareGroups(): void {
  sessionStorage.removeItem(GROUP_KEY)
}

function loadGroupAliasRoot(): Record<string, Record<string, string>> {
  try {
    const raw = localStorage.getItem(GROUP_ALIAS_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw)
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function saveGroupAliasRoot(data: Record<string, Record<string, string>>): void {
  localStorage.setItem(GROUP_ALIAS_KEY, JSON.stringify(data))
}

export function loadGroupAliasMap(username: string | null | undefined): Record<string, string> {
  const u = username || ANON_USER
  const map = loadGroupAliasRoot()[u]
  return map && typeof map === 'object' ? { ...map } : {}
}

export function setCompareGroupAlias(
  username: string | null | undefined,
  groupId: string,
  alias: string | null | undefined
): Record<string, string> {
  const u = username || ANON_USER
  const data = loadGroupAliasRoot()
  if (!data[u] || typeof data[u] !== 'object') data[u] = {}
  const trimmed = (alias ?? '').trim().slice(0, ALIAS_MAX_LEN)
  if (!trimmed) delete data[u][groupId]
  else data[u][groupId] = trimmed
  saveGroupAliasRoot(data)
  return { ...data[u] }
}

export function clearCompareGroupAlias(
  username: string | null | undefined,
  groupId: string
): Record<string, string> {
  return setCompareGroupAlias(username, groupId, '')
}

/** 展示项：有序列表，每项成员 key；未入组的目标各成一项 */
export function buildDisplayItems(targets: CompareTarget[], groups: CompareGroupDef[]): string[][] {
  const groupOf = new Map<string, CompareGroupDef>()
  for (const g of groups) {
    for (const m of g.members) groupOf.set(m, g)
  }
  const emitted = new Set<string>()
  const items: string[][] = []
  for (const t of targets) {
    const key = targetKey(t.type, t.target)
    const g = groupOf.get(key)
    if (g) {
      if (emitted.has(g.id)) continue
      emitted.add(g.id)
      // 保持组内成员相对 targets 的出现顺序
      const ordered = targets
        .map(x => targetKey(x.type, x.target))
        .filter(k => g.members.includes(k))
      items.push(ordered.length >= 2 ? ordered : [key])
    } else {
      items.push([key])
    }
  }
  return items
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
