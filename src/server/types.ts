// 共享类型定义

export type TaskType = 'up' | 'video' | 'dynamic' | 'column'

export interface MonitorTask {
  id: number
  task_type: TaskType
  target: string      // uid 或 bvid 或 dynamic_id 或 cvid
  name: string
  enabled: number     // 0/1
  max_videos: number  // UP专属：0=全部，N=仅最新N个
  last_run_at: number | null
  last_status: 'never' | 'ok' | 'error'
  error: string | null
  created_at: number
}

export interface VideoRow {
  id: number
  mid: string
  bvid: string
  title: string
  play: number
  video_review: number
  comment: number
  duration: number
  updated_at: number
}

export interface VideoHistoryRow {
  id: number
  bvid: string
  play: number
  video_review: number
  comment: number
  duration: number
  created_at: number
}

export interface UpMetrics {
  mid: string
  total_videos: number
  total_views: number
  total_danmaku: number
  total_comments: number
  avg_play: number
  avg_duration: number
  play_danmaku_comment: string
  max_view_bvid: string
  max_view_title: string
  max_view_play: number
  updated_at: number
}

export interface UpDailyStat {
  id: number
  mid: string
  date: string
  total_views: number
  delta_views: number
  delta_danmaku: number
  delta_comments: number
}

export interface UpMonthlyTrend {
  id: number
  mid: string
  month: string
  views: number
  count: number
  danmaku: number
  comments: number
  avg_play: number
}

export interface UpDurationDist {
  id: number
  mid: string
  label: string
  value: number
}

export interface VideoMetrics {
  bvid: string
  mid: string
  title: string
  first_seen_at: number
  last_seen_at: number
  first_play: number
  last_play: number
  peak_play: number
  avg_play: number
  sample_count: number
}

export interface DynamicRow {
  id: number
  dynamic_id: string
  type: string
  title: string
  author_name: string
  author_id: number
  like_count: number
  reply_count: number
  forward_count: number
  favorite_count: number
  created_time: number
  updated_at: number
}

export interface DynamicHistoryRow {
  id: number
  dynamic_id: string
  like_count: number
  reply_count: number
  forward_count: number
  favorite_count: number
  created_at: number
}

export interface ColumnRow {
  id: number
  cvid: string
  title: string
  author_name: string
  author_id: number
  like_count: number
  reply_count: number
  favorite_count: number
  created_time: number
  updated_at: number
}

export interface ColumnHistoryRow {
  id: number
  cvid: string
  like_count: number
  reply_count: number
  favorite_count: number
  created_at: number
}

export interface AppSettings {
  port: number
  interval_minutes: number
  default_max_videos: number
  cookie_mask: string
  open_browser: boolean
}

export interface SchedulerStatus {
  running: boolean
  in_flight: boolean
  interval_minutes: number
  last_run_at: number | null
  next_run_at: number | null
  task_counts: { total: number; enabled: number }
}
