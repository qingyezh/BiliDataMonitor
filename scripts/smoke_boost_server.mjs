/**
 * 服务器冒烟：用 dist 模块对真实库计算非自然流量指数
 * node --experimental-sqlite smoke_boost.mjs [bvid]
 */
import { listVideoHistoryLeading } from './src/server/dist/database.js'
import { computeBoostIndex } from './src/server/dist/analytics/boostIndex.js'

const bvid = process.argv[2] || 'BV13Xew6LE7T'
const rows = listVideoHistoryLeading(bvid, 48)
console.log('bvid', bvid, 'leading_points', rows.length)
const r = computeBoostIndex(
  rows.map((x) => ({
    play: x.play,
    video_review: x.video_review,
    comment: x.comment,
    created_at: x.created_at,
  }))
)
console.log(
  JSON.stringify(
    {
      score: r.score,
      level: r.level,
      levelText: r.levelText,
      sampleCount: r.sampleCount,
      parts: r.parts,
      evidence: r.evidence?.map((e) => e.label) || [],
      insufficient: r.insufficient || null,
    },
    null,
    2
  )
)
if (typeof r.score !== 'number' || r.score < 0 || r.score > 100) {
  console.error('SMOKE_FAIL score out of range')
  process.exit(1)
}
console.log('SMOKE_OK')
