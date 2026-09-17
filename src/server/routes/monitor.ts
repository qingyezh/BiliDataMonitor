// 任务 CRUD + 刷新路由
import type { FastifyInstance } from 'fastify'
import { createTask, deleteTask, listTasks, getTaskByTarget, updateTask, deleteHistoryPoint, findNearDuplicateHistory, type HistoryKind } from '../database.js'
import { refreshTaskNow, refreshAllNow } from '../scheduler.js'
import { BilibiliAPI } from '../crawler/bilibili.js'
import { getCookie, loadSettings } from '../config.js'
import { requireRoot } from '../middleware.js'
import type { TaskType } from '../types.js'

export default async function monitorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tasks', async () => {
    return { success: true, data: listTasks() }
  })

  app.post<{ Body: { task_type: string; target: string; name?: string; max_videos?: number } }>('/tasks', { preHandler: [requireRoot] }, async (req, reply) => {
    const { task_type, target, name, max_videos } = req.body || {}
    const settings = loadSettings()
    if (!['up', 'video', 'dynamic', 'column'].includes(task_type)) {
      return reply.code(400).send({ success: false, message: 'task_type 必须是 up、video、dynamic 或 column' })
    }
    const t = String(target || '').trim()
    if (!t) return reply.code(400).send({ success: false, message: 'target 不能为空' })
    if (getTaskByType(task_type, t)) {
      return reply.code(400).send({ success: false, message: '该任务已存在' })
    }

    // 联网校验目标并取名
    const api = new BilibiliAPI(getCookie())
    let displayName = name?.trim() || t
    try {
      if (task_type === 'up') {
        const page = await api.getUserVideos(Number(t), 1, 1)
        const vlist = page?.list?.vlist || []
        if (!page || vlist.length === 0) {
          return reply.code(404).send({ success: false, message: 'UP主不存在或无视频' })
        }
        displayName = vlist[0].author || displayName
      } else if (task_type === 'video') {
        const info = await api.getVideoInfo(t)
        if (!info) return reply.code(404).send({ success: false, message: '视频不存在' })
        displayName = info.title.slice(0, 60)
      } else if (task_type === 'dynamic') {
        let dynInfo = await api.getDynamicDetail(t)
        if (!dynInfo) dynInfo = await api.getDynamicDetailOld(t)
        if (!dynInfo) return reply.code(404).send({ success: false, message: '动态不存在' })
        displayName = dynInfo.title || `动态 ${t}`
      } else if (task_type === 'column') {
        const colInfo = await api.getColumnInfo(t)
        if (!colInfo) return reply.code(404).send({ success: false, message: '专栏不存在' })
        displayName = colInfo.title || `专栏 ${t}`
      }
    } catch {
      // 校验失败但允许创建（下次轮询会记录错误）
    }

    const task = createTask({
      task_type: task_type as TaskType,
      target: t,
      name: displayName,
      enabled: 1,
      max_videos: task_type === 'up' ? Math.max(0, Number(max_videos) || settings.default_max_videos) : 0,
    })
    return { success: true, data: task }
  })

  app.put<{ Params: { id: string }; Body: { name?: string; enabled?: number | boolean; max_videos?: number } }>('/tasks/:id', { preHandler: [requireRoot] }, async (req, reply) => {
    const id = Number(req.params.id)
    const body = req.body || {}
    const patch: { name?: string; enabled?: number; max_videos?: number } = {}
    if (body.name !== undefined) patch.name = String(body.name)
    if (body.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0
    if (body.max_videos !== undefined) patch.max_videos = Math.max(0, Number(body.max_videos))
    const updated = updateTask(id, patch)
    if (!updated) return reply.code(404).send({ success: false, message: '任务不存在' })
    return { success: true, data: updated }
  })

  app.delete<{ Params: { id: string } }>('/tasks/:id', { preHandler: [requireRoot] }, async (req, reply) => {
    const id = Number(req.params.id)
    deleteTask(id)
    return { success: true, message: '已删除' }
  })

  app.post<{ Params: { id: string } }>('/tasks/:id/refresh', { preHandler: [requireRoot] }, async (req, reply) => {
    try {
      await refreshTaskNow(Number(req.params.id))
      return { success: true, message: '刷新完成' }
    } catch (e) {
      return reply.code(400).send({ success: false, message: (e as Error).message })
    }
  })

  app.post('/refresh-all', { preHandler: [requireRoot] }, async () => {
    try {
      const stats = await refreshAllNow()
      return { success: true, data: stats }
    } catch (e) {
      return { success: false, message: (e as Error).message }
    }
  })

  // 近重复历史点扫描（双实例脏数据，间隔默认 <4s）
  app.get<{ Querystring: { max_gap_ms?: string; limit?: string } }>('/near-duplicates', { preHandler: [requireRoot] }, async (req) => {
    const maxGap = Math.min(60000, Math.max(100, Number(req.query.max_gap_ms) || 4000))
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200))
    return { success: true, data: findNearDuplicateHistory(maxGap, limit) }
  })

  // 删除单条历史快照（异常数据点）
  app.delete<{ Params: { kind: string; id: string } }>('/history/:kind/:id', { preHandler: [requireRoot] }, async (req, reply) => {
    const kind = req.params.kind
    const id = Number(req.params.id)
    if (!['up', 'video', 'dynamic', 'column'].includes(kind)) {
      return reply.code(400).send({ success: false, message: 'kind 必须是 up、video、dynamic 或 column' })
    }
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ success: false, message: 'id 无效' })
    }
    const result = deleteHistoryPoint(kind as HistoryKind, id)
    if (!result.deleted) {
      return reply.code(404).send({ success: false, message: '数据点不存在' })
    }
    return { success: true, data: result }
  })
}

function getTaskByType(type: string, target: string) {
  return getTaskByTarget(type as 'up' | 'video' | 'dynamic' | 'column', target)
}

