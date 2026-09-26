// 非自然流量指数：基于视频前 48h 播放/弹幕/评论增量形态
// 输出 0-100，越大表示人工强推/买量可能性越高

export interface BoostIndexInputPoint {
  play: number
  video_review: number
  comment: number
  created_at: number
}

export interface BoostIndexEvidence {
  key: string
  label: string
  detail: string
}

export interface BoostIndexResult {
  /** 0-100 非自然流量指数 */
  score: number
  /** 等级文案 */
  level: 'low' | 'medium' | 'high'
  levelText: string
  /** 使用的窗口：前48h；样本点数 */
  sampleCount: number
  windowHours: number
  /** 子分 0-100 */
  parts: {
    shape: number
    excess: number
    aux: number
    co: number
    rhythmPenalty: number
  }
  evidence: BoostIndexEvidence[]
  /** 数据不足时的说明 */
  insufficient?: string
  /** 原始特征（便于入库与调参） */
  features?: {
    jumpR: number
    cliffR: number
    riseWidth: number
    plateauScore: number
    plateauLen: number
    excessRatio: number
    diurnalScore: number
    residJumpR: number
  }
}

const WINDOW_MS = 48 * 3600 * 1000
const NOMINAL_DT_S = 300
const MIN_POINTS = 24

/** 算法版本：公式/阈值变更时 +1，缓存行将触发重算
 *  v2: 冷启动截断 + 绝对量门槛
 *  v3: 高位平台定义 + 阶跃/长台/断崖组合加分
 *  v4: 剔负点 + 3 点中值 + 节律可解释度
 *  v5.1 (6): 形态窗 46h 尾部保护带 + 残差闸门（不替代 v4 主检测）
 */
export const BOOST_ALGO_VERSION = 6

/** 形态检测窗口（小时）：48h 内留 2h 保护带 */
const SHAPE_WINDOW_H = 46

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function clip01(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v))
}

function toLocalHour(ms: number): number {
  return new Date(ms).getHours()
}

function winMean(xs: number[], i: number, k: number, before: boolean): number {
  const a = before ? Math.max(0, i - k) : i
  const b = before ? Math.max(1, i) : Math.min(xs.length, i + k)
  if (b <= a) return 0
  let s = 0
  for (let j = a; j < b; j++) s += xs[j]
  return s / (b - a)
}

/**
 * 冷启动结束后下标：发布脉冲峰值后显著回落。
 * v5 收紧：回落阈值更高，且至少跳过约 1h，避免过早进入日周期大起大落段。
 */
function coldStartEnd(x: number[], tMs: number[]): number {
  const n = x.length
  if (n < 12) return 0
  const earlyN = Math.min(n, 72)
  let peakIdx = 0
  for (let i = 1; i < earlyN; i++) if (x[i] > x[peakIdx]) peakIdx = i
  const earlyMax = x[peakIdx] || 1
  const med = median(x) || 1
  const dropTo = Math.max(0.25 * earlyMax, 1.2 * med)
  for (let i = peakIdx + 12; i < n; i++) {
    if (x[i] < dropTo) return i
  }
  return Math.min(n, Math.max(24, Math.floor(n * 0.3)))
}

/**
 * 小时效应 s_h：用分时 **30% 分位** 而非中位，避免被事件自身/投放段抬高基线。
 * 仅用 searchStart 之前样本；不足 6 个小时桶时用全序列 P30（仍抗尖峰）。
 */
function hourScaleMap(x: number[], tMs: number[], searchStart: number): Map<number, number> {
  const byHour = new Map<number, number[]>()
  const limit = Math.max(12, Math.min(searchStart, x.length))
  for (let i = 0; i < limit; i++) {
    const h = toLocalHour(tMs[i])
    const arr = byHour.get(h) || []
    arr.push(x[i])
    byHour.set(h, arr)
  }
  if (byHour.size < 6) {
    for (let i = 0; i < x.length; i++) {
      const h = toLocalHour(tMs[i])
      const arr = byHour.get(h) || []
      arr.push(x[i])
      byHour.set(h, arr)
    }
  }
  const p30 = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.floor(s.length * 0.3)] || s[0] || 1
  }
  const scales = new Map<number, number>()
  const vals: number[] = []
  for (const [h, arr] of byHour) {
    const m = p30(arr) || 1
    scales.set(h, m)
    vals.push(m)
  }
  const gm = vals.length ? median(vals) : 1
  for (const [h, m] of scales) scales.set(h, Math.min(m / (gm || 1), 3))
  return scales
}

