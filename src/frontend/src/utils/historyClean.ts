// 历史序列清洗与多序列时间对齐（双实例脏点 / 对比页）

export const DUPLICATE_MERGE_MS = 4000
export const ALIGN_TOLERANCE_MS = 20000
/** 组内成员合并：同一采集轮次的时间宽容度 */
export const MERGE_TOLERANCE_MS = 30000

export interface CleanPoint {
  id?: number
  created_at: number
  [metric: string]: number | string | undefined
}

/** 相邻点间隔 < maxGapMs 时合并：累计指标取 max，时间取较晚，id 保留 max 侧 */
export function dedupeNearDuplicates<T extends CleanPoint>(
  points: T[],
  maxGapMs: number = DUPLICATE_MERGE_MS,
  metricKeys: string[]
): T[] {
  if (points.length < 2) return points
  const sorted = [...points].sort((a, b) => a.created_at - b.created_at)
  const out: T[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1]
    const cur = sorted[i]
    const gap = cur.created_at - prev.created_at
    if (gap >= 0 && gap < maxGapMs) {
      let sumPrev = 0
      let sumCur = 0
      for (const k of metricKeys) {
        sumPrev += Number(prev[k] || 0)
        sumCur += Number(cur[k] || 0)
      }
      const keepCur = sumCur >= sumPrev
      const merged = { ...(keepCur ? cur : prev) } as T
      merged.created_at = Math.max(prev.created_at, cur.created_at)
      if (keepCur) merged.id = cur.id ?? prev.id
      else merged.id = prev.id ?? cur.id
      out[out.length - 1] = merged
    } else {
      out.push(cur)
    }
  }
  return out
}

export function resampleByInterval<T extends CleanPoint>(history: T[], intervalMinutes: number): T[] {
  if (!history.length) return history
  const bucketMs = Math.max(1, intervalMinutes) * 60 * 1000
  const buckets = new Map<number, T>()
  for (const h of history) {
    const key = Math.floor(h.created_at / bucketMs)
    const prev = buckets.get(key)
    if (!prev || h.created_at >= prev.created_at) buckets.set(key, h)
  }
  return [...buckets.values()].sort((a, b) => a.created_at - b.created_at)
}

export interface AlignedSlot {
  time: number
  /** seriesIndex -> value */
  values: (number | null)[]
}

/**
 * 多序列按时间槽对齐：|Δt| ≤ toleranceMs 归为同一槽。
 * 返回 slots（代表时间为槽内中位数）及各系列值。
 */
export function alignByTimeSlots(
  seriesTimes: number[][],
  seriesValues: number[][],
  toleranceMs: number = ALIGN_TOLERANCE_MS
): { slots: number[]; aligned: (number | null)[][] } {
  const all: { t: number; si: number; vi: number }[] = []
  seriesTimes.forEach((times, si) => {
    times.forEach((t, i) => {
      const v = seriesValues[si]?.[i]
      if (v === null || v === undefined || Number.isNaN(v)) return
      all.push({ t, si, vi: v })
    })
  })
  if (!all.length) return { slots: [], aligned: seriesTimes.map(() => []) }
  all.sort((a, b) => a.t - b.t)

  const clusters: { t: number; si: number; vi: number }[][] = []
  let cur: { t: number; si: number; vi: number }[] = [all[0]]
  for (let i = 1; i < all.length; i++) {
    if (all[i].t - cur[0].t <= toleranceMs) {
      cur.push(all[i])
    } else {
      clusters.push(cur)
      cur = [all[i]]
    }
  }
  clusters.push(cur)

  const slots = clusters.map(c => {
    const ts = c.map(x => x.t).sort((a, b) => a - b)
    return ts[Math.floor(ts.length / 2)]
  })
  const aligned: (number | null)[][] = seriesTimes.map(() => slots.map(() => null))
  clusters.forEach((c, slotIdx) => {
    // 同槽同系列取较大值（双实例/容差合并）
    const best = new Map<number, number>()
    for (const item of c) {
      const prev = best.get(item.si)
      if (prev === undefined || item.vi > prev) best.set(item.si, item.vi)
    }
    for (const [si, vi] of best) {
      if (aligned[si]) aligned[si][slotIdx] = vi
    }
  })
  return { slots, aligned }
}

