// 历史序列清洗与多序列时间对齐（双实例脏点 / 对比页）

export const DUPLICATE_MERGE_MS = 4000
export const ALIGN_TOLERANCE_MS = 20000

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
  gapMultiplier: number = RELATIVE_GAP_MULTIPLIER
): RelativeSeriesResult | null {
  if (!history.length) return null
  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000
  const t0 = history[0].created_at
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
