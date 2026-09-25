# 服务器更新计划：非自然流量指数（v0.2.2.15）

> 目标：在服务器前后端上线「视频详情 → 非自然流量指数（0-100）」
> 连接：`root@39.96.62.120`，密钥 `F:\软件数据\Edge 下载\青叶.pem`
> 项目路径：`/home/admin/project/BiliDataMonitor-linux`

## 变更范围

| 层级 | 文件 | 说明 |
|------|------|------|
| 后端新增 | `src/server/analytics/boostIndex.ts` | 指数算法 |
| 后端改 | `src/server/database.ts` | `listVideoHistoryLeading` |
| 后端改 | `src/server/routes/video.ts` | detail 返回 `boostIndex` |
| 前端改 | `src/frontend/src/api/monitor.ts` | `BoostIndex` 类型 |
| 前端改 | `src/frontend/src/views/Detail.vue` | 概览指数卡片 |
| 构建产物 | `src/server/dist/**`、`app/web/**` | 需一并同步（服务器资源有限，前端在本地编好） |

无数据库迁移、无配置变更。

## 更新步骤

### 1. 本地已完成（本仓库）

```powershell
pnpm build   # 已通过：server tsc + vite → app/web
```

确认存在：
- `src/server/dist/analytics/boostIndex.js`
- `src/server/dist/routes/video.js` 含 `computeBoostIndex`
- `app/web/assets/Detail-*.js` 已更新

### 2. 同步到服务器（只推运行所需）

```powershell
$pem = "F:\软件数据\Edge 下载\青叶.pem"
$host = "root@39.96.62.120"
$remote = "/home/admin/project/BiliDataMonitor-linux"

# 后端源码（服务器上用项目内 tsc 再编译，见 AGENTS）
scp -i $pem src/server/analytics/boostIndex.ts ${host}:${remote}/src/server/analytics/
scp -i $pem src/server/database.ts src/server/routes/video.ts ${host}:${remote}/src/server/
# 或整目录：scp -i $pem -r src/server ${host}:${remote}/src/

# 前端构建产物（本地已编好，直接覆盖）
scp -i $pem -r app/web ${host}:${remote}/app/
```

### 3. 服务器编译后端

```bash
ssh -i $pem $host
cd /home/admin/project/BiliDataMonitor-linux
# 禁止 npx tsc（可能解析到错误包），用：
node node_modules/.pnpm/typescript@*/node_modules/typescript/bin/tsc -p src/server/tsconfig.json
# 校验 0 error，并确认 dist/analytics/boostIndex.js 存在
```

### 4. 重启服务

```bash
sudo systemctl restart bilidatamonitor
# 或
sudo systemctl restart bili-monitor

systemctl is-active bilidatamonitor
journalctl -u bilidatamonitor -n 50 --no-pager
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8123/
```

### 5. 冒烟验证

```bash
# 任选一条有 ≥24 个前48h 样本的 bvid
curl -s http://127.0.0.1:8123/api/video/BV13Xew6LE7T/detail | jq '.data.boostIndex'
# 期望：score 为 0-100 整数，evidence 非空或 insufficient 有文案
```

浏览器打开 `/detail/video/<bvid>`：
- 概览下方出现「🛡️ 非自然流量指数（前48小时）」卡片
- 显示分数、等级色（绿/橙/红）、子分、证据列表

### 6. 回滚

```bash
# git 回退后重新编译 + 重启；或用 git checkout 上一 tag 的 dist/app/web
cd /home/admin/project/BiliDataMonitor-linux
git log -3 --oneline
# 如需：git checkout <prev> -- src/server app/web
node node_modules/.pnpm/typescript@*/node_modules/typescript/bin/tsc -p src/server/tsconfig.json
sudo systemctl restart bilidatamonitor
```

## 验收清单

- [ ] `pnpm build` 0 error
- [ ] `detail` 响应含 `boostIndex.score ∈ [0,100]`
- [ ] 样本不足时显示 `insufficient`，不报 500
- [ ] 视频详情卡片渲染正常，UP/动态/专栏页无回归
- [ ] 旧缓存 `video_metrics` 不受影响（指数按请求实时计算，不入库）

## 备注

- 指数**不写数据库**，打开详情时现算，避免历史任务调度负担
- 监测间隔 5min±10s，算法已按实际 Δt 归一，漏采不会放大假跃升
- 后续可按标注样本校准阈值（`J`、平台长度、综合分边界）
