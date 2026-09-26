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
  }
}

const WINDOW_MS = 48 * 3600 * 1000
const NOMINAL_DT_S = 300
const MIN_POINTS = 24

/** 算法版本：公式/阈值变更时 +1，缓存行将触发重算
 *  v2: 冷启动截断 + 绝对量门槛，修复低基数假跃升
 *  v3: 高位平台须高于中位（排除尾部低平段）；阶跃+长高台+断崖 组合加分
 */
export const BOOST_ALGO_VERSION = 3

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
 * 冷启动结束后下标：首日脉冲峰值后，速率首次降到 earlyMax 的 ratio 以下。
 * 避免把「发布脉冲的衰减/回弹」当成投流跃升或断崖。
 */
function coldStartEnd(x: number[], tMs: number[]): number {
  const n = x.length
  if (n < 12) return 0
  // 前 6h（约 72 桶）内的峰值与起点
  const earlyN = Math.min(n, 72)
  let peakIdx = 0
  for (let i = 1; i < earlyN; i++) if (x[i] > x[peakIdx]) peakIdx = i
  const earlyMax = x[peakIdx] || 1
  // 峰值后首次显著回落
  for (let i = peakIdx; i < n; i++) {
    if (x[i] < 0.2 * earlyMax) return i
  }
  // 全程未回落：跳过至少 2h，最多 25% 序列
  return Math.min(n, Math.max(24, Math.floor(n * 0.25)))
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

function plateauScore(x: number[], start: number, minLen = 6): {
  score: number
  len: number
  decay: number
} {
  const n = x.length
  if (start < 0 || n < minLen * 2) return { score: 0, len: 0, decay: 0 }
  const med = median(x) || 1
  // 高位门槛：须高于序列中位，且不低于冷启动后局部峰值的 20%
  let localPeak = 0
  for (let t = Math.max(0, start); t < n; t++) localPeak = Math.max(localPeak, x[t])
  const highGate = Math.max(med, 0.2 * localPeak, 1)
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
  const tMs: number[] = []
  const dPlay: number[] = []
  const dDm: number[] = []
  const dCmt: number[] = []
  for (let i = 1; i < win.length; i++) {
    const a = win[i - 1]
    const b = win[i]
    const dtS = (b.created_at - a.created_at) / 1000
    if (dtS <= 0) continue
    const scale = NOMINAL_DT_S / dtS
    tMs.push(b.created_at)
    dPlay.push((b.play - a.play) * scale)
    dDm.push((b.video_review - a.video_review) * scale)
    dCmt.push((b.comment - a.comment) * scale)
  }
  const n = dPlay.length
  if (n < MIN_POINTS - 2) return empty('增量点不足')

  const med = median(dPlay) || 1
  // 冷启动：跳过发布脉冲峰值及其衰减段（不再用固定 1h）
  const start = coldStartEnd(dPlay, tMs)

  const { jumpR, jumpI, cliffR, cliffI } = detectStep(dPlay, start, 3, med)
  const plat = plateauScore(dPlay, Math.max(start, jumpI), 6)
  const excess = excessRatio(dPlay, tMs)
  const accel = accelSpike(dPlay)
  const syncDm = corrSeries(dPlay, dDm)
  const syncCmt = corrSeries(dPlay, dCmt)
  const rw = riseWidth(dPlay, jumpI)

  const jumpHour = jumpI >= 0 && jumpI < n ? toLocalHour(tMs[jumpI]) : -1
  const activeHour = jumpHour >= 12 && jumpHour <= 14 ? 1 : jumpHour >= 18 && jumpHour <= 23 ? 1 : 0
  const slowRise = rw >= 8 ? 1 : 0
  const rhythm = 0.5 * activeHour + 0.5 * slowRise

  // 子分 0-1（跃升/断崖同时看倍率与是否达到中位数量级）
  const jS = clip01((jumpR - 1.2) / 3.5)
  const cS = clip01((cliffR - 1.2) / 3.5)
  // 高位平台：强度（高度×时长）与衰减比共同计分
  const platDur = clip01(plat.len / 96) // ≈8h 记满分时长
  const platDecayS = clip01((plat.decay - 0.55) / 0.45)
  const pS = clip01(Math.max(plat.score / 1.5, 0.55 * platDur + 0.25 * platDecayS + 0.2 * jS * platDur))
  const eS = clip01(excess / 0.2)
  const aS = clip01(accel / 12)
  const stepS = clip01((1 - Math.min(rw, 16) / 16) * jS)

  // 三线共跳（同样从冷启动后起算）
  const dmStep = detectStep(dDm, start, 3, median(dDm) || 1)
  const cmtStep = detectStep(dCmt, start, 3, median(dCmt) || 1)
  const coJump =
    jumpI >= 0 &&
    ((dmStep.jumpI >= 0 && Math.abs(dmStep.jumpI - jumpI) <= 6) ||
      (cmtStep.jumpI >= 0 && Math.abs(cmtStep.jumpI - jumpI) <= 6))
      ? 1
      : 0

  const syncAvg = (syncDm + syncCmt) / 2
  const coS = clip01(0.6 * coJump + 0.4 * ((syncAvg + 1) / 2))

  const shapeRaw = 0.35 * jS + 0.25 * pS + 0.2 * cS + 0.2 * stepS
  const auxRaw = 0.55 * aS + 0.25 * jS + 0.2 * coJump

  const shape = clip01(shapeRaw)
  const excessPart = eS
  const aux = clip01(auxRaw)
  const co = coS

  // 综合：形状 40% + 超额 35% + 辅助 15% + 共动 10%
  let combined = 0.4 * shape + 0.35 * excessPart + 0.15 * aux + 0.1 * co
  // 节律惩罚：缓升 + 活跃时段 → 降权
  const rhythmPenalty = 0.3 * rhythm
  combined *= 1 - rhythmPenalty

  // 强规则抬升 / 压低
  let score = combined * 100
  // 典型投流三件套：阶跃 + 持续高位 + 断崖（上升沿允许到 4 个采样点 ≈20min）
  const stepCliffCombo = jumpR >= 2.5 && rw <= 4 && cliffR >= 2.5
  // 阶跃 + 长高台（哪怕断崖较缓，也是持续供给）
  const stepPlateauCombo = jumpR >= 2.2 && plat.len >= 48 && plat.decay >= 0.55 && plat.score >= 1.2
  const strongBoost = stepCliffCombo || stepPlateauCombo
  const strongNatural = jumpR < 2 && cliffR < 2 && rhythm >= 0.75
  if (strongBoost) score = Math.min(100, score + 15)
  if (stepPlateauCombo && !stepCliffCombo) score = Math.min(100, score + 6)
  if (strongNatural) score = Math.max(0, score - 15)
  score = Math.round(Math.max(0, Math.min(100, score)))

  const evidence: BoostIndexEvidence[] = []
  if (jumpR >= 2) {
    evidence.push({
      key: 'jump',
      label: '播放增速跃升',
      detail: `跃升倍率 ${jumpR.toFixed(1)}×，上升沿 ${rw} 个采样点`,
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
      plateauScore: plat.score,
      plateauLen: plat.len,
      excessRatio: excess,
    },
  }
}