function residualSeries(x: number[], tMs: number[], searchStart: number): number[] {
  const sc = hourScaleMap(x, tMs, searchStart)
  return x.map((v, i) => {
    const s = sc.get(toLocalHour(tMs[i])) || 1
    return v / Math.max(s, 1e-6)
  })
}

function detectStep(
  x: number[],
  start: number,
  k: number,
  med: number
): {
  jumpR: number
  jumpI: number
  cliffR: number
  cliffI: number
} {
  // 分母下限：低基数上的小波动不得放大成数十倍「跃升」
  const denomFloor = Math.max(1, 0.08 * med)
  // 绝对量门槛：跃升/断崖两侧至少一侧要达到中位数量级
  const absGate = Math.max(2 * med, 1)
  let jumpR = 0
  let jumpI = -1
  let cliffR = 0
  let cliffI = -1
  for (let i = Math.max(k, start); i < x.length - k; i++) {
    const before = winMean(x, i, k, true)
    const after = winMean(x, i, k, false)
    const jr = after / Math.max(before, denomFloor)
    const cr = before / Math.max(after, denomFloor)
    // 跃升：抬升后达到显著量级
    if (after >= absGate && jr > jumpR) {
      jumpR = jr
      jumpI = i
    }
    // 断崖：从显著高位跌落
    if (before >= absGate && cr > cliffR) {
      cliffR = cr
      cliffI = i
    }
  }
  return { jumpR, jumpI, cliffR, cliffI }
}

/**
 * 长高段（持续供给）：冷启动后连续高水位，覆盖「缓升/中跃升 + 长维持」无断崖形态。
 */
function sustainedHighScore(x: number[], start: number, end: number): {
  score: number
  len: number
  height: number
} {
  const n = x.length
  if (n < 24) return { score: 0, len: 0, height: 0 }
  const from = Math.max(0, Math.min(start, n - 1))
  const to = Math.max(from + 6, Math.min(end, n))
  const med = median(x) || 1
  let localMax = 0
  for (let t = from; t < to; t++) localMax = Math.max(localMax, x[t])
  const floor = Math.max(1.5 * med, 0.4 * localMax, 1)
  let bestLen = 0
  let bestSum = 0
  let i = from
  while (i < to) {
    if (x[i] < floor) {
      i++
      continue
    }
    let j = i
    let sum = 0
    let gap = 0
    while (j < to && gap <= 2) {
      if (x[j] >= floor) {
        sum += x[j]
        gap = 0
      } else {
        gap++
      }
      j++
    }
    const len = j - i
    if (len > bestLen) {
      bestLen = len
      bestSum = sum
    }
    i = j + 1
  }
  if (bestLen < 30) return { score: 0, len: bestLen, height: 0 }
  const mean = bestSum / Math.max(bestLen, 1)
  const vsMed = mean / med
  // 必须明显高于全局中位（自然衰减尾/弱波不算长高段）
  if (vsMed < 2.2) return { score: 0, len: bestLen, height: vsMed }
  const durS = clip01(bestLen / 72)
  const hS = clip01((mean / floor - 1) / 1.0)
  const score = clip01(0.55 * durS + 0.45 * hS) * clip01((vsMed - 2.0) / 2.5)
  return { score, len: bestLen, height: vsMed }
}

