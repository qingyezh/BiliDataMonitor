// 设置/自启动/shutdown/状态路由
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { loadSettings, saveSettings, refreshCookieMask, ROOT_DIR, getCookie, maskCookie, saveCookie, DB_PATH, DATA_DIR } from '../config.js'
import { getSchedulerStatus } from '../scheduler.js'
import { cleanupOldData, clearAllData } from '../database.js'
import { logger } from '../logger.js'
import { requireRoot } from '../middleware.js'

const SERVICE_NAME = 'bili-monitor'

// --- Windows 自启动常量 ---
const RUN_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const RUN_VALUE = 'BiliDataMonitor'

// --- Linux systemd 常量 ---
const LINUX_SERVICE_DIR = path.join(process.env.HOME || '/tmp', '.config', 'systemd', 'user')
const LINUX_SERVICE_FILE = path.join(LINUX_SERVICE_DIR, `${SERVICE_NAME}.service`)

function autostartVbsPath(): string {
  return path.join(ROOT_DIR, 'scripts', 'autostart.vbs')
}

function isAutostartEnabled(): boolean {
  if (process.platform === 'win32') {
    try {
      const out = execSync(`reg query "HKCU\\${RUN_KEY}" /v ${RUN_VALUE} 2>nul`).toString()
      return out.includes(RUN_VALUE)
    } catch {
      return false
    }
  } else {
    try {
      const out = execSync(`systemctl --user is-enabled ${SERVICE_NAME}.service 2>/dev/null`, { encoding: 'utf-8' }).trim()
      return out === 'enabled'
    } catch {
      return false
    }
  }
}

function enableAutostart(): void {
  if (process.platform === 'win32') {
    const vbs = autostartVbsPath()
    fs.mkdirSync(path.dirname(vbs), { recursive: true })
    const content = `' BiliDataMonitor autostart script
Set s = CreateObject("WScript.Shell")
s.CurrentDirectory = "${ROOT_DIR}"
s.Run "cmd /c scripts\\start.bat", 0, False
`
    fs.writeFileSync(vbs, content, 'latin1')
    const cmd = `wscript.exe "${vbs}"`
    const safe = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    execSync(`reg add "HKCU\\${RUN_KEY}" /v ${RUN_VALUE} /t REG_SZ /d "${safe}" /f`)
  } else {
    fs.mkdirSync(LINUX_SERVICE_DIR, { recursive: true })
    const nodePath = process.execPath
    const serviceContent = `[Unit]
Description=BiliDataMonitor - B站数据监测服务
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT_DIR}
ExecStart=${nodePath} --experimental-sqlite ${path.join(ROOT_DIR, 'src', 'server', 'dist', 'index.js')}
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`
    fs.writeFileSync(LINUX_SERVICE_FILE, serviceContent, 'utf-8')
    try { execSync('sudo loginctl enable-linger $(whoami)', { encoding: 'utf-8' }) } catch { /* ignore */ }
    execSync('systemctl --user daemon-reload', { encoding: 'utf-8' })
    execSync(`systemctl --user enable ${SERVICE_NAME}.service`, { encoding: 'utf-8' })
  }
}

function disableAutostart(): void {
  if (process.platform === 'win32') {
    try {
      execSync(`reg delete "HKCU\\${RUN_KEY}" /v ${RUN_VALUE} /f 2>nul`)
    } catch {
      // 已不存在则忽略
    }
  } else {
    try { execSync(`systemctl --user disable ${SERVICE_NAME}.service 2>/dev/null`, { encoding: 'utf-8' }) } catch { /* ignore */ }
    try { fs.unlinkSync(LINUX_SERVICE_FILE) } catch { /* ignore */ }
    try { execSync('systemctl --user daemon-reload 2>/dev/null', { encoding: 'utf-8' }) } catch { /* ignore */ }
  }
}

export default async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok', service: 'BiliDataMonitor' }))

  app.get('/settings', async () => {
    refreshCookieMask()
    return { success: true, data: loadSettings() }
  })

  app.put<{ Body: { port?: number; interval_minutes?: number; default_max_videos?: number } }>('/settings', { preHandler: [requireRoot] }, async (req) => {
    const body = req.body || {}
    const patch: Partial<{ port: number; interval_minutes: number; default_max_videos: number }> = {}
    if (body.port !== undefined) patch.port = Number(body.port)
    if (body.interval_minutes !== undefined) patch.interval_minutes = Number(body.interval_minutes)
    if (body.default_max_videos !== undefined) patch.default_max_videos = Number(body.default_max_videos)
    const settings = saveSettings(patch)
    refreshCookieMask()
    return { success: true, data: settings, message: '设置已保存（部分需重启生效）' }
  })

  app.get('/scheduler-status', async () => {
    return { success: true, data: getSchedulerStatus() }
  })

  // Cookie 状态（掩码，不泄露真实值）——与 CrawlerAnalysis 相同模式
  app.get('/cookies/status', async () => {
    const cookie = getCookie()
    return {
      success: true,
      data: {
        configured: Boolean(cookie),
        masked: maskCookie(cookie),
      },
    }
  })

  // 保存 Cookie（覆盖）
  app.put('/cookies', { preHandler: [requireRoot] }, async (req, reply) => {
    const body = (req.body || {}) as { cookie?: string }
    if (body.cookie === undefined) {
      return reply.code(400).send({ success: false, message: '缺少 cookie 字段' })
    }
    saveCookie(body.cookie)
    return { success: true, message: 'Cookie 已保存' }
  })

  app.get('/autostart', async () => {
    return { success: true, data: { enabled: isAutostartEnabled() } }
  })

  app.post('/autostart', { preHandler: [requireRoot] }, async () => {
    try {
      enableAutostart()
      return { success: true, message: '已启用开机自启动' }
    } catch (e) {
      return { success: false, message: `启用失败: ${(e as Error).message}` }
    }
  })

  app.delete('/autostart', { preHandler: [requireRoot] }, async () => {
    disableAutostart()
    return { success: true, message: '已关闭开机自启动' }
  })

  app.post('/cleanup', { preHandler: [requireRoot] }, async () => {
    cleanupOldData()
    return { success: true, message: '清理完成' }
  })

  // 一键清除所有采集数据（保留监测任务）
  app.post('/clear-all', { preHandler: [requireRoot] }, async () => {
    const result = clearAllData()
    return { success: true, message: '数据已清除', data: result }
  })

  app.post('/shutdown', { preHandler: [requireRoot] }, async (_req, reply) => {
    logger.info('收到退出请求，服务即将停止')
    reply.send({ success: true, message: '服务即将退出' })
    setTimeout(() => {
      process.exit(0)
    }, 300)
  })

  // 备份数据库
  app.post('/backup', { preHandler: [requireRoot] }, async () => {
    try {
      const backupDir = path.join(DATA_DIR, 'backup')
      fs.mkdirSync(backupDir, { recursive: true })
      const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
      const backupPath = path.join(backupDir, `monitor_backup_${timestamp}.db`)
      fs.copyFileSync(DB_PATH, backupPath)
      logger.info(`数据库已备份: ${backupPath}`)
      return { success: true, message: `备份成功: ${path.basename(backupPath)}` }
    } catch (e) {
      const msg = `备份失败: ${(e as Error).message}`
      logger.error(msg)
      return { success: false, message: msg }
    }
  })
}
