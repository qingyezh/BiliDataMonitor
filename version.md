# 版本记录

## v0.2.0.6 (2026-09-17)

- fix: 曲线空白/不刷新
  - 趋势线配置变更不再 dispose 图表（原先内联数组每次渲染触发重建导致空白）
  - Detail 使用稳定 `TREND_LINE_SERIES` 引用
  - LineChart 增加 ResizeObserver，数据更新后 resize

## v0.2.0.5 (2026-09-17)

- feat: 图表左下角相邻点间隔选择
  - 对数开关左侧增加选择框：5分钟 / 1小时 / 6小时 / 24小时
  - 增量模式下相邻快照时间差超过「所选间隔×1.5」时该点断线（null）
  - 默认按轮询间隔设置映射到最近档位；四类详情图表共用

## v0.2.0.4 (2026-09-17)

- feat: 单实例防护
  - 启动获取 `app/data/bili-monitor.lock` PID 锁，已有存活实例则拒绝启动
  - 端口被占直接失败，不再自动顺延端口（避免双实例共用 SQLite）
  - 新增 `scripts/instance-guard.mjs`：扫描多余实例并终止（保留锁内 PID）
  - start.sh / stop.sh 接入守护与锁清理

## v0.2.0.3 (2026-09-17)

- chore: 隐藏曲线图删除功能常驻文字提示
  - 移除 LineChart 图下「悬停…按 L」提示条及样式
  - 移除 Detail 四类图表脚注中的 L 键说明
  - 交互与二次确认逻辑不变；文档补充删除 API 与实现约定

## v0.2.0.2 (2026-09-08)

- feat: 曲线图异常数据点删除
  - 悬停数据点后按 `L` 锁定该点，弹出二次确认框后删除整条历史快照
  - 支持 UP / 视频 / 动态 / 专栏 四类详情图表；原始值与增量模式均可
  - 后端 `DELETE /api/monitor/history/:kind/:id`（root），删除后视频自动重算 `video_metrics`
  - 数据库与曲线同步刷新；确认框展示时间与指标摘要

## v0.2.0.1 (2026-08-31)

- feat: 图表均值曲线
  - LineChart 新增 `showAvgLine`，对可见系列画水平均值虚线（markLine）
  - 对数模式先在原始值求均值再映射坐标；原始值/增量/下降模式均可用
  - UP/视频/动态/专栏详情页右上角增加「均值」开关（默认关闭，在「标签」前）
- feat: 概览区近24小时增量
  - 末点 − 距「末点−24h」最近的快照
  - UP/视频：播放/弹幕/评论；动态/专栏：点赞/评论/转发或收藏
  - 正增量绿、负增量红；历史不足24h 标注「不足24h」；无数据显示 `--`

## v0.2.0.0 (2026-08-31)

- feat: Linux (Ubuntu 24) 适配
  - Rust 托盘：libayatana-appindicator 替代 winapi，curl 替代 powershell，xdg-open 替代 cmd
  - 自启动：systemd user service 替代 Windows 注册表 + VBS
  - 启停脚本：Shell 脚本替代 BAT 批处理
  - 前端：自启动文字改为中性"开机自启动"
  - 后端：浏览器打开支持 xdg-open (Linux) / open (macOS) / start (Windows)

## v0.1.1.0 (2026-08-18)

- feat: 日志压缩归档功能
  - 使用 zlib 压缩旧日志为 .gz 格式
  - 启动时 + 跨天自动触发归档
  - 归档到 app/logs/archive/ 目录
- feat: Esc 键自动返回上一页
  - 全局 keydown 监听，排除输入框和弹窗
- feat: 图表数据点默认限制
  - 默认显示最新 200 个数据点防止卡顿
  - 手动选择日期范围时显示全部数据
- fix: 数据库损坏恢复
  - 从备份数据库恢复数据
  - 从 video_history 重建 mid=1340190821 的 up_history
  - 重建所有派生缓存表
- chore: 清理临时文件和旧备份

## v0.1.0.0 (2026-08-12)

- feat: BiliDataMonitor 独立项目（从 CrawlerAnalysis UP主分析功能独立）
  - 技术栈：Node.js + TypeScript 后端（Fastify + node:sqlite + axios + 自实现 WBI 签名）、Vue3 前端、Rust 托盘，零 Python 依赖
  - 监测维度：UP主（可限定最新 N 个视频）+ BV号单视频
  - 间隔轮询调度（5分钟~24小时可调，动态生效，系统启动即运行）
  - SQLite 双表分离存储（videos 当前值 + video_history 历史）+ 派生指标缓存表（up_metrics/up_daily_stats/up_monthly_trend/up_duration_dist/video_metrics）
  - 快照去重（四项指标全等跳过）+ 90 天自动清理
  - 系统集成：Windows 开机自启动 + Rust 系统托盘 + 自动打开浏览器
  - Cookie 管理界面与 CrawlerAnalysis 同款（掩码前4+***+后4，覆盖/取消/保存）
  - 端口 8123（127.0.0.1 回环，settings.json 可配置）
  - 目录结构：src/ 全部源码 + app/ 运行产物（web/config/data/logs/tray.exe）
