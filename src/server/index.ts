// BiliDataMonitor 后端入口
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureAppDirs, loadSettings, refreshCookieMask, WEB_DIR } from './config.js'
import { logger, archiveOldLogs } from './logger.js'
import { getDb, cleanupOldData } from './database.js'
import { startScheduler } from './scheduler.js'
import monitorRoutes from './routes/monitor.js'
import upRoutes from './routes/up.js'
import videoRoutes from './routes/video.js'
import systemRoutes from './routes/system.js'
import authRoutes from './routes/auth.js'
import { authMiddleware } from './middleware.js'
import { loadRoot } from './auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function findAvailablePort(preferred: number): Promise<number> {
  const { createServer } = await import('node:net')
  for (let p = preferred; p < preferred + 20; p++) {
    const ok = await new Promise<boolean>(resolve => {
      const srv = createServer()
      srv.once('error', () => resolve(false))
      srv.once('listening', () => srv.close(() => resolve(true)))
      srv.listen(p, '0.0.0.0')
    })
    if (ok) return p
  }
  return preferred
}

async function main(): Promise<void> {
  ensureAppDirs()
  loadRoot()
  archiveOldLogs()
  getDb()
  cleanupOldData(90)

  const settings = loadSettings()
  const port = await findAvailablePort(settings.port)

  const app = Fastify({ logger: false })

  // CORS（前端开发模式使用）
  await app.register(import('@fastify/cors'), { origin: true })

  // Cookie 解析
  await app.register(import('@fastify/cookie'))

  // 认证中间件（所有 /api 请求）
  app.addHook('onRequest', authMiddleware)

  // 认证路由（无需认证）
  app.register(authRoutes, { prefix: '/api/auth' })

  // API 路由
  app.register(monitorRoutes, { prefix: '/api/monitor' })
  app.register(upRoutes, { prefix: '/api/up' })
  app.register(videoRoutes, { prefix: '/api/video' })
  app.register(systemRoutes, { prefix: '/api/system' })

  // 静态托管前端构建产物
  if (WEB_DIR && (await import('node:fs')).existsSync(WEB_DIR)) {
    await app.register(fastifyStatic, {
      root: WEB_DIR,
      prefix: '/',
    })
  } else {
    app.get('/', async () => ({ message: '前端未构建，请运行 pnpm build' }))
  }

  // 启动调度器
  startScheduler()
  refreshCookieMask()

  await app.listen({ port, host: '0.0.0.0' })
  const url = `http://0.0.0.0:${port}`
  logger.info(`服务已启动: ${url}`)
  logger.info(`端口: ${port}（settings.json 可配置，默认 8123）`)
}

main().catch(e => {
  logger.error('启动失败', e)
  process.exit(1)
})
