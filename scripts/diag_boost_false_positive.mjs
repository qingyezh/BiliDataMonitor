/**
 * 诊断 BV13Xew6LE7T：定位 jump/cliff 命中位置
 * node --experimental-sqlite scripts/diag_boost_false_positive.mjs
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = 'D:/Desktop/program/preoject/BiliDataMonitor-linux'
const db = new DatabaseSync(path.join(ROOT, 'app/data/analysis/server_monitor_copy.db'), { readOnly: true })
const bvid = process.argv[2] || 'BV13Xew6LE7T'
const rows = db.prepare('SELECT play, video_review, comment, created_at FROM video_history WHERE bvid=? ORDER BY created_at ASC').all(bvid)

function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const t0 = rows[0].created_at
const win = rows.filter((r) => r.created_at <= t0 + 48 * 3600 * 1000)
const x = []
const tMs = []
for (let i = 1; i < win.length; i++) {
  const dt = (win[i].created_at - win[i - 1].created_at) / 1000
  if (dt <= 0) continue
  x.push(((win[i].play - win[i - 1].play) * 300) / dt)
  tMs.push(win[i].created_at)
}
const n = x.length
const med = median(x)
const peak = Math.max(...x)
console.log('n', n, 'med', med.toFixed(1), 'peak', peak.toFixed(1), 'peak/med', (peak / med).toFixed(1))

function winMean(xs, i, k, before) {
  const a = before ? Math.max(0, i - k) : i
  const b = before ? Math.max(1, i) : Math.min(xs.length, i + k)
  if (b <= a) return 0
  let s = 0
  for (let j = a; j < b; j++) s += xs[j]
  return s / (b - a)
}

const start = Math.min(12, Math.floor(n / 10))
console.log('start', start)
let jumpR = 0, jumpI = -1, cliffR = 0, cliffI = -1
for (let i = Math.max(3, start); i < n - 3; i++) {
  const before = winMean(x, i, 3, true)
  const after = winMean(x, i, 3, false)
  const jr = after / Math.max(before, 1)
  const cr = before / Math.max(after, 1)
  if (jr > jumpR) { jumpR = jr; jumpI = i }
  if (cr > cliffR) { cliffR = cr; cliffI = i }
}
const fmt = (i) => (i >= 0 ? `${Math.round((tMs[i] - t0) / 60000)}min rate=${x[i].toFixed(0)}` : 'n/a')
console.log('OLD jumpR', jumpR.toFixed(2), 'at', fmt(jumpI), 'before', winMean(x, jumpI, 3, true).toFixed(1), 'after', winMean(x, jumpI, 3, false).toFixed(1))
console.log('OLD cliffR', cliffR.toFixed(2), 'at', fmt(cliffI), 'before', winMean(x, cliffI, 3, true).toFixed(1), 'after', winMean(x, cliffI, 3, false).toFixed(1))

// 前12点最大值
const earlyMax = Math.max(...x.slice(0, Math.min(36, n)))
console.log('earlyMax(6h)', earlyMax.toFixed(0))
// 冷启动结束：峰值后首次低于 20% earlyMax
let coldEnd = 0
const peakIdx = x.indexOf(peak)
for (let i = peakIdx; i < n; i++) {
  if (x[i] < 0.2 * earlyMax) { coldEnd = i; break }
}
console.log('peakIdx', peakIdx, 'coldEnd', coldEnd, fmt(coldEnd), 'span_min', Math.round((tMs[coldEnd] - t0) / 60000))

// 在 coldEnd 之后重找 jump/cliff（含绝对门槛）
const med2 = median(x.slice(coldEnd)) || med
console.log('med_after_cold', med2.toFixed(1))
let j2 = 0, ji2 = -1, c2 = 0, ci2 = -1
for (let i = Math.max(3, coldEnd); i < n - 3; i++) {
  const before = winMean(x, i, 3, true)
  const after = winMean(x, i, 3, false)
  const absOk = after >= Math.max(2 * med2, 5) // 绝对量门槛
  const jr = after / Math.max(before, 0.05 * med2)
  const cr = before / Math.max(after, 0.05 * med2)
  if (absOk && jr > j2) { j2 = jr; ji2 = i }
  if (before >= Math.max(2 * med2, 5) && cr > c2) { c2 = cr; ci2 = i }
}
console.log('FIXED jumpR', j2.toFixed(2), 'at', fmt(ji2))
console.log('FIXED cliffR', c2.toFixed(2), 'at', fmt(ci2))

const boost = await import(pathToFileURL(path.join(ROOT, 'src/server/dist/analytics/boostIndex.js')).href)
const r = boost.computeBoostIndex(win.map((p) => ({ play: p.play, video_review: p.video_review, comment: p.comment, created_at: p.created_at })))
console.log('OLD_SCORE', r.score, 'features', r.features, 'evidence', r.evidence)
