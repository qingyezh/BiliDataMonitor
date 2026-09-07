# BiliDataMonitor 项目规则

## 项目概述
- B站账号与视频数据变化监测工具（UP主 + 单视频 + 动态 + 专栏 多维度）
- 技术栈：Node.js + TypeScript（后端）/ Vue3 + TS（前端）
- 零 Python 依赖；数据库用 node:sqlite（Node 22 内置，需 --experimental-sqlite 标志）
- 项目根目录：`D:\Desktop\program\preoject\BiliDataMonitor-linux`（Linux 适配版）

## 全局规则

- 始终使用简体中文回复
- 所有源码在 `src/`（server 后端 / crawler 爬虫 / frontend 前端）
- 运行产物在 `app/`（web 构建产物 / config / data / logs）
- 每次改变文件进行语法检查（pnpm build），确保 0 error
- 版本号记录在 version.md（v0.x.x.x 格式）
- 后端启动必须：`node --experimental-sqlite src/server/dist/index.js`
- 前端构建输出到 `app/web`（vite outDir）

## Git 规则

- **禁止提交到 git 的文件**（敏感/临时/大文件）：
  - `app/config/auth.json` — 含 API 密钥
  - `app/config/cookie_config.json` — 含 B站 Cookie
  - `app/config/settings.json` — 各服务器运行时配置不同
  - `app/data/` — 数据库文件
  - `app/logs/` — 日志文件
  - `*.zip` — 大文件
  - `.mimocode/` — 本地工具文件
  - `migrate.cjs` — 临时迁移脚本
  - `node_modules/`、`dist/`、`.env`
- **保留提交的构建产物**：`app/web/` 前端构建产物（服务器资源有限无法编译前端）
- 新增敏感文件时必须同步更新 `.gitignore`

## 关键架构约定

- **监测任务**：monitor_tasks 表，type = up（UID）/ video（BV）/ dynamic（动态ID）/ column（专栏CV号）
- **存储**：
  - videos / video_history — 视频数据
  - dynamics / dynamic_history — 动态数据（点赞/评论/转发）
  - columns / column_history — 专栏数据（点赞/评论/收藏）
- **派生指标缓存**：up_metrics / up_daily_stats / up_monthly_trend / up_duration_dist / video_metrics，轮询后重算，前端 API 直读零计算
- **调度器**：setInterval 心跳读 settings.json 间隔（5~1440 分钟），动态生效
- **爬虫**：axios + WBI 签名（key 缓存 TTL 12h）；getUserVideos 返回 data.list.vlist 结构
- **动态爬取**：新版API `/x/polymer/web-dynamic/v1/detail` 优先，旧版 fallback；modules 兼容 list/dict 两种格式
- **Cookie**：app/config/cookie_config.json 的 bilibili 字段；掩码格式前4+***+后4
- **端口**：8123，监听 0.0.0.0
- **系统集成**：Linux systemd 自启动 + nginx 反向代理
- 后台任务必须记录异常（add_done_callback / try-catch + logger）

## 已实现功能

### 图表增强（LineChart.vue + Detail.vue）
- **CSV/PNG 导出**：图表右下角按钮，CSV 使用 UTF-8 BOM
- **时间范围筛选**：日期时间选择器精确到分钟，纯前端过滤
- **不等间距对数刻度**：公式 `(lg(y+1))^3`，使用 `(v+1)` 偏移避免 v=0 时 log10 为负
- **对数模式左右轴独立控制**：使用 `&&` 逻辑（logMode && leftAxisLog），图表需 dispose 后重建
- **趋势线**：7 次多项式拟合（降级逻辑：<8 点用 5 次，<6 点用 3 次，<4 点跳过）
- **趋势线公式显示**：使用 KaTeX 渲染，系数采用科学计数法
- **图例**：自定义 HTML 图例（原始系列）+ ECharts 图例（趋势线），两行布局
- **增量模式**：原始值/增量切换，负值红点标记
- **数据标签**：各曲线独立控制开关
- 以上功能适用于 UP/视频/动态/专栏 四种类型

### 列表页（MonitorList.vue）
- **5 分钟静默刷新**：setInterval 定时刷新，页面离开时 clearInterval
- **目标列截断**：超过16字符的ID截断显示，hover显示完整值
- **多类型支持**：UP主/视频/动态/专栏，各有独立标签颜色和指标摘要

### 重要注意事项
- **图表图例必须使用自定义 HTML**：ECharts 原生图例在 grid 区域内会被 canvas 拦截事件
- **对数模式切换需 dispose 图表**：setOption 不会重新应用 yAxis type 变化
- **趋势线默认关闭**：图例中 trend 系列默认 `selected: false`
- **动态 created_time 是秒级时间戳**：前端显示需乘 1000
- **动态 modules 兼容 list/dict**：API 可能返回两种格式，需统一处理
- **数据库 CHECK 约束迁移**：SQLite 不支持 ALTER CHECK，需建新表迁移

## 待办事项

- （暂无）