/**
 * 起点对齐（T+0）：seriesTimes 应为相对时间（各序列自身首点 = 0）。
 * 按 bucketMs 分桶（而非 20s 容差），避免不同序列采样相位导致重合区大量 null。
 * 同桶同系列取最后一点；slots 为桶起点。
 */
export function alignByRelativeBuckets(
  seriesTimes: number[][],
  seriesValues: number[][],
  bucketMs: number
): { slots: number[]; aligned: (number | null)[][] } {
  const bucket = Math.max(1000, bucketMs)
  const keysSet = new Set<number>()
  const seriesMaps = seriesTimes.map((ts, si) => {
    const m = new Map<number, number>()
    ts.forEach((t, i) => {
      const v = seriesValues[si]?.[i]
      if (v === null || v === undefined || Number.isNaN(v)) return
      const key = Math.floor(Math.max(0, t) / bucket)
      m.set(key, v)
      keysSet.add(key)
    })
    return m
  })
  if (!keysSet.size) return { slots: [], aligned: seriesTimes.map(() => []) }
  const keys = [...keysSet].sort((a, b) => a - b)
  return {
    slots: keys.map(k => k * bucket),
    aligned: seriesMaps.map(m => keys.map(k => (m.has(k) ? m.get(k)! : null))),
  }
}

/** 真数据断档阈值：与上一有效点间隔超过 interval×倍数 时保留 null（不 LOCF） */
export const RELATIVE_GAP_MULTIPLIER = 3

export interface RelativeSeriesResult {
  /** 桶起点相对时间 ms（与 values 对齐） */
  times: number[]
  /** 稠密化后的值；真断档处为 null */
  values: (number | null)[]
  /** 各序列自身 T0（绝对时间 ms） */
  t0: number
}

/**
 * T+0 单网格重采样：以序列首点为 T0，在相对时间上分桶 + LOCF 稠密化。
 * 避免「绝对墙钟重采样 → 相对分桶」双网格错位导致的碎点/断线。
 * gapMultiplier：相邻有效点跨度 > interval×gapMultiplier 时该段保留 null。
 */
export function resampleRelativeSeries(
  history: CleanPoint[],
  field: string,
  intervalMinutes: number,
  gapMultiplier: number = RELATIVE_GAP_MULTIPLIER,
  baseT0?: number
): RelativeSeriesResult | null {
  if (!history.length) return null
  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000
  const t0 = baseT0 ?? history[0].created_at
  const buckets = new Map<number, number>()
  const lastTsByKey = new Map<number, number>()
  for (const h of history) {
    const key = Math.floor(Math.max(0, h.created_at - t0) / intervalMs)
    const v = Number(h[field] ?? 0)
    const prevTs = lastTsByKey.get(key)
    if (prevTs === undefined || h.created_at >= prevTs) {
      buckets.set(key, Number.isNaN(v) ? 0 : v)
      lastTsByKey.set(key, h.created_at)
    }
  }
  if (!buckets.size) return null
  const maxKey = Math.max(...buckets.keys())
  const gapLimitKeys = gapMultiplier
  const times: number[] = []
  const values: (number | null)[] = []
  let lastFilledKey = -1
  let lastValue: number | null = null
  for (let key = 0; key <= maxKey; key++) {
    times.push(key * intervalMs)
    if (buckets.has(key)) {
      lastValue = buckets.get(key)!
      lastFilledKey = key
      values.push(lastValue)
      continue
    }
    // 空桶：与上一有效点跨度（按 key）超过阈值 → 断档 null，否则 LOCF
    if (lastFilledKey < 0) {
      values.push(null)
      continue
    }
    const keyGap = key - lastFilledKey
    if (keyGap > gapLimitKeys) {
      values.push(null)
    } else {
      values.push(lastValue)
    }
  }
  return { times, values, t0 }
}

