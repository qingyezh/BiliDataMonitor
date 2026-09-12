// SQLite 封装（node:sqlite 零原生依赖）：建表/CRUD/快照/缓存重算
import fs from 'node:fs'
import { SqliteDB } from './sqlite.js'
import { DB_PATH } from './config.js'
import { logger } from './logger.js'
import type {
  MonitorTask, VideoRow, VideoHistoryRow, UpMetrics, TaskType,
  UpDailyStat, UpMonthlyTrend, UpDurationDist, VideoMetrics,
} from './types.js'

let db: SqliteDB | null = null

export function getDb(): SqliteDB {
  if (db) return db
  fs.mkdirSync(DB_PATH.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
  db = new SqliteDB(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

const DURATION_BUCKETS: [number, string][] = [
  [0, '1分钟以内'],
  [60, '1-3分钟'],
  [180, '3-5分钟'],
  [300, '5-10分钟'],
  [600, '10-30分钟'],
  [1800, '30-60分钟'],
  [3600, '60-120分钟'],
  [7200, '2-3小时'],
  [10800, '3-4小时'],
  [14400, '4小时以上'],
]

function migrate(d: SqliteDB): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS monitor_tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type   TEXT NOT NULL CHECK(task_type IN ('up','video','dynamic','column')),
      target      TEXT NOT NULL,
      name        TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      max_videos  INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER,
      next_run_at INTEGER,
      last_status TEXT NOT NULL DEFAULT 'never',
      error       TEXT,
      created_at  INTEGER NOT NULL,
      UNIQUE(task_type, target)
    );

    CREATE TABLE IF NOT EXISTS videos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      mid          TEXT NOT NULL,
      bvid         TEXT NOT NULL,
      title        TEXT NOT NULL DEFAULT '',
      play         INTEGER NOT NULL DEFAULT 0,
      video_review INTEGER NOT NULL DEFAULT 0,
      comment      INTEGER NOT NULL DEFAULT 0,
      duration     INTEGER NOT NULL DEFAULT 0,
      created      INTEGER NOT NULL DEFAULT 0,
      updated_at   INTEGER NOT NULL,
      UNIQUE(bvid)
    );
    CREATE INDEX IF NOT EXISTS idx_videos_mid ON videos(mid);
    CREATE INDEX IF NOT EXISTS idx_videos_play ON videos(play DESC);

    CREATE TABLE IF NOT EXISTS video_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      bvid         TEXT NOT NULL,
      play         INTEGER NOT NULL DEFAULT 0,
      video_review INTEGER NOT NULL DEFAULT 0,
      comment      INTEGER NOT NULL DEFAULT 0,
      duration     INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hist_bvid_ts ON video_history(bvid, created_at);
    CREATE INDEX IF NOT EXISTS idx_hist_created ON video_history(created_at);

    CREATE TABLE IF NOT EXISTS up_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      mid           TEXT NOT NULL,
      total_videos  INTEGER NOT NULL DEFAULT 0,
      total_views   INTEGER NOT NULL DEFAULT 0,
      total_danmaku INTEGER NOT NULL DEFAULT 0,
      total_comments INTEGER NOT NULL DEFAULT 0,
      avg_duration  INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_up_mid_ts ON up_history(mid, created_at);

    CREATE TABLE IF NOT EXISTS up_metrics (
      mid            TEXT PRIMARY KEY,
      total_videos   INTEGER NOT NULL DEFAULT 0,
      total_views    INTEGER NOT NULL DEFAULT 0,
      total_danmaku  INTEGER NOT NULL DEFAULT 0,
      total_comments INTEGER NOT NULL DEFAULT 0,
      avg_play       INTEGER NOT NULL DEFAULT 0,
      avg_duration   INTEGER NOT NULL DEFAULT 0,
      play_danmaku_comment TEXT NOT NULL DEFAULT '',
      max_view_bvid  TEXT NOT NULL DEFAULT '',
      max_view_title TEXT NOT NULL DEFAULT '',
      max_view_play  INTEGER NOT NULL DEFAULT 0,
      updated_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS up_daily_stats (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      mid           TEXT NOT NULL,
      date          TEXT NOT NULL,
      total_views   INTEGER NOT NULL DEFAULT 0,
      delta_views   INTEGER NOT NULL DEFAULT 0,
      delta_danmaku INTEGER NOT NULL DEFAULT 0,
      delta_comments INTEGER NOT NULL DEFAULT 0,
      UNIQUE(mid, date)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_mid_date ON up_daily_stats(mid, date);

    CREATE TABLE IF NOT EXISTS up_monthly_trend (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      mid      TEXT NOT NULL,
      month    TEXT NOT NULL,
      views    INTEGER NOT NULL DEFAULT 0,
      count    INTEGER NOT NULL DEFAULT 0,
      danmaku  INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      avg_play INTEGER NOT NULL DEFAULT 0,
      UNIQUE(mid, month)
    );
    CREATE INDEX IF NOT EXISTS idx_month_mid ON up_monthly_trend(mid, month);

    CREATE TABLE IF NOT EXISTS up_duration_dist (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      mid   TEXT NOT NULL,
      label TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      UNIQUE(mid, label)
    );

    CREATE TABLE IF NOT EXISTS video_metrics (
      bvid          TEXT PRIMARY KEY,
      mid           TEXT NOT NULL,
      title         TEXT NOT NULL DEFAULT '',
      first_seen_at INTEGER NOT NULL,
      last_seen_at  INTEGER NOT NULL,
      first_play    INTEGER NOT NULL DEFAULT 0,
      last_play     INTEGER NOT NULL DEFAULT 0,
      peak_play     INTEGER NOT NULL DEFAULT 0,
      avg_play      INTEGER NOT NULL DEFAULT 0,
      sample_count  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dynamics (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      dynamic_id    TEXT NOT NULL,
      type          TEXT NOT NULL DEFAULT 'dynamic',
      title         TEXT NOT NULL DEFAULT '',
      author_name   TEXT NOT NULL DEFAULT '',
      author_id     INTEGER NOT NULL DEFAULT 0,
      like_count    INTEGER NOT NULL DEFAULT 0,
      reply_count   INTEGER NOT NULL DEFAULT 0,
      forward_count INTEGER NOT NULL DEFAULT 0,
      favorite_count INTEGER NOT NULL DEFAULT 0,
      created_time  INTEGER NOT NULL DEFAULT 0,
      updated_at    INTEGER NOT NULL,
      UNIQUE(dynamic_id)
    );
    CREATE INDEX IF NOT EXISTS idx_dynamics_updated ON dynamics(updated_at);

    CREATE TABLE IF NOT EXISTS dynamic_history (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      dynamic_id     TEXT NOT NULL,
      like_count     INTEGER NOT NULL DEFAULT 0,
      reply_count    INTEGER NOT NULL DEFAULT 0,
      forward_count  INTEGER NOT NULL DEFAULT 0,
      favorite_count INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dyn_hist_ts ON dynamic_history(dynamic_id, created_at);

    CREATE TABLE IF NOT EXISTS columns (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      cvid           TEXT NOT NULL,
      title          TEXT NOT NULL DEFAULT '',
      author_name    TEXT NOT NULL DEFAULT '',
      author_id      INTEGER NOT NULL DEFAULT 0,
      like_count     INTEGER NOT NULL DEFAULT 0,
      reply_count    INTEGER NOT NULL DEFAULT 0,
      favorite_count INTEGER NOT NULL DEFAULT 0,
      created_time   INTEGER NOT NULL DEFAULT 0,
      updated_at     INTEGER NOT NULL,
      UNIQUE(cvid)
    );
    CREATE INDEX IF NOT EXISTS idx_columns_updated ON columns(updated_at);

    CREATE TABLE IF NOT EXISTS column_history (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      cvid           TEXT NOT NULL,
      like_count     INTEGER NOT NULL DEFAULT 0,
      reply_count    INTEGER NOT NULL DEFAULT 0,
      favorite_count INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_col_hist_ts ON column_history(cvid, created_at);
  `)

  // 迁移：videos 表补充 created（视频发布时间）列
  const cols = d.prepare('PRAGMA table_info(videos)').all() as { name: string }[]
  if (!cols.some(c => c.name === 'created')) {
    d.exec('ALTER TABLE videos ADD COLUMN created INTEGER NOT NULL DEFAULT 0')
  }

  // 迁移：videos / video_history 补充 page_count（分P数，仅单视频任务写入）
  if (!cols.some(c => c.name === 'page_count')) {
    d.exec('ALTER TABLE videos ADD COLUMN page_count INTEGER NOT NULL DEFAULT 1')
  }
  const vhistCols = d.prepare('PRAGMA table_info(video_history)').all() as { name: string }[]
  if (!vhistCols.some(c => c.name === 'page_count')) {
    d.exec('ALTER TABLE video_history ADD COLUMN page_count INTEGER NOT NULL DEFAULT 1')
  }

  // 迁移：monitor_tasks 补充 next_run_at（下次计划触发时间）列
  const tcols = d.prepare('PRAGMA table_info(monitor_tasks)').all() as { name: string }[]
  if (!tcols.some(c => c.name === 'next_run_at')) {
    d.exec('ALTER TABLE monitor_tasks ADD COLUMN next_run_at INTEGER')
  }
}

// ── 任务 CRUD ──────────────────────────────────────────────

export function listTasks(): (MonitorTask & { summary?: unknown })[] {
  const d = getDb()
  const tasks = d.prepare('SELECT * FROM monitor_tasks ORDER BY id DESC').all() as MonitorTask[]
  return tasks.map(t => {
    let summary: unknown
    if (t.task_type === 'up') {
      summary = d.prepare('SELECT * FROM up_metrics WHERE mid = ?').get(t.target)
    } else if (t.task_type === 'video') {
      summary = d.prepare('SELECT * FROM video_metrics WHERE bvid = ?').get(t.target)
    } else if (t.task_type === 'dynamic') {
      summary = d.prepare('SELECT * FROM dynamics WHERE dynamic_id = ?').get(t.target)
    } else if (t.task_type === 'column') {
      summary = d.prepare('SELECT * FROM columns WHERE cvid = ?').get(t.target)
    }
    return { ...t, summary: summary || undefined }
  })
}

export function getTask(id: number): MonitorTask | undefined {
  return getDb().prepare('SELECT * FROM monitor_tasks WHERE id = ?').get(id) as MonitorTask | undefined
}

export function getTaskByTarget(type: TaskType, target: string): MonitorTask | undefined {
  return getDb().prepare('SELECT * FROM monitor_tasks WHERE task_type = ? AND target = ?').get(type, target) as MonitorTask | undefined
}

export function createTask(t: Omit<MonitorTask, 'id' | 'created_at' | 'last_run_at' | 'last_status' | 'error'>): MonitorTask {
  const d = getDb()
  const created_at = Date.now()
  const info = d.prepare(`
    INSERT INTO monitor_tasks (task_type, target, name, enabled, max_videos, created_at)
    VALUES (@task_type, @target, @name, @enabled, @max_videos, @created_at)
  `).run({ ...t, created_at })
  return d.prepare('SELECT * FROM monitor_tasks WHERE id = ?').get(info.lastInsertRowid) as MonitorTask
}

export function updateTask(id: number, patch: Partial<Pick<MonitorTask, 'name' | 'enabled' | 'max_videos'>>): MonitorTask | undefined {
  const d = getDb()
  const existing = getTask(id)
  if (!existing) return undefined
  d.prepare(`
    UPDATE monitor_tasks SET
      name = COALESCE(@name, name),
      enabled = COALESCE(@enabled, enabled),
      max_videos = COALESCE(@max_videos, max_videos)
    WHERE id = @id
  `).run({ id, name: patch.name ?? null, enabled: patch.enabled ?? null, max_videos: patch.max_videos ?? null })
  return getTask(id)
}

export function deleteTask(id: number): void {
  const d = getDb()
  const task = getTask(id)
  if (!task) return
  const del = d.transaction(() => {
    if (task.task_type === 'up') {
      const mids = d.prepare('SELECT mid FROM videos WHERE mid = ?').all(task.target) as { mid: string }[]
      const bvids = d.prepare('SELECT bvid FROM videos WHERE mid = ?').all(task.target) as { bvid: string }[]
      for (const b of bvids) {
        d.prepare('DELETE FROM video_history WHERE bvid = ?').run(b.bvid)
        d.prepare('DELETE FROM video_metrics WHERE bvid = ?').run(b.bvid)
      }
      d.prepare('DELETE FROM videos WHERE mid = ?').run(task.target)
      d.prepare('DELETE FROM up_history WHERE mid = ?').run(task.target)
      d.prepare('DELETE FROM up_metrics WHERE mid = ?').run(task.target)
      d.prepare('DELETE FROM up_daily_stats WHERE mid = ?').run(task.target)
      d.prepare('DELETE FROM up_monthly_trend WHERE mid = ?').run(task.target)
      d.prepare('DELETE FROM up_duration_dist WHERE mid = ?').run(task.target)
      void mids
    } else {
      d.prepare('DELETE FROM video_history WHERE bvid = ?').run(task.target)
      d.prepare('DELETE FROM video_metrics WHERE bvid = ?').run(task.target)
      d.prepare('DELETE FROM videos WHERE bvid = ?').run(task.target)
    }
    d.prepare('DELETE FROM monitor_tasks WHERE id = ?').run(id)
  })
  del()
}

export function markTaskRun(id: number, status: 'ok' | 'error', error: string | null = null, nextRunAt: number | null = null): void {
  getDb().prepare(`
    UPDATE monitor_tasks SET last_run_at = ?, last_status = ?, error = ?, next_run_at = COALESCE(?, next_run_at)
    WHERE id = ?
  `).run(Date.now(), status, error, nextRunAt, id)
}

// ── 快照写入（单任务事务） ──────────────────────────────────

export interface VideoSnapshotInput {
  mid: string
  bvid: string
  title: string
  play: number
  video_review: number
  comment: number
  duration: number
  created: number   // 视频发布时间戳（秒）
  page_count?: number // 分P数；仅 video 任务传入，UP 任务不写
}

/**
 * 写入一批视频快照（UP 任务）：
 * 1. 对比 videos 当前值，四项指标变化 → 插入 video_history（page_count 沿用已有值，不采集）
 * 2. upsert videos（不覆盖 page_count）
 * 3. 重算缓存表（up_metrics/up_daily_stats/up_duration_dist/up_monthly_trend/video_metrics）
 * 整体一个事务
 */
export function writeUpSnapshot(mid: string, inputs: VideoSnapshotInput[], now = Date.now()): { inserted: number; changed: number } {
  const d = getDb()
  const tx = d.transaction(() => {
    const sel = d.prepare('SELECT * FROM videos WHERE bvid = ?')
    const upsert = d.prepare(`
      INSERT INTO videos (mid, bvid, title, play, video_review, comment, duration, created, updated_at)
      VALUES (@mid, @bvid, @title, @play, @video_review, @comment, @duration, @created, @updated_at)
      ON CONFLICT(bvid) DO UPDATE SET
        mid = excluded.mid,
        title = excluded.title,
        play = excluded.play,
        video_review = excluded.video_review,
        comment = excluded.comment,
        duration = excluded.duration,
        created = excluded.created,
        updated_at = excluded.updated_at
    `)
    const insHist = d.prepare(`
      INSERT INTO video_history (bvid, play, video_review, comment, duration, page_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const selLastHist = d.prepare(
      'SELECT play, video_review, comment, duration, page_count, created_at FROM video_history WHERE bvid = ? ORDER BY created_at DESC LIMIT 1'
    )

    let changed = 0
    for (const v of inputs) {
      const existing = sel.get(v.bvid) as VideoRow | undefined
      const pageCount = existing?.page_count ?? 1
      const isChanged = !existing ||
        existing.play !== v.play ||
        existing.video_review !== v.video_review ||
        existing.comment !== v.comment ||
        existing.duration !== v.duration
      if (isChanged) {
        const lastHist = selLastHist.get(v.bvid) as { play: number; video_review: number; comment: number; duration: number; page_count: number; created_at: number } | undefined
        const tooClose = lastHist && (now - lastHist.created_at < 60_000) &&
          lastHist.play === v.play && lastHist.video_review === v.video_review &&
          lastHist.comment === v.comment && lastHist.duration === v.duration
        if (!tooClose) {
          insHist.run(v.bvid, v.play, v.video_review, v.comment, v.duration, pageCount, now)
          changed++
        }
      }
      const { page_count: _skipPage, ...upsertRow } = v
      upsert.run({ ...upsertRow, updated_at: now })
    }

    recomputeUpCaches(mid, now)
    return { inserted: inputs.length, changed }
  })
  return tx()
}

/** 写入单视频快照（video 任务，含分P数） */
export function writeVideoSnapshot(input: VideoSnapshotInput, now = Date.now()): { changed: boolean } {
  const d = getDb()
  const pageCount = Math.max(1, input.page_count ?? 1)
  const tx = d.transaction(() => {
    const existing = d.prepare('SELECT * FROM videos WHERE bvid = ?').get(input.bvid) as VideoRow | undefined
    const isChanged = !existing ||
      existing.play !== input.play ||
      existing.video_review !== input.video_review ||
      existing.comment !== input.comment ||
      existing.duration !== input.duration ||
      existing.page_count !== pageCount
    if (isChanged) {
      const lastHist = d.prepare(
        'SELECT play, video_review, comment, duration, page_count, created_at FROM video_history WHERE bvid = ? ORDER BY created_at DESC LIMIT 1'
      ).get(input.bvid) as { play: number; video_review: number; comment: number; duration: number; page_count: number; created_at: number } | undefined
      const tooClose = lastHist && (now - lastHist.created_at < 60_000) &&
        lastHist.play === input.play && lastHist.video_review === input.video_review &&
        lastHist.comment === input.comment && lastHist.duration === input.duration &&
        lastHist.page_count === pageCount
      if (!tooClose) {
        d.prepare('INSERT INTO video_history (bvid, play, video_review, comment, duration, page_count, created_at) VALUES (?,?,?,?,?,?,?)')
          .run(input.bvid, input.play, input.video_review, input.comment, input.duration, pageCount, now)
      }
    }
    d.prepare(`
      INSERT INTO videos (mid, bvid, title, play, video_review, comment, duration, created, page_count, updated_at)
      VALUES (@mid, @bvid, @title, @play, @video_review, @comment, @duration, @created, @page_count, @updated_at)
      ON CONFLICT(bvid) DO UPDATE SET
        mid = excluded.mid, title = excluded.title, play = excluded.play,
        video_review = excluded.video_review, comment = excluded.comment,
        duration = excluded.duration, created = excluded.created,
        page_count = excluded.page_count,
        updated_at = excluded.updated_at
    `).run({ ...input, page_count: pageCount, updated_at: now })
    recomputeVideoMetrics(input.bvid, now)
    return { changed: isChanged }
  })
  return tx()
}

/** 写入动态快照 */
export function writeDynamicSnapshot(dynamicId: string, info: {
  type: string; title: string; author_name: string; author_id: number;
  like: number; reply: number; forward: number; favorite: number;
  created_time: number;
}, now = Date.now()): { changed: boolean } {
  const d = getDb()
  const tx = d.transaction(() => {
    const existing = d.prepare('SELECT * FROM dynamics WHERE dynamic_id = ?').get(dynamicId) as {
      like_count: number; reply_count: number; forward_count: number; favorite_count: number;
    } | undefined
    const isChanged = !existing ||
      existing.like_count !== info.like ||
      existing.reply_count !== info.reply ||
      existing.forward_count !== info.forward ||
      existing.favorite_count !== info.favorite
    if (isChanged) {
      const lastHist = d.prepare(
        'SELECT like_count, reply_count, forward_count, favorite_count, created_at FROM dynamic_history WHERE dynamic_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(dynamicId) as { like_count: number; reply_count: number; forward_count: number; favorite_count: number; created_at: number } | undefined
      const tooClose = lastHist && (now - lastHist.created_at < 60_000) &&
        lastHist.like_count === info.like && lastHist.reply_count === info.reply &&
        lastHist.forward_count === info.forward && lastHist.favorite_count === info.favorite
      if (!tooClose) {
        d.prepare('INSERT INTO dynamic_history (dynamic_id, like_count, reply_count, forward_count, favorite_count, created_at) VALUES (?,?,?,?,?,?)')
          .run(dynamicId, info.like, info.reply, info.forward, info.favorite, now)
      }
    }
    d.prepare(`
      INSERT INTO dynamics (dynamic_id, type, title, author_name, author_id, like_count, reply_count, forward_count, favorite_count, created_time, updated_at)
      VALUES (@dynamic_id, @type, @title, @author_name, @author_id, @like_count, @reply_count, @forward_count, @favorite_count, @created_time, @updated_at)
      ON CONFLICT(dynamic_id) DO UPDATE SET
        type = excluded.type, title = excluded.title, author_name = excluded.author_name,
        author_id = excluded.author_id, like_count = excluded.like_count, reply_count = excluded.reply_count,
        forward_count = excluded.forward_count, favorite_count = excluded.favorite_count,
        created_time = excluded.created_time, updated_at = excluded.updated_at
    `).run({
      dynamic_id: dynamicId, type: info.type, title: info.title,
      author_name: info.author_name, author_id: info.author_id,
      like_count: info.like, reply_count: info.reply,
      forward_count: info.forward, favorite_count: info.favorite,
      created_time: info.created_time, updated_at: now,
    })
    return { changed: isChanged }
  })
  return tx()
}

/** 写入专栏快照 */
export function writeColumnSnapshot(cvid: string, info: {
  title: string; author_name: string; author_id: number;
  like: number; reply: number; favorite: number;
  created_time: number;
}, now = Date.now()): { changed: boolean } {
  const d = getDb()
  const tx = d.transaction(() => {
    const existing = d.prepare('SELECT * FROM columns WHERE cvid = ?').get(cvid) as {
      like_count: number; reply_count: number; favorite_count: number;
    } | undefined
    const isChanged = !existing ||
      existing.like_count !== info.like ||
      existing.reply_count !== info.reply ||
      existing.favorite_count !== info.favorite
    if (isChanged) {
      const lastHist = d.prepare(
        'SELECT like_count, reply_count, favorite_count, created_at FROM column_history WHERE cvid = ? ORDER BY created_at DESC LIMIT 1'
      ).get(cvid) as { like_count: number; reply_count: number; favorite_count: number; created_at: number } | undefined
      const tooClose = lastHist && (now - lastHist.created_at < 60_000) &&
        lastHist.like_count === info.like && lastHist.reply_count === info.reply &&
        lastHist.favorite_count === info.favorite
      if (!tooClose) {
        d.prepare('INSERT INTO column_history (cvid, like_count, reply_count, favorite_count, created_at) VALUES (?,?,?,?,?)')
          .run(cvid, info.like, info.reply, info.favorite, now)
      }
    }
    d.prepare(`
      INSERT INTO columns (cvid, title, author_name, author_id, like_count, reply_count, favorite_count, created_time, updated_at)
      VALUES (@cvid, @title, @author_name, @author_id, @like_count, @reply_count, @favorite_count, @created_time, @updated_at)
      ON CONFLICT(cvid) DO UPDATE SET
        title = excluded.title, author_name = excluded.author_name, author_id = excluded.author_id,
        like_count = excluded.like_count, reply_count = excluded.reply_count,
        favorite_count = excluded.favorite_count, created_time = excluded.created_time,
        updated_at = excluded.updated_at
    `).run({
      cvid, title: info.title, author_name: info.author_name, author_id: info.author_id,
      like_count: info.like, reply_count: info.reply, favorite_count: info.favorite,
      created_time: info.created_time, updated_at: now,
    })
    return { changed: isChanged }
  })
  return tx()
}

// ── 缓存重算 ────────────────────────────────────────────────

export function recomputeUpCaches(mid: string, now: number): void {
  const d = getDb()

  // up_metrics
  const agg = d.prepare(`
    SELECT
      COUNT(*) as total_videos,
      COALESCE(SUM(play),0) as total_views,
      COALESCE(SUM(video_review),0) as total_danmaku,
      COALESCE(SUM(comment),0) as total_comments,
      COALESCE(AVG(play),0) as avg_play,
      COALESCE(AVG(duration),0) as avg_duration
    FROM videos WHERE mid = ?
  `).get(mid) as { total_videos: number; total_views: number; total_danmaku: number; total_comments: number; avg_play: number; avg_duration: number }

  const top = d.prepare('SELECT bvid, title, play FROM videos WHERE mid = ? ORDER BY play DESC LIMIT 1').get(mid) as { bvid: string; title: string; play: number } | undefined

  const ratio = agg.total_comments > 0
    ? `${(agg.total_views / agg.total_comments).toFixed(1)} : ${(agg.total_danmaku / agg.total_comments).toFixed(1)} : 1`
    : '--'

  d.prepare(`
    INSERT INTO up_metrics (mid, total_videos, total_views, total_danmaku, total_comments, avg_play, avg_duration, play_danmaku_comment, max_view_bvid, max_view_title, max_view_play, updated_at)
    VALUES (@mid, @total_videos, @total_views, @total_danmaku, @total_comments, @avg_play, @avg_duration, @ratio, @max_view_bvid, @max_view_title, @max_view_play, @now)
    ON CONFLICT(mid) DO UPDATE SET
      total_videos = excluded.total_videos, total_views = excluded.total_views,
      total_danmaku = excluded.total_danmaku, total_comments = excluded.total_comments,
      avg_play = excluded.avg_play, avg_duration = excluded.avg_duration,
      play_danmaku_comment = excluded.play_danmaku_comment,
      max_view_bvid = excluded.max_view_bvid, max_view_title = excluded.max_view_title,
      max_view_play = excluded.max_view_play, updated_at = excluded.updated_at
  `).run({
    mid, now,
    total_videos: agg.total_videos, total_views: agg.total_views,
    total_danmaku: agg.total_danmaku, total_comments: agg.total_comments,
    avg_play: Math.round(agg.avg_play), avg_duration: Math.round(agg.avg_duration),
    ratio, max_view_bvid: top?.bvid || '', max_view_title: top?.title || '', max_view_play: top?.play || 0,
  })

  // up_daily_stats（delta 相对上一轮 up_history 的聚合值）
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayStartMs = todayStart.getTime()
  const prev = d.prepare('SELECT total_views, total_danmaku, total_comments FROM up_history WHERE mid = ? AND created_at < ? ORDER BY created_at DESC LIMIT 1')
    .get(mid, todayStartMs) as { total_views: number; total_danmaku: number; total_comments: number } | undefined
  const dateStr = new Date(now).toISOString().slice(0, 10)
  d.prepare(`
    INSERT INTO up_daily_stats (mid, date, total_views, delta_views, delta_danmaku, delta_comments)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(mid, date) DO UPDATE SET
      total_views = excluded.total_views,
      delta_views = excluded.delta_views,
      delta_danmaku = excluded.delta_danmaku,
      delta_comments = excluded.delta_comments
  `).run(
    mid, dateStr,
    agg.total_views,
    prev ? agg.total_views - prev.total_views : 0,
    prev ? agg.total_danmaku - prev.total_danmaku : 0,
    prev ? agg.total_comments - prev.total_comments : 0,
  )

  // up_duration_dist
  const distRows = d.prepare('SELECT duration FROM videos WHERE mid = ?').all(mid) as { duration: number }[]
  const counts = new Map<string, number>()
  for (const r of distRows) {
    let label = '4小时以上'
    for (let i = DURATION_BUCKETS.length - 1; i >= 0; i--) {
      if (r.duration >= DURATION_BUCKETS[i][0]) { label = DURATION_BUCKETS[i][1]; break }
    }
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  d.prepare('DELETE FROM up_duration_dist WHERE mid = ?').run(mid)
  const insDist = d.prepare('INSERT INTO up_duration_dist (mid, label, value) VALUES (?, ?, ?)')
  for (const [label, value] of counts) insDist.run(mid, label, value)

  // up_monthly_trend（从 video_history 归月）
  recomputeMonthlyTrend(mid)

  // 受影响视频的 video_metrics
  const bvids = d.prepare('SELECT bvid FROM videos WHERE mid = ?').all(mid) as { bvid: string }[]
  for (const b of bvids) recomputeVideoMetrics(b.bvid, now)
}

function recomputeMonthlyTrend(mid: string): void {
  const d = getDb()
  const bvids = d.prepare('SELECT bvid FROM videos WHERE mid = ?').all(mid) as { bvid: string }[]
  const months = new Map<string, { views: number; count: number; danmaku: number; comments: number }>()
  for (const b of bvids) {
    const rows = d.prepare('SELECT created_at FROM video_history WHERE bvid = ? ORDER BY created_at ASC').all(b.bvid) as { created_at: number }[]
    for (const r of rows) {
      const month = new Date(r.created_at).toISOString().slice(0, 7)
      const cur = months.get(month) || { views: 0, count: 0, danmaku: 0, comments: 0 }
      cur.count++
      months.set(month, cur)
    }
    // 用 video_history 每行再取一次值？简化：仅按月计数，值从每月的最近一次快照累加
  }
  d.prepare('DELETE FROM up_monthly_trend WHERE mid = ?').run(mid)
  const ins = d.prepare('INSERT INTO up_monthly_trend (mid, month, views, count, danmaku, comments, avg_play) VALUES (?,?,?,?,?,?,?)')
  for (const [month, cur] of months) {
    ins.run(mid, month, cur.views, cur.count, cur.danmaku, cur.comments, cur.count ? Math.round(cur.views / cur.count) : 0)
  }
}

function recomputeVideoMetrics(bvid: string, now: number): void {
  const d = getDb()
  const video = d.prepare('SELECT mid, title FROM videos WHERE bvid = ?').get(bvid) as { mid: string; title: string } | undefined
  if (!video) return
  const hist = d.prepare('SELECT play, created_at FROM video_history WHERE bvid = ? ORDER BY created_at ASC').all(bvid) as { play: number; created_at: number }[]
  if (hist.length === 0) {
    d.prepare(`
      INSERT INTO video_metrics (bvid, mid, title, first_seen_at, last_seen_at, first_play, last_play, peak_play, avg_play, sample_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bvid) DO UPDATE SET mid=excluded.mid, title=excluded.title, last_seen_at=excluded.last_seen_at,
        last_play=excluded.last_play, sample_count=excluded.sample_count
    `).run(bvid, video.mid, video.title, now, now, 0, 0, 0, 0, 0)
    return
  }
  const first = hist[0]
  const last = hist[hist.length - 1]
  const peak = Math.max(...hist.map(h => h.play))
  const avg = Math.round(hist.reduce((s, h) => s + h.play, 0) / hist.length)
  d.prepare(`
    INSERT INTO video_metrics (bvid, mid, title, first_seen_at, last_seen_at, first_play, last_play, peak_play, avg_play, sample_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bvid) DO UPDATE SET
      mid=excluded.mid, title=excluded.title,
      first_seen_at=excluded.first_seen_at, last_seen_at=excluded.last_seen_at,
      first_play=excluded.first_play, last_play=excluded.last_play,
      peak_play=excluded.peak_play, avg_play=excluded.avg_play, sample_count=excluded.sample_count
  `).run(bvid, video.mid, video.title, first.created_at, last.created_at, first.play, last.play, peak, avg, hist.length)
}

// ── 查询 ───────────────────────────────────────────────────

export function getUpMetrics(mid: string): UpMetrics | undefined {
  return getDb().prepare('SELECT * FROM up_metrics WHERE mid = ?').get(mid) as UpMetrics | undefined
}

export function listVideosByMid(mid: string, opts: { sort?: string; order?: string; keyword?: string; limit?: number; offset?: number } = {}): VideoRow[] {
  const d = getDb()
  const sortCol = ['play', 'created', 'comment', 'video_review'].includes(opts.sort || '') ? opts.sort : 'play'
  const order = opts.order === 'asc' ? 'ASC' : 'DESC'
  let sql = 'SELECT * FROM videos WHERE mid = ?'
  const params: unknown[] = [mid]
  if (opts.keyword) {
    sql += ' AND title LIKE ?'
    params.push(`%${opts.keyword}%`)
  }
  sql += ` ORDER BY ${sortCol} ${order}`
  sql += ' LIMIT ? OFFSET ?'
  params.push(opts.limit ?? 50, opts.offset ?? 0)
  return d.prepare(sql).all(...params) as VideoRow[]
}

export function countVideosByMid(mid: string, keyword?: string): number {
  const d = getDb()
  if (keyword) {
    return (d.prepare('SELECT COUNT(*) as c FROM videos WHERE mid = ? AND title LIKE ?').get(mid, `%${keyword}%`) as { c: number }).c
  }
  return (d.prepare('SELECT COUNT(*) as c FROM videos WHERE mid = ?').get(mid) as { c: number }).c
}

export function listVideoHistory(bvid: string, limit?: number, offset?: number): VideoHistoryRow[] {
  let sql = 'SELECT * FROM video_history WHERE bvid = ? ORDER BY created_at ASC'
  const params: (string | number)[] = [bvid]
  if (limit !== undefined) {
    sql += ' LIMIT ?'
    params.push(limit)
  }
  if (offset !== undefined) {
    sql += ' OFFSET ?'
    params.push(offset)
  }
  return getDb().prepare(sql).all(...params) as VideoHistoryRow[]
}

export function listUpDailyStats(mid: string): UpDailyStat[] {
  return getDb().prepare('SELECT * FROM up_daily_stats WHERE mid = ? ORDER BY date ASC').all(mid) as UpDailyStat[]
}

export function listUpMonthlyTrend(mid: string): UpMonthlyTrend[] {
  return getDb().prepare('SELECT * FROM up_monthly_trend WHERE mid = ? ORDER BY month ASC').all(mid) as UpMonthlyTrend[]
}

export function listUpDurationDist(mid: string): UpDurationDist[] {
  return getDb().prepare('SELECT * FROM up_duration_dist WHERE mid = ? ORDER BY id ASC').all(mid) as UpDurationDist[]
}

export function listUpHistory(mid: string): { created_at: number; total_views: number; total_videos: number; total_danmaku: number; total_comments: number; avg_duration: number }[] {
  return getDb().prepare('SELECT created_at, total_views, total_videos, total_danmaku, total_comments, avg_duration FROM up_history WHERE mid = ? ORDER BY created_at ASC').all(mid) as { created_at: number; total_views: number; total_videos: number; total_danmaku: number; total_comments: number; avg_duration: number }[]
}

export function getVideoMetrics(bvid: string): VideoMetrics | undefined {
  return getDb().prepare('SELECT * FROM video_metrics WHERE bvid = ?').get(bvid) as VideoMetrics | undefined
}

/** 插入 UP 聚合历史（每次轮询完成后一行）
 * 防过密刷新：若距上一条记录 < 240s 且指标全等（服务重启/连续触发产生），则跳过 */
export function insertUpHistory(mid: string, now = Date.now()): void {
  const m = getUpMetrics(mid)
  if (!m) return
  const d = getDb()
  const last = d.prepare(
    'SELECT total_videos, total_views, total_danmaku, total_comments, avg_duration, created_at FROM up_history WHERE mid = ? ORDER BY created_at DESC LIMIT 1'
  ).get(mid) as { total_videos: number; total_views: number; total_danmaku: number; total_comments: number; avg_duration: number; created_at: number } | undefined

  const sameValues = last &&
    last.total_videos === m.total_videos &&
    last.total_views === m.total_views &&
    last.total_danmaku === m.total_danmaku &&
    last.total_comments === m.total_comments &&
    last.avg_duration === m.avg_duration

  // 240 秒内且指标未变 → 视为重启/连续触发产生的过密记录，跳过
  if (sameValues && now - last.created_at < 240_000) {
    return
  }

  d.prepare(`
    INSERT INTO up_history (mid, total_videos, total_views, total_danmaku, total_comments, avg_duration, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(mid, m.total_videos, m.total_views, m.total_danmaku, m.total_comments, m.avg_duration, now)
}

/** 清理过期历史（保留 90 天） */
export function cleanupOldData(days = 90): void {
  const cutoff = Date.now() - days * 24 * 3600 * 1000
  const d = getDb()
  const r1 = d.prepare('DELETE FROM video_history WHERE created_at < ?').run(cutoff)
  const r2 = d.prepare('DELETE FROM up_history WHERE created_at < ?').run(cutoff)
  logger.info('数据清理完成', { video_history: r1.changes, up_history: r2.changes })
}

/** 一键清除所有采集数据（保留监测任务配置） */
export function clearAllData(): { tables: Record<string, number> } {
  const d = getDb()
  const tx = d.transaction(() => {
    const result: Record<string, number> = {}
    const tables = [
      'video_history',
      'up_history',
      'up_metrics',
      'up_daily_stats',
      'up_monthly_trend',
      'up_duration_dist',
      'video_metrics',
      'videos',
    ]
    for (const t of tables) {
      result[t] = Number(d.prepare(`DELETE FROM ${t}`).run().changes)
    }
    return result
  })
  const result = tx()
  logger.info('一键清除数据完成', result)
  return { tables: result }
}

export function getSchedulerTaskCounts(): { total: number; enabled: number } {
  const d = getDb()
  const total = (d.prepare('SELECT COUNT(*) as c FROM monitor_tasks').get() as { c: number }).c
  const enabled = (d.prepare('SELECT COUNT(*) as c FROM monitor_tasks WHERE enabled = 1').get() as { c: number }).c
  return { total, enabled }
}
