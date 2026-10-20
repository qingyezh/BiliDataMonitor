# Edge 扩展：一键获取 B 站 Cookie 并推送

> 探索方案。当前 Cookie 监测已实现「15 分钟健康检查 + 顶栏 ⚠️」；本扩展解决「失效后如何半自动续期」。

## 为什么不能全自动登录

- B 站无公开 OAuth / 长期 refresh token 供无头服务器续 `SESSDATA`
- 自动化登录普遍触发滑块/风控，稳定性差
- 服务器上跑浏览器账号密码登录：安全与合规风险高

**可行路径**：浏览器已登录 → 扩展读当前站 Cookie → 推到本项目 API。

## 目标体验

1. 用户在 Edge 登录 `bilibili.com`
2. 点扩展图标 → 显示当前 Cookie 是否含 `SESSDATA`
3. 填一次服务地址（如 `http://39.96.62.120:8124`）与 **root 的 API Key**（登录页/设置可复制）
4. 点「推送到监控」→ `PUT /api/system/cookies`（带 `x-api-key`；若需 session cookie 会复杂——见下）

## 认证注意（关键）

本项目 `/api/*` 中间件要求：

1. Header `X-API-Key`
2. Cookie `token`（本系统自己的登录态，不是 B 站）

扩展从浏览器读到的是 **B 站 Cookie**，不能直接当本系统 `token`。推送方式二选一：

| 方案 | 做法 | 评价 |
|------|------|------|
| A. 后端加扩展专用通道 | 新增 `POST /api/system/cookies/push`，仅校验与 root 绑定的 **一次性 push token**（设置页生成，存配置） | **推荐**；扩展只存 push token，不碰本系统 session |
| B. 扩展先登录本系统 | 扩展调用 `/api/auth/login` 拿 cookie token + API Key，再 PUT | 流程长，密码进扩展存储不安全 |
| C. 用户粘贴 | 扩展只复制到剪贴板，用户到设置页粘贴 | 零后端改动，体验略差 |

**建议先做 C（一周内可用），再做 A（一键推送）。**

## 方案 C：仅复制（零后端）

`manifest.json`（MV3）：

```json
{
  "manifest_version": 3,
  "name": "Bili Cookie for BiliDataMonitor",
  "version": "1.0.0",
  "permissions": ["cookies", "clipboardWrite", "storage"],
  "host_permissions": ["*://*.bilibili.com/*"],
  "action": {
    "default_popup": "popup.html",
    "default_title": "获取 B 站 Cookie"
  },
  "icons": { "128": "icon.png" }
}
```

`popup.js` 逻辑：

```js
const cookie = await chrome.cookies.getAll({ domain: '.bilibili.com' })
const needed = ['SESSDATA', 'bili_jct', 'DedeUserID', 'sid']
const map = Object.fromEntries(cookie.map(c => [c.name, c.value]))
const missing = needed.filter(k => !map[k])
if (missing.length) {
  alert('请先登录 B 站，缺少: ' + missing.join(', '))
  return
}
const header = cookie.map(c => `${c.name}=${c.value}`).join('; ')
await navigator.clipboard.writeText(header)
// 提示：已复制，可到监控「设置 → Cookie 管理 → 修改 → 粘贴 → 覆盖」
```

Edge 加载：`edge://extensions` → 开发人员模式 → 加载已解压的扩展。

## 方案 A：一键推送（需后端小改）

1. 设置页（root）：生成 `cookie_push_token`（随机 32 字节 hex），写入 `app/config/`（勿提交 git）
2. 后端：`POST /api/system/cookies/push`  
   - Body: `{ push_token, cookie }`  
   - 校验 token 后调用现有 `saveCookie` + 健康检查  
   - **不走** 现有 session 中间件（或单独 PUBLIC 路径 + 强 token）
3. 扩展：`chrome.cookies.getAll` → `fetch(server + '/api/system/cookies/push', { method:'POST', body })`

安全边界：

- push token 仅 root 可看/重置
- HTTPS 或至少内网；公网建议 basic auth / 仅 nginx 白名单
- 失败次数限制，防暴力猜 token

## 与现有 15 分钟检查的关系

```text
扩展推送成功 → saveCookie → onCookieSaved() 立即 nav 校验 → 顶栏 ⚠️ 消失
15 分钟定时器 → checkCookieHealth → 失效/超72h → 顶栏红色叹号
```

## 目录建议（若正式实现）

```
extensions/edge-bili-cookie/
  manifest.json
  popup.html
  popup.js
  README.md
```

## 结论

| 需求 | 结论 |
|------|------|
| Cookie 失效/过期提醒 | **已做**：服务端 15 分钟检查 + 前端顶栏 ⚠️ + 设置页详情 |
| 一劳永逸自动登录 | **不可靠**，不建议 |
| 一键获取 | 扩展 `cookies` API 很成熟；**先复制粘贴，后 push token 一键推** |

需要正式落地时：说一声即可做「方案 C 扩展」或「A 后端 push 接口 + 扩展」。
