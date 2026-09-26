/**
 * 批量对比 v2 算法在 first48 样本上的分数
 * node --experimental-sqlite scripts/validate_boost_v2.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = 'D:/Desktop/program/preoject/BiliDataMonitor-linux'
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/data/analysis/first48_bundle.json'), 'utf8'))
const boost = await import(pathToFileURL(path.join(ROOT, 'src/server/dist/analytics/boostIndex.js')).href)

const rows = []
for (const item of raw.bundle) {
  const pts = item.history.map((h) => ({
    play: h.play,
    video_review: h.dm,
    comment: h.cmt,
    created_at: h.t,
  }))
  const r = boost.computeBoostIndex(pts)
  rows.push({
    bvid: item.bvid,
    title: (item.video?.title || '').slice(0, 22),
    score: r.score,
    level: r.level,
    jumpR: r.features?.jumpR,
    cliffR: r.features?.cliffR,
    excess: r.features?.excessRatio,
    ev: (r.evidence || []).map((e) => e.key).join('+'),
  })
}
rows.sort((a, b) => b.score - a.score)
console.log('=== BOOST v2 (algo_version 2) ===')
console.log('bvid        score level    jumpR cliffR excess ev')
for (const r of rows) {
  console.log(
    `${r.bvid}  ${String(r.score).padStart(3)}  ${r.level.padEnd(6)}  ${String(r.jumpR ?? '-').padStart(5)} ${String(r.cliffR ?? '-').padStart(5)} ${String(r.excess ?? '-').padStart(5)} ${r.ev}`
  )
}
const scores = rows.map((r) => r.score)
const bucket = { '0-29': 0, '30-49': 0, '50-69': 0, '70-100': 0 }
for (const s of scores) {
  if (s < 30) bucket['0-29']++
  else if (s < 50) bucket['30-49']++
  else if (s < 70) bucket['50-69']++
  else bucket['70-100']++
}
console.log('\nBUCKET', JSON.stringify(bucket), 'mean', (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1))
const target = rows.find((r) => r.bvid === 'BV13Xew6LE7T')
console.log('BV13Xew6LE7T ->', target)
