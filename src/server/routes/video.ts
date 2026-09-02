// 单视频监测路由
import type { FastifyInstance } from 'fastify'
import { getVideoMetrics, listVideoHistory } from '../database.js'
import { BilibiliAPI } from '../crawler/bilibili.js'
import { getCookie } from '../config.js'

export default async function videoRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { bvid: string } }>('/:bvid/detail', async (req, reply) => {
    const metrics = getVideoMetrics(req.params.bvid)
    // 实时数据
    let realtime: { play: number; danmaku: number; reply: number } | null = null
    try {
      const api = new BilibiliAPI(getCookie())
      const info = await api.getVideoInfo(req.params.bvid)
      if (info?.stat) {
        realtime = { play: info.stat.view, danmaku: info.stat.danmaku, reply: info.stat.reply }
      }
    } catch {
      // 实时获取失败不阻塞
    }
    if (!metrics && !realtime) {
      return reply.code(404).send({ success: false, message: '暂无该视频数据，请先添加监测任务并刷新' })
    }
    return { success: true, data: { metrics: metrics || null, realtime } }
  })

  app.get<{ Params: { bvid: string }; Querystring: { limit?: string; offset?: string } }>('/:bvid/history', async (req) => {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : undefined
    return { success: true, data: listVideoHistory(req.params.bvid, limit, offset) }
  })
}