function plateauScore(x: number[], start: number, minLen = 6): {
  score: number
  len: number
  decay: number
} {
  const n = x.length
  if (start < 0 || n < minLen * 2) return { score: 0, len: 0, decay: 0 }
  const med = median(x) || 1
  // 高位门槛：用冷启动后的中位（避免冷启动尖峰抬高门槛）且不低于局部峰值 15%
  let localPeak = 0
  const from = Math.max(0, start)
  for (let t = from; t < n; t++) localPeak = Math.max(localPeak, x[t])
  const medPost = median(x.slice(from)) || med
  const highGate = Math.max(0.9 * medPost, 0.15 * localPeak, 1)
  let best = 0
  let bestLen = 0
  let bestDecay = 0
  let i = Math.max(0, start)
  while (i + minLen <= n) {
    let j = i + minLen
    while (j < n) {
      const half = Math.max(1, (j - i) >> 1)
      let sl = 0
      for (let t = i; t < i + half; t++) sl += x[t]
      let sr = 0
      for (let t = i + half; t < j; t++) sr += x[t]
      const muL = sl / half
      const muR = sr / Math.max(1, j - i - half)
      if (muL >= highGate && muR / muL >= 0.55) j++
      else break
    }
    const length = j - i
    if (length >= minLen) {
      const half = Math.max(1, length >> 1)
      let sl = 0
      for (let t = i; t < i + half; t++) sl += x[t]
      let sr = 0
      for (let t = i + half; t < j; t++) sr += x[t]
      const muL = sl / half
      const muR = sr / Math.max(1, j - i - half)
      const decay = muR / Math.max(muL, 1e-6)
      if (decay >= 0.55 && muL >= highGate) {
        // 强度：相对中位的高度 × 时长占比（高而长的台更像持续供给）
        const strength = (muL / med) * (length / n)
        if (strength > best) {
          best = strength
          bestLen = length
          bestDecay = decay
        }
      }
    }
    i += Math.max(1, length >> 1)
  }
  return { score: best, len: bestLen, decay: bestDecay }
}

function excessRatio(x: number[], tMs: number[]): number {
  const n = x.length
  if (n < 12) return 0
  const w = 7
  const expected: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w)
    const b = Math.min(n, i + w + 1)
    const seg = x.slice(a, b).sort((p, q) => p - q)
    expected[i] = seg[Math.floor(seg.length * 0.2)]
  }
  const buckets = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const h = toLocalHour(tMs[i])
    const arr = buckets.get(h) || []
    arr.push(x[i] / Math.max(expected[i], 1e-6))
    buckets.set(h, arr)
  }
  const hourScale = new Map<number, number>()
  for (const [h, arr] of buckets) hourScale.set(h, median(arr))
  const scales = [...hourScale.values()]
  const gm = scales.length ? median(scales) : 1
  let sumEx = 0
  let sumAll = 0
  for (let i = 0; i < n; i++) {
    const sc = (hourScale.get(toLocalHour(tMs[i])) || 1) / (gm || 1)
    const exp = expected[i] * sc
    sumAll += x[i]
    sumEx += Math.max(x[i] - exp, 0)
  }
  return sumAll > 0 ? sumEx / sumAll : 0
}

function accelSpike(x: number[]): number {
  if (x.length < 5) return 0
  const d2: number[] = []
  for (let i = 1; i < x.length - 1; i++) d2.push(x[i + 1] - 2 * x[i] + x[i - 1])
  const med = median(d2)
  const mad = median(d2.map((v) => Math.abs(v - med))) || 1
  let mx = 0
  for (const v of d2) mx = Math.max(mx, Math.abs(v - med))
  return mx / (1.4826 * mad + 1e-6)
}

function corrSeries(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 12) return 0
  const z = (xs: number[]) => {
    const mu = xs.reduce((s, v) => s + v, 0) / xs.length
    const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mu) ** 2, 0) / xs.length) || 1
    return xs.map((v) => (v - mu) / sd)
  }
  const za = z(a.slice(0, n))
  const zb = z(b.slice(0, n))
  const win = 9
  const step = 3
  let sum = 0
  let cnt = 0
  for (let i = 0; i + win <= n; i += step) {
    const xa = za.slice(i, i + win)
    const xb = zb.slice(i, i + win)
    const mx = xa.reduce((s, v) => s + v, 0) / win
    const my = xb.reduce((s, v) => s + v, 0) / win
    let num = 0
    let da = 0
    let db = 0
    for (let j = 0; j < win; j++) {
      const dx = xa[j] - mx
      const dy = xb[j] - my
      num += dx * dy
      da += dx * dx
      db += dy * dy
    }
    if (da > 1e-9 && db > 1e-9) {
      sum += num / Math.sqrt(da * db)
      cnt++
    }
  }
  return cnt ? sum / cnt : 0
}

