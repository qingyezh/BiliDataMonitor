// 间隔轮询调度器：系统启动后每 interval 分钟轮询所有 enabled 任务
import fs from 'node:fs'
import path from 'node:path'
import { loadSettings, getCookie, DATA_DIR } from './config.js'
import { logger } from './logger.js'
import {
  getDb, listTasks, markTaskRun, writeUpSnapshot, writeVideoSnapshot,
  insertUpHistory, getSchedulerTaskCounts, type VideoSnapshotInput,
} from './database.js'
import { BilibiliAPI, parseLengthToSeconds } from './crawler/bilibili.js'
import type { SchedulerStatus } from './types.js'

const HEARTBEAT_MS = 1_000
const LAST_RUN_PATH = path.join(DATA_DIR, 'last_run_at.json')
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 2000

let running = false
let inFlight = false
let lastRunAt: number | null = null
let nextRunAt: number | null = null
let lastTaskSummary: { ok: number; error: number } = { ok: 0, error: 0 }

function loadLastRunAt(): number | null {
  try {
    if (fs.existsSync(LAST_RUN_PATH)) {
      const data = JSON.parse(fs.readFileSync(LAST_RUN_PATH, 'utf-8'))
      return typeof data.last_run_at === 'number' ? data.last_run_at : null
    }
  } catch { /* ignore */ }
  return null
}

function saveLastRunAt(ts: number): void {
  try {
    fs.writeFileSync(LAST_RUN_PATH, JSON.stringify({ last_run_at: ts }))
  } catch { /* ignore */ }
}

export function getSchedulerStatus(): SchedulerStatus {
  return {
    running,
    in_flight: inFlight,
    interval_minutes: loadSettings().interval_minutes,
    last_run_at: lastRunAt,
    next_run_at: nextRunAt,
    task_counts: getSchedulerTaskCounts(),
  }
}

async function refreshOneTask(task: { id: number; task_type: string; target: string; name: string; max_videos: number }): Promise<boolean> {
  // 间隔检查：若 now < next_run_at（未到下次计划触发时间），则不触发爬取。
  // last_run_at 只记录真实爬取时间；跳过时不修改任何时间字段，
  // 下次实际触发时间 = 上次真实爬取时间 + 间隔（由 next_run_at 承载）
  const db = getDb()
  const intervalMs = loadSettings().interval_minutes * 60 * 1000
  const taskRow = db.prepare('SELECT next_run_at FROM monitor_tasks WHERE id = ?').get(task.id) as { next_run_at: number | null } | undefined
  if (taskRow?.next_run_at && Date.now() < taskRow.next_run_at) {
    const gapMin = Math.round((taskRow.next_run_at - Date.now()) / 60000)
    logger.info(`[调度] 跳过任务 ${task.name}(${task.target})：未到下次触发时间，剩余 ${gapMin} 分钟`)
    return false
  }

  const api = new BilibiliAPI(getCookie())
  let lastError: Error | null = null
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (task.task_type === 'up') {
        const videos = await api.getAllUserVideos(Number(task.target), task.max_videos)
        const inputs: VideoSnapshotInput[] = videos.map(v => ({
          mid: task.target,
          bvid: v.bvid,
          title: v.title,
          play: v.play,
          video_review: v.video_review,
          comment: v.comment,
          duration: parseLengthToSeconds(v.length),
          created: v.created,
        }))
        const now = Date.now()
        if (inputs.length > 0) {
          writeUpSnapshot(task.target, inputs, now)
          insertUpHistory(task.target, now)
        }
        // 真实爬取完成：last_run_at=now，下次触发时间=now+间隔
        markTaskRun(task.id, 'ok', null, now + intervalMs)
        logger.info(`[调度] UP任务完成: ${task.name}(${task.target}) ${inputs.length}个视频`)
        return true
      } else {
        const info = await api.getVideoInfo(task.target)
        if (!info) throw new Error('视频不存在或请求失败')
        const now = Date.now()
        writeVideoSnapshot({
          mid: String(info.owner?.mid || ''),
          bvid: info.bvid,
          title: info.title,
          play: info.stat?.view || 0,
          video_review: info.stat?.danmaku || 0,
          comment: info.stat?.reply || 0,
          duration: info.duration || 0,
          created: info.pubdate || 0,
        }, now)
        markTaskRun(task.id, 'ok', null, now + intervalMs)
        logger.info(`[调度] 视频任务完成: ${task.name}(${task.target}) play=${info.stat?.view}`)
        return true
      }
    } catch (e) {
      lastError = e as Error
      if (attempt < MAX_RETRIES) {
        logger.warn(`[调度] 任务重试 ${attempt + 1}/${MAX_RETRIES}: ${task.name}(${task.target})`, lastError.message)
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
      }
    }
  }
  
  // 所有重试都失败
  const msg = lastError?.message || '未知错误'
  markTaskRun(task.id, 'error', msg)
  logger.error(`[调度] 任务失败: ${task.name}(${task.target})`, msg)
  return true
}

