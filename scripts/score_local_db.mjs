/**
 * 用当前 dist 算法给本地库 8.20 后视频打分
 * node --experimental-sqlite scripts/score_local_db.mjs [out.json] [algoLabel]
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = 'D:/Desktop/program/preoject/BiliDataMonitor-linux'
const DB = path.join(ROOT, 'app/data/analysis/server_monitor_copy.db')
const outPath = process.argv[2] || path.join(ROOT, 'app/data/analysis/scores_snapshot.json')
const label = process.argv[3] || 'v4'
const CUTOFF_S = 1787155200 // 2026-08-20 00:00 +08 ≈

const db = new DatabaseSync(DB, { readOnly: true })
const boost = await import(pathToFileURL(path.join(ROOT, 'src/server/dist/analytics/boostIndex.js')).href)
console.log('ALGO_VERSION', boost.BOOST_ALGO_VERSION, 'label', label)

const videos = db
  .prepare(
    `SELECT v.bvid, v.title, v.created, v.play FROM videos v WHERE v.created >= ? ORDER BY v.created ASC`
  )
  .all(CUTOFF_S)

const histStmt = db.prepare(
  'SELECT play, video_review, comment, created_at FROM video_history WHERE bvid = ? ORDER BY created_at ASC'
)

const rows = []
for (const v of videos) {
  const hist = histStmt.all(v.bvid)
  if (hist.length < 24) {
    rows.push({ bvid: v.bvid, title: v.title, n: hist.length, skip: 'too_few' })
    continue
  }
  const r = boost.computeBoostIndex(
    hist.map((x) => ({
      play: x.play,
      video_review: x.video_review,
      comment: x.comment,
      created_at: x.created_at,
    }))
  )
  rows.push({
    bvid: v.bvid,
    title: (v.title || '').slice(0, 28),
    created: v.created,
    n: r.sampleCount,
    score: r.score,
    level: r.level,
    jumpR: r.features?.jumpR ?? null,
    cliffR: r.features?.cliffR ?? null,
    riseWidth: r.features?.riseWidth ?? null,
    platLen: r.features?.plateauLen ?? null,
    excessRatio: r.features?.excessRatio ?? null,
    diurnalScore: r.features?.diurnalScore ?? null,
    ev: (r.evidence || []).map((e) => e.key).join('+'),
    insufficient: r.insufficient || null,
  })
}

rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
console.log('bvid        score lvl    jump  cliff rw plat excess diur ev')
for (const r of rows) {
  if (r.skip) {
    console.log(r.bvid, 'SKIP', r.skip, 'n', r.n, r.title)
    continue
  }
  console.log(
    r.bvid,
    String(r.score).padStart(3),
    r.level.padEnd(6),
    String(r.jumpR ?? '-').padStart(5),
    String(r.cliffR ?? '-').padStart(5),
    String(r.riseWidth ?? '-').padStart(3),
    String(r.platLen ?? '-').padStart(4),
    String(r.excessRatio ?? '-').padStart(5),
    String(r.diurnalScore ?? '-').padStart(4),
    r.ev,
    r.title
  )
}

const scores = rows.filter((r) => typeof r.score === 'number').map((r) => r.score)
console.log('n_scored', scores.length, 'mean', (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1))

fs.writeFileSync(outPath, JSON.stringify({ label, algo: boost.BOOST_ALGO_VERSION, rows }, null, 2))
console.log('WROTE', outPath)