function riseWidth(x: number[], idx: number): number {
  if (idx <= 0) return 0
  let j = idx
  while (j > 0 && x[j - 1] <= x[j]) j--
  return idx - j
}

/** 3 点中值滤波：去掉单点毛刺（含负增量剔除后的残差尖峰） */
function medianFilter3(x: number[]): number[] {
  const n = x.length
  if (n < 3) return x.slice()
  const y = new Array<number>(n)
  y[0] = x[0]
  y[n - 1] = x[n - 1]
  for (let i = 1; i < n - 1; i++) {
    const a = x[i - 1]
    const b = x[i]
    const c = x[i + 1]
    y[i] = a <= b ? (b <= c ? b : a <= c ? c : a) : b <= c ? (c <= a ? c : b) : a <= c ? a : b
  }
  return y
}

/**
 * 日节律可解释度（0-1）：越大越像自然节律爬升，而非人工强推。
 *
 * 区分原则：
 * 1) 午后从低谷爬升、1–2h 后回落峰值 → 节律/自然波
 * 2) 任意时刻阶跃，且高位持续数小时 → 投流供给（不可用小时效应解释）
 */
function diurnalExplainScore(x: number[], tMs: number[], jumpI: number, k = 3): number {
  if (jumpI < k || jumpI >= x.length - k) return 0
  const before = winMean(x, jumpI, k, true)
  const after = winMean(x, jumpI, k, false)
  const observed = after / Math.max(before, 1e-6)
  if (observed <= 1.05) return 0

  // 小时基线：优先只用跃升前样本，避免被投放段抬高
  const byHour = new Map<number, number[]>()
  const limit = Math.max(12, Math.floor(jumpI * 0.85))
  for (let i = 0; i < limit; i++) {
    const h = toLocalHour(tMs[i])
    const arr = byHour.get(h) || []
    arr.push(x[i])
    byHour.set(h, arr)
  }
  // 样本不足时退化为全序列（仍稳健中位）
  const useAll = byHour.size < 6
  if (useAll) {
    for (let i = 0; i < x.length; i++) {
      const h = toLocalHour(tMs[i])
      const arr = byHour.get(h) || []
      arr.push(x[i])
      byHour.set(h, arr)
    }
  }
  const hourMed = (h: number) => {
    const arr = byHour.get(h)
    return arr && arr.length ? median(arr) : median(x) || 1
  }

  const hBefore = toLocalHour(tMs[Math.max(0, jumpI - k)])
  const hAfter = toLocalHour(tMs[Math.min(tMs.length - 1, jumpI + k)])
  const diurnalRatio = Math.max(hourMed(hAfter), 1e-6) / Math.max(hourMed(hBefore), 1e-6)

  // 观测跃升与小时效应是否一致（一致→偏节律）
  const ratioMatch = Math.exp(-Math.abs(Math.log(Math.max(observed, 1e-6) / Math.max(diurnalRatio, 1e-6))))

  // 跃升后相对「该小时正常量级」：远超正常→更像投流
  const afterResid = after / Math.max(hourMed(hAfter), 1e-6)
  const residOk = Math.exp(-Math.max(0, afterResid - 1.2) / 2.5) // 1.2×内算正常

  // 上升沿：真阶跃（≤3 点）几乎不可能是人体节律缓升
  const rw = riseWidth(x, jumpI)
  const gradual = clip01((rw - 2) / 8)

  // 高位持续性：1h 后仍接近跃升后水平 → 供给；快速回落 → 峰值/节律
  const holdN = 12 // ≈1h
  const laterFrom = Math.min(x.length - 1, jumpI + holdN)
  const laterTo = Math.min(x.length, jumpI + holdN * 3)
  let laterMean = 0
  let cnt = 0
  for (let i = laterFrom; i < laterTo; i++) {
    laterMean += x[i]
    cnt++
  }
  laterMean = cnt ? laterMean / cnt : after
  const persist = laterMean / Math.max(after, 1e-6) // 1=不衰减
  // 高持续 → 像投流 → 降低节律分
  const supplyHold = clip01((persist - 0.45) / 0.4)

  const active =
    (hAfter >= 11 && hAfter <= 15) || (hAfter >= 18 && hAfter <= 23) ? 1 : 0

  // 节律分高 = 像自然；供给持续则强力拉低
  return clip01(
    0.22 * ratioMatch +
      0.18 * residOk +
      0.18 * gradual +
      0.12 * active * ratioMatch +
      0.3 * (1 - supplyHold)
  )
}

