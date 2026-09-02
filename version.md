# 版本记录

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
