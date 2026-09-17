#!/usr/bin/env node
// BiliDataMonitor 实例守护：发现多开时保留锁文件中的主进程，终止其余
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCK = path.join(ROOT, 'app', 'data', 'bili-monitor.lock')
const LOG = path.join(ROOT, 'app', 'logs', 'instance-guard.log')
const ENTRY = 'src/server/dist/index.js'

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    fs.appendFileSync(LOG, line)
  } catch { /* ignore */ }
  process.stdout.write(line)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function readLockPid() {
  try {
    const raw = JSON.parse(fs.readFileSync(LOCK, 'utf-8'))
    const pid = Number(raw?.pid)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function listCandidates() {
  const found = []
  if (process.platform === 'linux') {
    let names = []
    try {
      names = fs.readdirSync('/proc')
    } catch {
      return found
    }
    for (const name of names) {
      if (!/^\d+$/.test(name)) continue
      try {
        const cmd = fs.readFileSync(`/proc/${name}/cmdline`, 'utf-8').replace(/\0/g, ' ').trim()
        if (!cmd.includes('node')) continue
        if (!cmd.includes(ENTRY)) continue
        found.push({ pid: Number(name), cmd })
      } catch { /* race: process exited */ }
    }
    return found
  }
  if (process.platform === 'win32') {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"],
      { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 }
    )
    if (r.status !== 0 || !r.stdout) return found
    try {
      let data = JSON.parse(r.stdout.trim())
      if (!Array.isArray(data)) data = [data]
      for (const item of data) {
        const cmd = String(item?.CommandLine || '')
        if (cmd.includes(ENTRY.replace(/\//g, '\\')) || cmd.includes(ENTRY)) {
          found.push({ pid: Number(item.ProcessId), cmd })
        }
      }
    } catch { /* ignore parse error */ }
  }
  return found
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal)
    return true
  } catch {
    return false
  }
}

async function main() {
  const cands = listCandidates()
  if (cands.length <= 1) {
    log(`ok instances=${cands.length}`)
    return 0
  }
  const lockPid = readLockPid()
  const keep = lockPid && cands.some((c) => c.pid === lockPid) ? lockPid : cands[0].pid
  log(`multi instances=${cands.length} keep=${keep} lockPid=${lockPid}`)
  for (const c of cands) {
    if (c.pid === keep) continue
    log(`SIGTERM pid=${c.pid} cmd=${c.cmd.slice(0, 160)}`)
    killPid(c.pid, 'SIGTERM')
  }
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    await sleep(300)
    const still = listCandidates().filter((c) => c.pid !== keep)
    if (still.length === 0) break
  }
  for (const c of listCandidates()) {
    if (c.pid === keep) continue
    log(`SIGKILL pid=${c.pid}`)
    killPid(c.pid, 'SIGKILL')
  }
  const left = listCandidates().filter((c) => c.pid !== keep)
  log(`done left=${left.length}`)
  return left.length === 0 ? 0 : 1
}

main().then((code) => process.exit(code))
