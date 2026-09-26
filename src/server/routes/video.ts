// 单视频监测路由
import type { FastifyInstance } from 'fastify'
import {
  getVideoMetrics,
  listVideoHistory,
  listVideoHistoryLeading,
  getVideoBoostIndex,
  recomputeVideoBoostIndex,
} from '../database.js'
import { computeBoostIndex, BOOST_ALGO_VERSION } from '../analytics/boostIndex.js'
import { BilibiliAPI } from '../crawler/bilibili.js'
import { getCookie } from '../config.js'

function boostRowToApi(row: NonNullable<ReturnType<typeof getVideoBoostIndex>>) {
  let evidence: unknown = []
  try {
    evidence = JSON.parse(row.evidence_json || '[]')
  } catch {
    evidence = []
  }
  return {
    score: row.score,
    level: row.level,
    levelText: row.level_text,
    sampleCount: row.sample_count,
    windowHours: row.window_hours,
    parts: {
      shape: row.shape_score,
      excess: row.excess_score,
      aux: row.aux_score,
      co: row.co_score,
      rhythmPenalty: row.rhythm_penalty,
    },
    evidence,
    insufficient: row.insufficient || undefined,
    cached: true,
    computedAt: row.computed_at,
    algoVersion: row.algo_version,
    computeBucket: row.compute_bucket,
  }
}

export default async function videoRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { bvid: string }; Querystring: { boost_recalc?: string } }>(
    '/:bvid/detail',
    async (req, reply) => {
      const metrics = getVideoMetrics(req.params.bvid)
      // 实时数据
      let realtime: { play: number; danmaku: number; reply: number; page_count: number } | null = null
      try {
        const api = new BilibiliAPI(getCookie())
        const info = await api.getVideoInfo(req.params.bvid)
        if (info?.stat) {
          realtime = {
            play: info.stat.view,
            danmaku: info.stat.danmaku,
            reply: info.stat.reply,
            page_count: info.videos || 1,
          }
        }
      } catch {
        // 实时获取失败不阻塞
      }
      if (!metrics && !realtime) {
        return reply
          .code(404)
          .send({ success: false, message: '暂无该视频数据，请先添加监测任务并刷新' })
      }

      // 非自然流量指数：优先读 6h 桶缓存；强制重算或缺缓存时现算
      const force = req.query.boost_recalc === '1' || req.query.boost_recalc === 'true'
      let boostIndex: unknown = null
      try {
        if (force) {
          const row = recomputeVideoBoostIndex(req.params.bvid, Date.now(), true)
          boostIndex = row ? boostRowToApi(row) : null
        } else {
          let row = getVideoBoostIndex(req.params.bvid)
          if (!row || row.algo_version !== BOOST_ALGO_VERSION) {
            // 窗口未满或到桶时写缓存；若被 6h 桶拦住则仅为展示现算
            row = recomputeVideoBoostIndex(req.params.bvid, Date.now(), false) || row
          }
          if (row && row.algo_version === BOOST_ALGO_VERSION) {
            boostIndex = boostRowToApi(row)
          } else {
            const leading = listVideoHistoryLeading(req.params.bvid, 48)
            const raw = computeBoostIndex(
              leading.map((r) => ({
                play: r.play,
                video_review: r.video_review,
                comment: r.comment,
                created_at: r.created_at,
              }))
            )
            boostIndex = { ...raw, cached: false }
          }
        }
      } catch {
        boostIndex = null
      }

      return { success: true, data: { metrics: metrics || null, realtime, boostIndex } }
    }
  )

  app.get<{ Params: { bvid: string }; Querystring: { limit?: string; offset?: string } }>('/:bvid/history', async (req) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : undefined
    return { success: true, data: listVideoHistory(req.params.bvid, limit, offset) }
  })
}