/** 稠密相对序列上算增量；首点或前值为 null / 真断档处为 null */
export function buildDeltaOnRelative(
  values: (number | null)[]
): (number | null)[] {
  if (values.length < 2) return []
  const out: (number | null)[] = [null]
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1]
    const b = values[i]
    if (a === null || b === null) {
      out.push(null)
      continue
    }
    out.push(b - a)
  }
  return out
}

/**
 * 成员增量：首采样点只作基线，不产生「0→第一次爬取」增量。
 * 返回与 times[1..] 对齐的增量序列；跨度过大处为 null。
 */
export function buildDeltaExcludeFirst(
  times: number[],
  values: (number | null)[],
  gapLimitMs?: number
): { times: number[]; values: (number | null)[] } {
  if (times.length < 2) return { times: [], values: [] }
  const outT: number[] = []
  const outV: (number | null)[] = []
  for (let i = 1; i < times.length; i++) {
    const a = values[i - 1]
    const b = values[i]
    outT.push(times[i])
    if (a === null || b === null) {
      outV.push(null)
      continue
    }
    if (gapLimitMs !== undefined && times[i] - times[i - 1] > gapLimitMs) {
      outV.push(null)
      continue
    }
    outV.push(b - a)
  }
  return { times: outT, values: outV }
}

export type MergeMode = 'sum' | 'avg' | 'max' | 'min'

/**
 * 多成员按时间槽对齐：|t - 簇锚点| ≤ toleranceMs 归入同一槽。
 * 同槽同成员：累计指标取 max，增量取 sum。
 */
export function alignMembersToSlots(
  seriesTimes: number[][],
  seriesValues: (number | null)[][],
  toleranceMs: number = MERGE_TOLERANCE_MS,
  sameMemberPolicy: 'max' | 'sum' = 'max'
): { slots: number[]; aligned: (number | null)[][] } {
  const all: { t: number; si: number; vi: number }[] = []
  seriesTimes.forEach((times, si) => {
    times.forEach((t, i) => {
      const v = seriesValues[si]?.[i]
      if (v === null || v === undefined || Number.isNaN(v)) return
      all.push({ t, si, vi: v })
    })
  })
  if (!all.length) return { slots: [], aligned: seriesTimes.map(() => []) }
  all.sort((a, b) => a.t - b.t)

  const clusters: { t: number; si: number; vi: number }[][] = []
  let cur: { t: number; si: number; vi: number }[] = [all[0]]
  let anchor = all[0].t
  for (let i = 1; i < all.length; i++) {
    if (all[i].t - anchor <= toleranceMs) {
      cur.push(all[i])
    } else {
      clusters.push(cur)
      cur = [all[i]]
      anchor = all[i].t
    }
  }
  clusters.push(cur)

  const slots = clusters.map(c => {
    const ts = c.map(x => x.t).sort((a, b) => a - b)
    return ts[Math.floor(ts.length / 2)]
  })
  const aligned: (number | null)[][] = seriesTimes.map(() => slots.map(() => null))
  clusters.forEach((c, slotIdx) => {
    const best = new Map<number, number>()
    for (const item of c) {
      const prev = best.get(item.si)
      if (prev === undefined) best.set(item.si, item.vi)
      else if (sameMemberPolicy === 'sum') best.set(item.si, prev + item.vi)
      else if (item.vi > prev) best.set(item.si, item.vi)
    }
    for (const [si, vi] of best) {
      if (aligned[si]) aligned[si][slotIdx] = vi
    }
  })
  return { slots, aligned }
}

