// 专栏监测路由
import type { FastifyInstance } from 'fastify'
import { getDb } from '../database.js'
import { BilibiliAPI } from '../crawler/bilibili.js'
import { getCookie } from '../config.js'
import type { ColumnRow, ColumnHistoryRow } from '../types.js'

export default async function columnRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { cvid: string } }>('/:cvid/detail', async (req, reply) => {
    const d = getDb()
    const metrics = d.prepare('SELECT * FROM columns WHERE cvid = ?').get(req.params.cvid) as ColumnRow | undefined
    // 实时数据
    let realtime: { like: number; reply: number; favorite: number } | null = null
    try {
      const api = new BilibiliAPI(getCookie())
      const colInfo = await api.getColumnInfo(req.params.cvid)
      if (colInfo) {
        realtime = { like: colInfo.like, reply: colInfo.reply, favorite: colInfo.favorite }
      }
    } catch {
      // 实时获取失败不阻塞
    }
    if (!metrics && !realtime) {
      return reply.code(404).send({ success: false, message: '暂无该专栏数据，请先添加监测任务并刷新' })
    }
    return { success: true, data: { metrics: metrics || null, realtime } }
  })

  app.get<{ Params: { cvid: string }; Querystring: { limit?: string; offset?: string } }>('/:cvid/history', async (req) => {
    const d = getDb()
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : undefined
    let sql = 'SELECT * FROM column_history WHERE cvid = ? ORDER BY created_at ASC'
    const params: (string | number)[] = [req.params.cvid]
    if (limit !== undefined) {
      sql += ' LIMIT ?'
      params.push(limit)
    }
    if (offset !== undefined) {
      sql += ' OFFSET ?'
      params.push(offset)
    }
    const data = d.prepare(sql).all(...params) as ColumnHistoryRow[]
    return { success: true, data }
  })
}
