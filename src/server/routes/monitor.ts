// 任务 CRUD + 刷新路由
import type { FastifyInstance } from 'fastify'
import { createTask, deleteTask, listTasks, getTaskByTarget, updateTask } from '../database.js'
import { refreshTaskNow, refreshAllNow } from '../scheduler.js'
import { BilibiliAPI } from '../crawler/bilibili.js'
import { getCookie, loadSettings } from '../config.js'
import { requireRoot } from '../middleware.js'

export default async function monitorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tasks', async () => {
    return { success: true, data: listTasks() }
  })

  app.post<{ Body: { task_type: string; target: string; name?: string; max_videos?: number } }>('/tasks', { preHandler: [requireRoot] }, async (req, reply) => {
    const { task_type, target, name, max_videos } = req.body || {}
    const settings = loadSettings()
    if (task_type !== 'up' && task_type !== 'video') {
      return reply.code(400).send({ success: false, message: 'task_type 必须是 up 或 video' })
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
      } else {
        const info = await api.getVideoInfo(t)
        if (!info) return reply.code(404).send({ success: false, message: '视频不存在' })
        displayName = info.title.slice(0, 60)
      }
    } catch {
      // 校验失败但允许创建（下次轮询会记录错误）
    }

    const task = createTask({
      task_type,
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
}

function getTaskByType(type: string, target: string) {
  return getTaskByTarget(type as 'up' | 'video', target)
}

