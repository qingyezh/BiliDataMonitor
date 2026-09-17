// 单实例 PID 锁：防止多开共用 SQLite
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './config.js'

const LOCK_PATH = path.join(DATA_DIR, 'bili-monitor.lock')

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLockPid(): number | null {
  try {
    const raw = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf-8'))
    const pid = Number(raw?.pid)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function releaseOwnLock(): void {
  try {
    if (readLockPid() === process.pid) fs.unlinkSync(LOCK_PATH)
  } catch {
    /* ignore */
  }
}

/**
 * 获取单实例锁。已有存活实例时返回 false 并给出对方 pid。
 * 残留死锁会自动清理。
 */
export function acquireSingleInstanceLock(): { ok: true } | { ok: false; existingPid: number } {
  fs.mkdirSync(DATA_DIR, { recursive: true })

  if (fs.existsSync(LOCK_PATH)) {
    const pid = readLockPid()
    if (pid && pid !== process.pid && isProcessAlive(pid)) {
      return { ok: false, existingPid: pid }
    }
    try {
      fs.unlinkSync(LOCK_PATH)
    } catch {
      /* ignore */
    }
  }

  try {
    const fd = fs.openSync(LOCK_PATH, 'wx')
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }, null, 2))
    fs.closeSync(fd)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'EEXIST') {
      return { ok: false, existingPid: readLockPid() ?? 0 }
    }
    throw e
  }

  process.on('exit', releaseOwnLock)
  return { ok: true }
}

/** 配置端口必须可用；单实例禁止自动换端口 */
export async function assertPortAvailable(port: number): Promise<void> {
  const { createServer } = await import('node:net')
  await new Promise<void>((resolve, reject) => {
    const srv = createServer()
    srv.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${port} 已被占用（可能存在另一实例）。单实例模式禁止自动换端口启动。`))
        return
      }
      reject(err)
    })
    srv.once('listening', () => srv.close(() => resolve()))
    srv.listen(port, '0.0.0.0')
  })
}
