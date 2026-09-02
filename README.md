# BiliDataMonitor

> **B站账号与视频数据变化监测工具** — 监控 UP主及单个视频的播放/弹幕/评论数据变化趋势

## 功能特性

- **双维度监测**：
  - UP主维度：输入 UID 监测其全部视频（可限定只监测最新 N 个）
  - 视频维度：输入 BV 号独立监测单个视频
- **间隔轮询**：系统启动后每 5 分钟 ~ 24 小时（可调）自动刷新数据，动态生效无需重启
- **数据追踪**：记录每次轮询的数据快照，提供趋势图（播放/弹幕/评论双轴）
- **派生指标缓存**：总播放/平均播放/每日增量/月度趋势/时长分布等后端预计算，前端零计算
- **系统集成**：Windows 开机自启动 + 系统托盘（打开页面/立即刷新/退出）
- **低负载**：纯 TypeScript（Node.js）后端 + Vue3 前端 + Rust 托盘，零 Python 依赖

## 技术栈

| 部分 | 技术 |
|------|------|
| 后端 | Node.js + TypeScript（Fastify + node:sqlite + axios + 自实现 WBI 签名） |
| 前端 | Vue3 + TypeScript + Element Plus + ECharts |
| 托盘 | Rust（tray-icon） |
| 数据库 | SQLite（node:sqlite 内置，零原生依赖） |

## 目录结构

```
BiliDataMonitor/
├── src/
│   ├── server/          # Node.js 后端源码
│   │   ├── index.ts     # 入口（Fastify + 静态托管 + 浏览器自动打开）
│   │   ├── config.ts    # 设置读写
│   │   ├── database.ts  # SQLite 封装（建表/快照/缓存重算）
│   │   ├── scheduler.ts # 间隔轮询调度器
│   │   ├── crawler/     # B站爬虫（axios + WBI 签名 + key 缓存）
│   │   └── routes/      # monitor/up/video/system 路由
│   ├── tray/            # Rust 托盘源码
│   └── frontend/        # Vue3 前端源码
│       └── src/views/   # MonitorList / Detail / Settings
├── app/                 # 运行产物
│   ├── web/             # 前端构建产物
│   ├── config/          # cookie_config.json / settings.json
│   ├── data/            # monitor.db
│   ├── logs/            # 日志
│   └── tray.exe         # Rust 托盘
└── scripts/             # start.bat / stop.bat
```

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置 Cookie（B站账号，必须）
#    编辑 app/config/cookie_config.json：
#    { "bilibili": "SESSDATA=xxx; bili_jct=xxx" }

# 3. 构建前端（输出到 app/web）
cd src/frontend && pnpm build && cd ../..

# 4. 编译后端
cd src/server && pnpm build && cd ../..

# 5. 启动（Windows）
scripts\start.bat
# 或手动启动
node --experimental-sqlite src/server/dist/index.js
```

启动后自动打开浏览器：**http://127.0.0.1:8123**

## 使用说明

1. **新增任务**：列表页 →「新增任务」→ 选择类型（UP主/视频）→ 输入 UID/BV 号 → 可设「最新 N 个视频」
2. **立即刷新**：任务行「刷新」按钮或列表页「立即刷新全部」
3. **查看详情**：点击任务名称进入详情页（概览卡片 + 趋势图 + 排行）
4. **轮询间隔**：设置页调整（5分钟~24小时），即时生效
5. **开机自启动**：设置页开启；**Cookie 管理**：设置页覆盖保存（掩码显示）
6. **系统托盘**：打开页面 / 立即刷新 / 退出

## 数据存储

| 表 | 说明 |
|----|------|
| monitor_tasks | 监测任务（UP主/视频） |
| videos | 每个视频当前最新值（upsert） |
| video_history | 快照历史（指标变化时记录，趋势数据源） |
| up_history | UP 聚合历史 |
| up_metrics / up_daily_stats / up_monthly_trend / up_duration_dist | 派生指标缓存 |
| video_metrics | 单视频聚合缓存 |

- 快照去重：四项指标（播放/弹幕/评论/时长）全等则跳过，避免刷屏
- 自动清理：历史保留 90 天

## 端口约定

- 默认端口 **8123**（非常用端口），仅监听 127.0.0.1
- 可改 `app/config/settings.json` 的 `port` 字段

## 常见问题

**Q: 无法获取数据 / 显示"未登录"？**
> Cookie 无效或过期。请在设置页「Cookie 管理」中覆盖保存新的 B站 Cookie。

**Q: 服务启动后浏览器没打开？**
> 手动访问 http://127.0.0.1:8123

**Q: 修改端口后前端无法访问？**
> 修改 settings.json 的 port 后重启服务，前端用相对路径自动适配。
