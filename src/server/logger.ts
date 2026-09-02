// 轻量日志（控制台 + 轮转文件 app/logs/）
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { LOGS_DIR } from './config.js'

type Level = 'info' | 'warn' | 'error'

let currentDate = ''
let stream: fs.WriteStream | null = null

function getStream(): fs.WriteStream {
  const d = new Date()
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (dateStr !== currentDate || !stream) {
    if (stream) stream.end()
    if (currentDate && currentDate !== dateStr) archiveOldLogs()
    currentDate = dateStr
    fs.mkdirSync(LOGS_DIR, { recursive: true })
    stream = fs.createWriteStream(path.join(LOGS_DIR, `monitor-${dateStr}.log`), { flags: 'a' })
  }
  return stream
}

export async function archiveOldLogs(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const archiveDir = path.join(LOGS_DIR, 'archive')
  let files: string[]
  try {
    files = fs.readdirSync(LOGS_DIR)
  } catch { return }

  const oldLogs = files.filter(f => f.startsWith('monitor-') && f.endsWith('.log') && !f.includes(today))
  if (oldLogs.length === 0) return

  fs.mkdirSync(archiveDir, { recursive: true })
  for (const f of oldLogs) {
    const src = path.join(LOGS_DIR, f)
    const dest = path.join(archiveDir, f + '.gz')
    try {
      await pipeline(fs.createReadStream(src), zlib.createGzip(), fs.createWriteStream(dest))
      fs.unlinkSync(src)
    } catch { /* 跳过失败的文件 */ }
  }
}

function write(level: Level, msg: string, meta?: unknown): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const line = meta !== undefined
    ? `[${ts}] [${level.toUpperCase()}] ${msg} ${JSON.stringify(meta)}`
    : `[${ts}] [${level.toUpperCase()}] ${msg}`
  console.log(line)
  try {
    getStream().write(line + '\n')
  } catch {
    // 日志失败不影响主流程
  }
}

export const logger = {
  info: (msg: string, meta?: unknown) => write('info', msg, meta),
  warn: (msg: string, meta?: unknown) => write('warn', msg, meta),
  error: (msg: string, meta?: unknown) => write('error', msg, meta),
}
