// 格式化工具

export function formatTimestamp(ts: number | string | null | undefined): string {
  if (!ts) return ''
  let date: Date
  if (typeof ts === 'string') {
    const iso = ts.includes('Z') || ts.includes('+') ? ts : ts + 'Z'
    date = new Date(iso)
  } else {
    date = new Date(ts)
  }
  if (isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}

export function formatDate(ts: number | string | null | undefined): string {
  if (!ts) return ''
  return formatTimestamp(ts).split(' ')[0]
}

/**
 * 智能时间序列标签（UTC+8，显示到秒）：
 * 同年月日的点：第一个显示「M/D HH:mm:ss」，后续同天的只显示「HH:mm:ss」
 * 跨天或首个点：显示完整「YYYY/M/D HH:mm:ss」
 */
export function formatSmartTimestamps(timestamps: (number | string)[]): string[] {
  const labels: string[] = []
  let lastDateKey = ''
  for (const ts of timestamps) {
    const date = new Date(ts)
    if (isNaN(date.getTime())) {
      labels.push('')
      continue
    }
    const d = date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const dateKey = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
    const time = date.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    if (dateKey === lastDateKey) {
      // 同一天：只显示时分秒（去掉 24:00:00 前缀问题，保留 HH:mm:ss）
      labels.push(time.length >= 8 ? time.slice(0, 8) : time)
    } else {
      labels.push(`${d} ${time.length >= 8 ? time.slice(0, 8) : time}`)
      lastDateKey = dateKey
    }
  }
  return labels
}

export function formatNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '0'
  if (n >= 100000000) return (n / 100000000).toFixed(2) + '亿'
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatHours(seconds: number | null | undefined): string {
  if (!seconds) return '0'
  return (seconds / 3600).toFixed(2)
}

export function formatRecordDuration(firstSeenAt: number | null | undefined): string {
  if (!firstSeenAt) return '--'
  const diffMs = Date.now() - firstSeenAt
  if (diffMs < 0) return '--'
  const days = Math.floor(diffMs / 86400000)
  const hours = Math.floor((diffMs % 86400000) / 3600000)
  const minutes = Math.floor((diffMs % 3600000) / 60000)
  return `${days} d ${hours} h ${minutes} min`
}

export function truncateText(text: string, maxLen = 50): string {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text
}

export function statusLabel(s: string): { text: string; type: 'success' | 'info' | 'danger' | 'warning' } {
  switch (s) {
    case 'ok': return { text: '正常', type: 'success' }
    case 'error': return { text: '异常', type: 'danger' }
    default: return { text: '未运行', type: 'info' }
  }
}