async function runAllTasks(): Promise<void> {
  if (inFlight) return
  inFlight = true
  const settings = loadSettings()
  const started = Date.now()
  const db = getDb()
  let anyExecuted = false
  try {
    const tasks = db.prepare('SELECT id, task_type, target, name, max_videos FROM monitor_tasks WHERE enabled = 1').all() as { id: number; task_type: string; target: string; name: string; max_videos: number }[]
    logger.info(`[调度] 开始轮询 ${tasks.length} 个任务`)
    const stats = { ok: 0, error: 0 }
    for (const t of tasks) {
      try {
        const executed = await refreshOneTask(t)
        if (executed) anyExecuted = true
        stats.ok++
      } catch (e) {
        stats.error++
        logger.error(`[调度] 执行异常: ${t.name}`, (e as Error).message)
      }
    }
    lastTaskSummary = stats
    logger.info(`[调度] 轮询完成: 成功${stats.ok} 失败${stats.error}`)
  } catch (e) {
    logger.error('[调度] 轮询异常', (e as Error).message)
  } finally {
    if (anyExecuted) {
      lastRunAt = Date.now()
      nextRunAt = lastRunAt + settings.interval_minutes * 60 * 1000
      saveLastRunAt(lastRunAt)
    }
    inFlight = false
  }
  void started
}

function heartbeat(): void {
  if (running) {
    const settings = loadSettings()
    const due = lastRunAt === null || (Date.now() - lastRunAt) >= settings.interval_minutes * 60 * 1000
    if (due) {
      void runAllTasks()
    }
  }
}

export function startScheduler(): void {
  if (running) return
  running = true
  // 加载上次轮询时间
  lastRunAt = loadLastRunAt()
  if (lastRunAt) {
    const settings = loadSettings()
    nextRunAt = lastRunAt + settings.interval_minutes * 60 * 1000
    logger.info(`[调度] 调度器已启动，上次轮询: ${new Date(lastRunAt).toLocaleString()}`)
  } else {
    logger.info('[调度] 调度器已启动，首次启动立即执行一轮')
  }
  // 首次启动立即跑一轮
  void runAllTasks()
  setInterval(heartbeat, HEARTBEAT_MS)
}

export function stopScheduler(): void {
  running = false
  logger.info('[调度] 调度器已停止')
}

/** 立即刷新单个任务（API 调用） */
export async function refreshTaskNow(id: number): Promise<void> {
  const db = getDb()
  const task = db.prepare('SELECT id, task_type, target, name, max_videos FROM monitor_tasks WHERE id = ?').get(id) as { id: number; task_type: string; target: string; name: string; max_videos: number } | undefined
  if (!task) throw new Error('任务不存在')
  await refreshOneTask(task)
}

/** 立即刷新全部任务（API 调用） */
export async function refreshAllNow(): Promise<{ ok: number; error: number }> {
  if (inFlight) throw new Error('调度器正在执行中，请稍后再试')
  inFlight = true
  const stats = { ok: 0, error: 0 }
  try {
    const db = getDb()
    const tasks = db.prepare('SELECT id, task_type, target, name, max_videos FROM monitor_tasks WHERE enabled = 1').all() as { id: number; task_type: string; target: string; name: string; max_videos: number }[]
    for (const t of tasks) {
      try {
        await refreshOneTask(t)
        stats.ok++
      } catch {
        stats.error++
      }
    }
  } finally {
    inFlight = false
  }
  return stats
}

