// API 封装（axios + 响应拦截器解包 + unwrap）
import axios from 'axios'

function getApiKey(): string {
  return localStorage.getItem('api_key') || ''
}

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
})

// 请求拦截器：自动注入 API Key
api.interceptors.request.use(config => {
  config.headers['X-API-Key'] = getApiKey()
  return config
})

// 响应拦截器：将 axios 响应解包为后端响应体 { success, data }
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      window.location.href = '#/login'
    }
    const message = error.response?.data?.detail || error.message || '请求失败'
    console.error('API Error:', message)
    return Promise.reject(error)
  }
)

function unwrap<T>(res: any): T {
  return (res?.data !== undefined) ? res.data : res
}

// ── 类型 ──
export interface MonitorTask {
  id: number
  task_type: 'up' | 'video' | 'dynamic' | 'column'
  target: string
  name: string
  enabled: number
  max_videos: number
  last_run_at: number | null
  last_status: 'never' | 'ok' | 'error'
  error: string | null
  created_at: number
  summary?: any
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
  date: string
  total_views: number
  delta_views: number
  delta_danmaku: number
  delta_comments: number
}

export interface UpMonthlyTrend {
  month: string
  views: number
  count: number
  danmaku: number
  comments: number
  avg_play: number
}

export interface UpDurationDist {
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

export interface VideoHistoryPoint {
  bvid: string
  play: number
  video_review: number
  comment: number
  duration: number
  page_count: number
  created_at: number
}

export interface AppSettings {
  port: number
  interval_minutes: number
  default_max_videos: number
  cookie_mask: string
  open_browser: boolean
}

export interface UpAnalysis {
  metrics: UpMetrics
  monthly_trend: UpMonthlyTrend[]
  duration_dist: UpDurationDist[]
  history: any[]
}

export interface VideoDetail {
  metrics: VideoMetrics | null
  realtime: { play: number; danmaku: number; reply: number; page_count: number } | null
}

export interface UpVideoPage {
  items: any[]
  total: number
  page: number
  page_size: number
}

export interface SchedulerStatus {
  running: boolean
  in_flight: boolean
  interval_minutes: number
  last_run_at: number | null
  next_run_at: number | null
  task_counts: { total: number; enabled: number }
}

export const monitorApi = {
  // 任务
  listTasks: () => api.get('/monitor/tasks').then(r => unwrap<MonitorTask[]>(r)),
  createTask: (payload: { task_type: string; target: string; max_videos?: number }) =>
    api.post('/monitor/tasks', payload).then(r => unwrap<MonitorTask>(r)),
  updateTask: (id: number, payload: Partial<{ name: string; enabled: number; max_videos: number }>) =>
    api.put(`/monitor/tasks/${id}`, payload).then(r => unwrap<MonitorTask>(r)),
  deleteTask: (id: number) => api.delete(`/monitor/tasks/${id}`).then(r => unwrap<any>(r)),
  refreshTask: (id: number) => api.post(`/monitor/tasks/${id}/refresh`).then(r => unwrap<any>(r)),
  refreshAll: () => api.post('/monitor/refresh-all').then(r => unwrap<{ ok: number; error: number }>(r)),

  // UP
  upStatus: (mid: string) => api.get(`/up/${mid}/status`).then(r => unwrap<UpMetrics>(r)),
  upVideos: (mid: string, params?: any) => api.get(`/up/${mid}/videos`, { params }).then(r => unwrap<UpVideoPage>(r)),
  upAnalysis: (mid: string) => api.get(`/up/${mid}/analysis`).then(r => unwrap<UpAnalysis>(r)),
  upHistory: (mid: string) => api.get(`/up/${mid}/history`).then(r => unwrap<UpDailyStat[]>(r)),
  upVideoHistory: (mid: string, bvid: string) => api.get(`/up/${mid}/video-history/${bvid}`).then(r => unwrap<VideoHistoryPoint[]>(r)),

  // 视频
  videoDetail: (bvid: string) => api.get(`/video/${bvid}/detail`).then(r => unwrap<VideoDetail>(r)),
  videoHistory: (bvid: string) => api.get(`/video/${bvid}/history`).then(r => unwrap<VideoHistoryPoint[]>(r)),

  // 动态
  dynamicDetail: (id: string) => api.get(`/dynamic/${id}/detail`).then(r => unwrap<any>(r)),
  dynamicHistory: (id: string) => api.get(`/dynamic/${id}/history`).then(r => unwrap<any[]>(r)),

  // 专栏
  columnDetail: (cvid: string) => api.get(`/column/${cvid}/detail`).then(r => unwrap<any>(r)),
  columnHistory: (cvid: string) => api.get(`/column/${cvid}/history`).then(r => unwrap<any[]>(r)),

  // 系统
  settings: () => api.get('/system/settings').then(r => unwrap<AppSettings>(r)),
  saveSettings: (payload: Partial<AppSettings>) => api.put('/system/settings', payload).then(r => unwrap<any>(r)),
  schedulerStatus: () => api.get('/system/scheduler-status').then(r => unwrap<SchedulerStatus>(r)),
  autostart: () => api.get('/system/autostart').then(r => unwrap<{ enabled: boolean }>(r)),
  enableAutostart: () => api.post('/system/autostart').then(r => unwrap<any>(r)),
  disableAutostart: () => api.delete('/system/autostart').then(r => unwrap<any>(r)),
  health: () => api.get('/system/health').then(r => unwrap<any>(r)),
  // Cookie（掩码模式，同 CrawlerAnalysis）
  cookieStatus: () => api.get('/system/cookies/status').then(r => unwrap<{ configured: boolean; masked: string }>(r)),
  saveCookie: (cookie: string) => api.put('/system/cookies', { cookie }).then(r => unwrap<any>(r)),
  // 一键清除数据（保留任务）
  clearAllData: () => api.post('/system/clear-all').then(r => unwrap<any>(r)),
  // 备份数据库
  backupDatabase: () => api.post('/system/backup').then(r => unwrap<any>(r)),

  // 认证
  login: (username: string, password: string) => api.post('/auth/login', { username, password }).then(r => unwrap<{ role: string; apiKey: string }>(r)),
  checkAuth: () => api.get('/auth/check').then(r => unwrap<{ loggedIn: boolean; role?: string; username?: string }>(r)),
  logout: () => api.post('/auth/logout').then(r => unwrap<any>(r)),
  changePassword: (oldPassword: string, newPassword: string) => api.put('/auth/password', { oldPassword, newPassword }).then(r => unwrap<any>(r)),
  getUsers: () => api.get('/auth/users').then(r => unwrap<{ username: string; locked: boolean; lockedAt?: number }[]>(r)),
  addUser: (username: string, password: string) => api.post('/auth/users', { username, password }).then(r => unwrap<any>(r)),
  removeUser: (username: string) => api.delete(`/auth/users/${username}`).then(r => unwrap<any>(r)),
  unlockUser: (username: string) => api.post(`/auth/users/${username}/unlock`).then(r => unwrap<any>(r)),
}
