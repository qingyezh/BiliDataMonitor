# BiliDataMonitor-linux

> **B站账号与视频数据变化监测工具（Linux 服务器版）** — 监控 UP主及单个视频的播放/弹幕/评论数据变化趋势

## 功能特性

- **双维度监测**：
  - UP主维度：输入 UID 监测其全部视频（可限定只监测最新 N 个）
  - 视频维度：输入 BV 号独立监测单个视频
- **间隔轮询**：每 5 分钟 ~ 24 小时（可调）自动刷新数据，动态生效无需重启
- **数据追踪**：记录每次轮询的数据快照，提供趋势图（播放/弹幕/评论双轴）
- **派生指标缓存**：总播放/平均播放/每日增量/月度趋势/时长分布等后端预计算，前端零计算
- **爬虫重试**：单次爬取失败自动重试 2 次，间隔 2 秒，提高成功率
- **系统集成**：Linux systemd 自启动 + nginx 反向代理 + 一键部署脚本
- **低负载**：纯 TypeScript（Node.js）后端 + Vue3 前端，零 Python 依赖

## 技术栈

| 部分 | 技术 |
|------|------|
| 后端 | Node.js 22 + TypeScript（Fastify + node:sqlite + axios + 自实现 WBI 签名） |
| 前端 | Vue3 + TypeScript + Element Plus + ECharts + KaTeX |
| 数据库 | SQLite（node:sqlite 内置，需 --experimental-sqlite 标志） |

## 目录结构

```
BiliDataMonitor-linux/
├── src/
│   ├── server/              # Node.js 后端源码
│   │   ├── index.ts         # 入口（Fastify + 静态托管）
│   │   ├── config.ts        # 设置读写
│   │   ├── database.ts      # SQLite 封装（建表/快照/缓存重算）
│   │   ├── scheduler.ts     # 间隔轮询调度器（含重试机制）
│   │   ├── auth.ts          # 认证（密码哈希/API Key/风控锁定）
│   │   ├── crawler/         # B站爬虫（axios + WBI 签名 + key 缓存）
│   │   └── routes/          # monitor/up/video/system/auth 路由
│   └── frontend/            # Vue3 前端源码
│       └── src/views/       # MonitorList / Detail / Settings / Login
├── app/                     # 运行产物
│   ├── web/                 # 前端构建产物
│   ├── config/              # cookie_config.json / settings.json / auth.json
│   ├── data/                # monitor.db / last_run_at.json
│   └── logs/                # 日志（自动轮转 + gzip 归档）
├── scripts/                 # 部署脚本
│   ├── deploy.sh            # 一键部署（Node.js + systemd + nginx）
│   ├── start.sh             # 启动脚本
│   ├── stop.sh              # 停止脚本
│   └── setup-nginx.sh       # nginx 配置脚本
└── nginx/
    └── bili-monitor.conf    # nginx 配置模板
```

## 快速开始

### 方式一：一键部署（推荐）

```bash
# 克隆仓库
git clone -b linux-server https://github.com/qingyezh/BiliDataMonitor.git
cd BiliDataMonitor

# 一键部署（安装 Node.js + pnpm + 构建 + systemd + nginx）
sudo bash scripts/deploy.sh your-domain.com
```

### 方式二：手动部署

```bash
# 1. 安装依赖
pnpm install
pnpm approve-builds esbuild

# 2. 配置 Cookie（B站账号，必须）
#    编辑 app/config/cookie_config.json：
#    { "bilibili": "SESSDATA=xxx; bili_jct=xxx" }

# 3. 构建项目
pnpm build

# 4. 编译后端
cd src/server && npx tsc -p tsconfig.json && cd ../..

# 5. 启动服务
node --experimental-sqlite src/server/dist/index.js
```

### 方式三：systemd 服务管理

```bash
# 启动服务
sudo systemctl start bili-monitor

# 停止服务
sudo systemctl stop bili-monitor

# 查看状态
sudo systemctl status bili-monitor

# 查看日志
sudo journalctl -u bili-monitor -f

# 开机自启动
sudo systemctl enable bili-monitor
```

## 默认账号

- **用户名**: `qingyeqy`
- **密码**: `qingye@120177`

> ⚠️ 首次登录后请立即修改密码

## 使用说明

1. **新增任务**：列表页 →「新增任务」→ 选择类型（UP主/视频）→ 输入 UID/BV 号 → 可设「最新 N 个视频」
2. **立即刷新**：任务行「刷新」按钮或列表页「立即刷新全部」
3. **查看详情**：点击任务名称进入详情页（概览卡片 + 趋势图 + 排行）
4. **轮询间隔**：设置页调整（5分钟~24小时），即时生效
5. **开机自启动**：设置页开启；**Cookie 管理**：设置页覆盖保存（掩码显示）
6. **数据导出**：图表支持 CSV/PNG 导出

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
- 分页支持：视频历史接口支持 `limit` 和 `offset` 参数

## 端口约定

- 默认端口 **8123**（可在 settings.json 修改）
- 监听 `0.0.0.0`（支持远程访问）
- nginx 反向代理默认配置在 `/etc/nginx/sites-available/bili-monitor`

## 常见问题

**Q: 无法获取数据 / 显示"未登录"？**
> Cookie 无效或过期。请在设置页「Cookie 管理」中覆盖保存新的 B站 Cookie。

**Q: 服务启动失败？**
> 检查日志：`sudo journalctl -u bili-monitor -n 50`

**Q: 端口被占用？**
> 修改 `app/config/settings.json` 的 `port` 字段，服务会自动寻找可用端口。

**Q: 忘记密码？**
> 删除 `app/config/auth.json` 文件，重启服务后使用默认账号登录。

**Q: 如何备份数据？**
> 备份 `app/data/` 目录下的 `monitor.db` 文件。

## GitHub 仓库

https://github.com/qingyezh/BiliDataMonitor.git

分支：`linux-server`