/**
 * 将对齐后的成员矩阵合并为单序列。
 * - raw：缺员 LOCF（仅对已有基线的成员），再按 mode 聚合
 * - delta：缺员/首点贡献 0；所有活跃成员均为 null 时合并点为 null
 */
export function mergeMemberSlots(
  aligned: (number | null)[][],
  mode: MergeMode,
  histMode: 'raw' | 'delta'
): (number | null)[] {
  const memberCount = aligned.length
  if (!memberCount) return []
  const slotCount = aligned[0]?.length || 0
  const out: (number | null)[] = []
  const last: (number | null)[] = Array.from({ length: memberCount }, () => null)
  const started: boolean[] = Array.from({ length: memberCount }, () => false)

  for (let s = 0; s < slotCount; s++) {
    const vals: number[] = []
    let anyValue = false
    let anyActive = false

    for (let m = 0; m < memberCount; m++) {
      const v = aligned[m]?.[s]
      const has = v !== null && v !== undefined && !Number.isNaN(v)
      if (has) {
        started[m] = true
        anyValue = true
        anyActive = true
        if (histMode === 'raw') {
          last[m] = v
          vals.push(v)
        } else {
          vals.push(v)
        }
      } else if (started[m]) {
        anyActive = true
        if (histMode === 'raw') {
          const lv = last[m]
          if (lv !== null && lv !== undefined) vals.push(lv)
        }
        // delta：缺员贡献 0（不 push）
      }
    }

    if (!anyActive) {
      out.push(null)
      continue
    }
    if (!anyValue) {
      // 活跃成员该槽均无有效值（真断档/全缺样）→ 断线
      out.push(null)
      continue
    }
    if (!vals.length) {
      out.push(null)
      continue
    }
    if (mode === 'sum') out.push(vals.reduce((a, b) => a + b, 0))
    else if (mode === 'avg') out.push(vals.reduce((a, b) => a + b, 0) / vals.length)
    else if (mode === 'max') out.push(Math.max(...vals))
    else out.push(Math.min(...vals))
  }
  return out
}

/**
 * 合并后序列再按时间桶重采样。
 * raw：每桶末次值；delta：桶内增量求和（全 null 则 null）。
 */
export function resampleMergedSeries(
  times: number[],
  values: (number | null)[],
  intervalMinutes: number,
  histMode: 'raw' | 'delta'
): { times: number[]; values: (number | null)[] } {
  if (!times.length) return { times: [], values: [] }
  const bucketMs = Math.max(1, intervalMinutes) * 60 * 1000
  const order = times.map((_, i) => i).sort((a, b) => times[a] - times[b])
  const bucketLast = new Map<number, { t: number; v: number | null }>()
  const bucketSum = new Map<number, { t: number; sum: number; has: boolean }>()

  for (const i of order) {
    const t = times[i]
    const v = values[i]
    const key = Math.floor(t / bucketMs)
    if (histMode === 'raw') {
      const prev = bucketLast.get(key)
      if (!prev || t >= prev.t) bucketLast.set(key, { t, v: v ?? null })
    } else {
      const prev = bucketSum.get(key)
      const has = v !== null && v !== undefined && !Number.isNaN(v)
      const sum = (prev?.sum || 0) + (has ? v : 0)
      const tMax = prev && prev.t >= t ? prev.t : t
      bucketSum.set(key, { t: tMax, sum, has: (prev?.has || false) || has })
    }
  }

  const keys = [...(histMode === 'raw' ? bucketLast.keys() : bucketSum.keys())].sort((a, b) => a - b)
  const outT: number[] = []
  const outV: (number | null)[] = []
  for (const k of keys) {
    if (histMode === 'raw') {
      const cell = bucketLast.get(k)!
      outT.push(cell.t)
      outV.push(cell.v)
    } else {
      const cell = bucketSum.get(k)!
      outT.push(cell.t)
      outV.push(cell.has ? cell.sum : null)
    }
  }
  return { times: outT, values: outV }
}