/**
 * 计算非自然流量指数（0-100）
 * @param points 按时间升序的快照
 */
export function computeBoostIndex(points: BoostIndexInputPoint[]): BoostIndexResult {
  const empty = (insufficient: string, score = 0): BoostIndexResult => ({
    score,
    level: 'low',
    levelText: '数据不足',
    sampleCount: points.length,
    windowHours: 48,
    parts: { shape: 0, excess: 0, aux: 0, co: 0, rhythmPenalty: 0 },
    evidence: [],
    insufficient,
  })

  if (!points || points.length < MIN_POINTS) {
    return empty(`样本不足（需≥${MIN_POINTS}点，当前${points?.length || 0}）`)
  }

  // 清洗：近重复（<2s）与乱序
  const clean: BoostIndexInputPoint[] = []
  for (const p of points) {
    if (!clean.length) {
      clean.push(p)
      continue
    }
    const dt = p.created_at - clean[clean.length - 1].created_at
    if (dt < 2000) continue
    clean.push(p)
  }
  if (clean.length < MIN_POINTS) return empty('有效样本不足')

  // 前 48h 窗口：以首点为锚
  const t0 = clean[0].created_at
  const tEnd = t0 + WINDOW_MS
  const win = clean.filter((p) => p.created_at <= tEnd)
  if (win.length < MIN_POINTS) return empty('前48h样本不足')

  // 速率序列（按实际 Δt 归一到 5min）
  // 负播放增量（回刷/脏点）整点剔除，不参与形态检测
  const tMs: number[] = []
  const dPlay: number[] = []
  const dDm: number[] = []
  const dCmt: number[] = []
  for (let i = 1; i < win.length; i++) {
    const a = win[i - 1]
    const b = win[i]
    const dtS = (b.created_at - a.created_at) / 1000
    if (dtS <= 0) continue
    const dP = b.play - a.play
    if (dP < 0) continue
    const scale = NOMINAL_DT_S / dtS
    tMs.push(b.created_at)
    dPlay.push(dP * scale)
    dDm.push((b.video_review - a.video_review) * scale)
    dCmt.push((b.comment - a.comment) * scale)
  }
  const n = dPlay.length
  if (n < MIN_POINTS - 2) return empty('增量点不足')

  // 3 点中值滤波；超额积分用原速率
  const xRaw = dPlay
  const x = medianFilter3(dPlay)

  const med = median(x) || 1
  const start = coldStartEnd(x, tMs)

  // 形态窗：0..46h（尾部 2h 保护带）
  const t0s = tMs[0] || 0
  const shapeEndMs = t0s + SHAPE_WINDOW_H * 3600 * 1000
  let shapeEnd = x.length
  for (let i = 0; i < tMs.length; i++) {
    if (tMs[i] > shapeEndMs) {
      shapeEnd = i
      break
    }
  }
  shapeEnd = Math.max(start + 6, Math.min(shapeEnd, n))

  // 主检测：仍在滤波速率 x 上（与 v4 一致），但限制在 shapeEnd 内
  function detectInX() {
    const den = Math.max(1, 0.08 * med)
    const absGate = Math.max(2 * med, 1)
    let jumpR = 0
    let jumpI = -1
    let cliffR = 0
    let cliffI = -1
    for (let i = Math.max(3, start); i < shapeEnd - 3; i++) {
      const before = winMean(x, i, 3, true)
      const after = winMean(x, i, 3, false)
      const jr = after / Math.max(before, den)
      const cr = before / Math.max(after, den)
      if (after >= absGate && jr > jumpR) {
        jumpR = jr
        jumpI = i
      }
      if (before >= absGate && cr > cliffR) {
        cliffR = cr
        cliffI = i
      }
    }
    return { jumpR, jumpI, cliffR, cliffI }
  }

  const { jumpR, jumpI, cliffR, cliffI } = detectInX()
  const plat = plateauScore(x, Math.max(start, jumpI), 6)
  const rw = riseWidth(x, jumpI)

  const jumpHour = jumpI >= 0 && jumpI < n ? toLocalHour(tMs[jumpI]) : -1
  const activeHour = jumpHour >= 12 && jumpHour <= 14 ? 1 : jumpHour >= 18 && jumpHour <= 23 ? 1 : 0
  const slowRise = rw >= 8 ? 1 : 0
  const diurnalScore = jumpI >= 0 ? diurnalExplainScore(x, tMs, jumpI, 3) : 0
  const rhythm = clip01(0.3 * (0.5 * activeHour + 0.5 * slowRise) + 0.7 * diurnalScore)

  // 残差闸门：去小时效应后跃升是否仍显著
  // 若残差失真（resid 低但 raw 跃升明确且 diurnal 低），不得重罚
  const resid = residualSeries(x, tMs, start)
  let residJumpR = 1
  if (jumpI >= 0 && jumpI < shapeEnd - 3) {
    const denR = Math.max(1, 0.12 * (median(resid) || 1))
    const beforeR = winMean(resid, jumpI, 3, true)
    const afterR = winMean(resid, jumpI, 3, false)
    residJumpR = afterR / Math.max(beforeR, denR)
  }
  const rawJumpOk = jumpR >= 2.0
  const diurLow = diurnalScore < 0.5
  let residGate: number
  if (residJumpR >= 1.8 && rw <= 5) residGate = 1
  else if (residJumpR >= 1.2) residGate = 0.75
  else if (diurLow && rawJumpOk) residGate = 0.85 // 残差不可信时以 raw+低节律为准
  else if (diurLow) residGate = 0.55
  else residGate = 0.25

  const excess = excessRatio(xRaw, tMs)
  const accel = accelSpike(x)
  const syncDm = corrSeries(x, medianFilter3(dDm))
  const syncCmt = corrSeries(x, medianFilter3(dCmt))

  const jS = clip01((jumpR - 1.2) / 3.5) * residGate
  const cS = clip01((cliffR - 1.2) / 3.5)
  const platDur = clip01(plat.len / 96)
  const platDecayS = clip01((plat.decay - 0.55) / 0.45)
  const sust = sustainedHighScore(x, start, shapeEnd)
  // 长高段只补「缺断崖/缺传统平台」且超额已偏高的中间形态
  const sustRelevant =
    jumpR < 2.6 && cliffR < 2.4 && plat.len < 48 && (excess >= 0.145 || jumpR >= 2.3)
  const pS = clip01(
    Math.max(
      plat.score / 1.5,
      0.55 * platDur + 0.25 * platDecayS + 0.2 * jS * platDur,
      sustRelevant ? 0.8 * sust.score : 0.12 * sust.score
    )
  )
  const eS = clip01(excess / 0.2)
  const aS = clip01(accel / 12)
  const stepS = clip01((1 - Math.min(rw, 16) / 16) * jS * (1 - 0.85 * diurnalScore))

  const dmStep = detectStep(medianFilter3(dDm), start, 3, median(dDm) || 1)
  const cmtStep = detectStep(medianFilter3(dCmt), start, 3, median(dCmt) || 1)
  const coJump =
    jumpI >= 0 &&
    jumpI < shapeEnd &&
    ((dmStep.jumpI >= 0 && Math.abs(dmStep.jumpI - jumpI) <= 6) ||
      (cmtStep.jumpI >= 0 && Math.abs(cmtStep.jumpI - jumpI) <= 6))
      ? 1
      : 0

  const syncAvg = (syncDm + syncCmt) / 2
  const coS = clip01(0.6 * coJump + 0.4 * ((syncAvg + 1) / 2))

  const shapeRaw = 0.38 * jS + 0.22 * pS + 0.22 * cS + 0.18 * stepS
  const auxRaw = 0.55 * aS + 0.25 * jS + 0.2 * coJump

  const shape = clip01(shapeRaw)
  const excessPart = eS
  const aux = clip01(auxRaw)
  const co = coS

  let combined = 0.42 * shape + 0.33 * excessPart + 0.15 * aux + 0.1 * co
  const rhythmPenalty = 0.4 * rhythm
  combined *= 1 - rhythmPenalty

  let score = combined * 100
  // 强规则：残差闸门通过才给投流加分
  const stepCliffCombo =
    jumpR >= 2.5 && rw <= 4 && cliffR >= 2.5 && diurnalScore < 0.55 && residJumpR >= 1.8
  const stepPlateauCombo =
    jumpR >= 2.2 &&
    plat.len >= 48 &&
    plat.decay >= 0.55 &&
    plat.score >= 1.2 &&
    diurnalScore < 0.55 &&
    residJumpR >= 1.6
  // 长高段：仅用于「中等跃升、无断崖」的补充（不与 stepCliff 叠加大额加分）
  const sustainedCombo =
    sustRelevant &&
    sust.score >= 0.45 &&
    jumpR >= 1.35 &&
    rw <= 6 &&
    diurnalScore < 0.65 &&
    residJumpR >= 1.2
  const strongBoost = stepCliffCombo || stepPlateauCombo || sustainedCombo
  const strongNatural = (jumpR < 2 && cliffR < 2 && rhythm >= 0.75) || diurnalScore >= 0.75
  if (strongBoost) score = Math.min(100, score + 12)
  if (sustainedCombo && !stepCliffCombo && !stepPlateauCombo) score = Math.min(100, score + 5)
  if (stepCliffCombo && jumpR >= 3 && cliffR >= 2.5 && rw <= 3 && residJumpR >= 2.2) {
    score = Math.min(100, score + 8)
  }
  if (stepPlateauCombo && !stepCliffCombo) score = Math.min(100, score + 6)
  if (strongNatural) score = Math.max(0, score - 18)
  // 残差闸门过低且有「跃升」证据时，避免中等假阳性堆到 50+
  if (jumpR >= 2 && residJumpR < 1.5) score = Math.max(0, score - 10)
  score = Math.round(Math.max(0, Math.min(100, score)))

  const evidence: BoostIndexEvidence[] = []
  if (jumpR >= 2) {
    evidence.push({
      key: 'jump',
      label: '播放增速跃升',
      detail: `跃升倍率 ${jumpR.toFixed(1)}×，上升沿 ${rw} 个采样点，残差 ${residJumpR.toFixed(2)}×`,
    })
  }
  if (plat.score >= 0.3 && plat.len >= 12) {
    evidence.push({
      key: 'plateau',
      label: '高位平台',
      detail: `持续约 ${Math.round((plat.len * 5) / 60)}h，衰减比 ${plat.decay.toFixed(2)}`,
    })
  }
  if (cliffR >= 2.5) {
    evidence.push({
      key: 'cliff',
      label: '断崖式回落',
      detail: `回落倍率 ${cliffR.toFixed(1)}×`,
    })
  }
  if (excess >= 0.15) {
    evidence.push({
      key: 'excess',
      label: '超额播放偏高',
      detail: `相对有机包络超额占比 ${(excess * 100).toFixed(1)}%`,
    })
  }
  if (coJump) {
    evidence.push({ key: 'co', label: '三线同步跳变', detail: '播放/弹幕/评论增量同向跃升' })
  }
  if (rhythm >= 0.7 && jumpR < 2.5) {
    evidence.push({
      key: 'rhythm',
      label: '符合日节律',
      detail: '峰形缓升缓降且落在活跃时段，更像自然流量',
    })
  }
  if (!evidence.length) {
    evidence.push({ key: 'flat', label: '形态平稳', detail: '前48h未见明显阶跃或异常平台' })
  }

  const level: BoostIndexResult['level'] =
    score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low'
  const levelText = score >= 70 ? '较高' : score >= 40 ? '中等' : '较低'

  return {
    score,
    level,
    levelText,
    sampleCount: n,
    windowHours: 48,
    parts: {
      shape: Math.round(shape * 100),
      excess: Math.round(excessPart * 100),
      aux: Math.round(aux * 100),
      co: Math.round(co * 100),
      rhythmPenalty: Math.round(rhythmPenalty * 100),
    },
    evidence,
    features: {
      jumpR,
      cliffR,
      riseWidth: rw,
      plateauScore: Math.max(plat.score, sust.score),
      plateauLen: plat.len || sust.len,
      excessRatio: excess,
      diurnalScore,
      residJumpR,
    },
  }
}
