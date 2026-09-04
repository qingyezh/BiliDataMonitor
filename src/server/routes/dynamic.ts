// 动态监测路由
import type { FastifyInstance } from 'fastify'
import { getDb } from '../database.js'
import { BilibiliAPI } from '../crawler/bilibili.js'
import { getCookie } from '../config.js'
import type { DynamicRow, DynamicHistoryRow } from '../types.js'

export default async function dynamicRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/:id/detail', async (req, reply) => {
    const d = getDb()
    const metrics = d.prepare('SELECT * FROM dynamics WHERE dynamic_id = ?').get(req.params.id) as DynamicRow | undefined
    // 实时数据
    let realtime: { like: number; reply: number; forward: number } | null = null
    try {
      const api = new BilibiliAPI(getCookie())
      let dynInfo = await api.getDynamicDetail(req.params.id)
      if (!dynInfo) dynInfo = await api.getDynamicDetailOld(req.params.id)
      if (dynInfo?.stat) {
        realtime = { like: dynInfo.stat.like, reply: dynInfo.stat.reply, forward: dynInfo.stat.forward }
      }
    } catch {
      // 实时获取失败不阻塞
    }
    if (!metrics && !realtime) {
      return reply.code(404).send({ success: false, message: '暂无该动态数据，请先添加监测任务并刷新' })
    }
    return { success: true, data: { metrics: metrics || null, realtime } }
  })

  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>('/:id/history', async (req) => {
    const d = getDb()
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : undefined
    let sql = 'SELECT * FROM dynamic_history WHERE dynamic_id = ? ORDER BY created_at ASC'
    const params: (string | number)[] = [req.params.id]
    if (limit !== undefined) {
      sql += ' LIMIT ?'
      params.push(limit)
    }
    if (offset !== undefined) {
      sql += ' OFFSET ?'
      params.push(offset)
    }
    const data = d.prepare(sql).all(...params) as DynamicHistoryRow[]
    return { success: true, data }
  })
}
