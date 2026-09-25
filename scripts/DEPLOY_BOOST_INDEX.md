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

### 1. 本地编译（服务器资源有限，**禁止在服务器 tsc/vite**）

```powershell
pnpm build   # server tsc + vite → app/web
```

确认存在：
- `src/server/dist/analytics/boostIndex.js`
- `src/server/dist/routes/video.js` 含 `computeBoostIndex`
- `app/web/assets/Detail-*.js` 已更新

### 2. 推送本地编译产物到服务器

```powershell
$pem = "F:\软件数据\Edge 下载\青叶.pem"
$host = "root@39.96.62.120"
$remote = "/home/admin/project/BiliDataMonitor-linux"

# 先停服杀进程（见步骤 3），再推
scp -i $pem -r src/server/dist/* ${host}:${remote}/src/server/dist_new/
scp -i $pem -r app/web/* ${host}:${remote}/app/web_new/
```

### 3. 停服 + 清进程（防双开）

```bash
systemctl stop bili-monitor
systemctl stop bilidatamonitor   # 两个 unit 同源 ExecStart，必须都停
# 杀掉本项目残留 node（含旧进程）
pkill -f 'BiliDataMonitor-linux/src/server/dist/index.js' || true
sleep 1
pkill -9 -f 'BiliDataMonitor-linux/src/server/dist/index.js' || true
rm -f app/data/bili-monitor.lock
# 确认 0 个进程、端口空闲
pgrep -af 'BiliDataMonitor-linux/src/server/dist/index.js' || echo none
ss -lntp | grep -E '8123|8124' || echo ports_free
```

### 4. 原子换入产物

```bash
cd /home/admin/project/BiliDataMonitor-linux
mv src/server/dist src/server/dist_old && mv src/server/dist_new src/server/dist
mv app/web app/web_old && mv app/web_new app/web
test -f src/server/dist/analytics/boostIndex.js && echo DIST_OK
```

### 5. 启动（只开一个 unit，避免双开）

```bash
# 当前线上 unit 为 bili-monitor（端口以 settings.json 为准，现网 8124）
systemctl start bili-monitor
systemctl is-active bili-monitor
systemctl is-active bilidatamonitor   # 应为 inactive

# 校验单实例：仅 1 个 node + lock.pid 一致
pgrep -af 'BiliDataMonitor-linux/src/server/dist/index.js'
cat app/data/bili-monitor.lock
ss -lntp | grep -E '8123|8124'
```

**双开防护要点：**
- `bili-monitor` 与 `bilidatamonitor` 的 `ExecStart` 相同，**禁止同时 active**
- 启动前必须 `rm` 旧 lock；进程退出后若 lock 残留会挡住新实例
- 端口被占时应用会直接退出（不自动换端口），属预期行为

### 6. 冒烟验证

```bash
# 算法层（不需要 API Key）
cd /home/admin/project/BiliDataMonitor-linux
node --experimental-sqlite smoke_boost_server.mjs BV13Xew6LE7T
# 期望：SMOKE_OK，score∈[0,100]

# HTTP 层
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8124/
# 200；详情 API 需 x-api-key，浏览器登录后看卡片
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
