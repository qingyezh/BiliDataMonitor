// UP 详情/趋势/排行/历史路由（读缓存表，前端零计算）
import type { FastifyInstance } from 'fastify'
import {
  getUpMetrics, listVideosByMid, countVideosByMid, listVideoHistory,
  listUpDailyStats, listUpMonthlyTrend, listUpDurationDist, listUpHistory,
} from '../database.js'

export default async function upRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { mid: string } }>('/:mid/status', async (req, reply) => {
    const metrics = getUpMetrics(req.params.mid)
    if (!metrics) return reply.code(404).send({ success: false, message: '暂无该UP主数据，请先添加监测任务并刷新' })
    return { success: true, data: metrics }
  })

  app.get<{ Params: { mid: string }; Querystring: { page?: string; page_size?: string; sort?: string; order?: string; keyword?: string } }>(
    '/:mid/videos', async (req) => {
      const mid = req.params.mid
      const page = Math.max(1, Number(req.query.page) || 1)
      const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 20))
      const sort = req.query.sort || 'play'
      const order = req.query.order || 'desc'
      const keyword = req.query.keyword || ''
      const videos = listVideosByMid(mid, {
        sort, order, keyword,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      const total = countVideosByMid(mid, keyword)
      return {
        success: true,
        data: { items: videos, total, page, page_size: pageSize },
      }
    })

  app.get<{ Params: { mid: string } }>('/:mid/analysis', async (req, reply) => {
    const mid = req.params.mid
    const metrics = getUpMetrics(mid)
    if (!metrics) return reply.code(404).send({ success: false, message: '暂无该UP主数据' })
    return {
      success: true,
      data: {
        metrics,
        monthly_trend: listUpMonthlyTrend(mid),
        duration_dist: listUpDurationDist(mid),
        history: listUpHistory(mid),
      },
    }
  })

  app.get<{ Params: { mid: string } }>('/:mid/history', async (req) => {
    return { success: true, data: listUpDailyStats(req.params.mid) }
  })

  app.get<{ Params: { mid: string; bvid: string }; Querystring: { limit?: string; offset?: string } }>('/:mid/video-history/:bvid', async (req) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : undefined
    return { success: true, data: listVideoHistory(req.params.bvid, limit, offset) }
  })
}
