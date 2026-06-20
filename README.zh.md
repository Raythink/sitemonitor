# SiteMonitor

> [English Documentation](README.md)

基于 Cloudflare Workers 的网站/服务器可用性监控工具。零基础设施成本，利用 Cloudflare 边缘网络定时检查目标服务状态，邮件告警。

## 功能

- **HTTP 监控** — 检查 Web 站点状态码、响应时间、内容关键词
- **TCP 监控** — 通过 TCP 端口检测远程服务器存活（零侵入，仅三次握手）
- **告警限频** — 同一站点每小时最多一封告警邮件，避免骚扰
- **恢复通知** — 服务恢复时自动发送恢复邮件
- **每日摘要** — 每天 UTC 00:00 发送性能报告，含响应时间走势图
- **状态页** — 通过浏览器访问即可查看所有站点当前状态
- **多站点** — 单个 Worker 同时监控任意数量的 HTTP 站点和 TCP 服务
- **免费** — 完全运行在 Cloudflare 免费额度内

## 工作原理

```
                    Cron Trigger（每 5 分钟）
                           │
                    ┌──────┴──────┐
                    │             │
               HTTP 检查      TCP 端口检查
               （fetch）    （connect API）
                    │             │
                    └──────┬──────┘
                           │
                    状态对比 & 判断
                           │
               ┌───────────┼───────────┐
               │           │           │
           新故障      持续故障      恢复
               │           │           │
           立即告警   距上次>1h再告警 恢复通知

                    Cron Trigger（UTC 00:00）
                           │
                    读取前一日历史记录
                           │
                    生成摘要（可用率 +
                    最小/平均/最大延迟 +
                    按小时 ASCII 走势图）
                           │
                    发送汇总邮件
```

## 前置条件

1. Cloudflare 账号
2. 一个域名已接入 Cloudflare（用于 Email Routing 发件）
3. 在 Cloudflare Email Routing 中已验证收件地址

## 快速开始

### 1. 初始化项目

```bash
npm create cloudflare@latest sitemonitor -- --ts
cd sitemonitor
npm install
```

### 2. 创建 KV 命名空间

```bash
npx wrangler kv namespace create SITEMONITOR_KV
```

将返回的 ID 填入 `wrangler.jsonc`。

### 3. 配置 wrangler.jsonc

```jsonc
{
  "name": "sitemonitor",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-14",
  "compatibility_flags": ["nodejs_compat"],
  "kv_namespaces": [
    {
      "binding": "SITEMONITOR_KV",
      "id": "<上一步返回的 ID>"
    }
  ],
  "send_email": [
    {
      "name": "EMAIL",
      "destination_address": "admin@example.com"
    }
  ],
  "triggers": {
    "crons": ["*/5 * * * *", "0 0 * * *"]
  }
}
```

### 4. 设置监控配置

```bash
npx wrangler secret put CONFIG
```

输入 JSON 格式配置（示例）：

```json
{
  "sites": [
    {
      "name": "我的博客",
      "type": "http",
      "url": "https://example.com/wp-site-1",
      "responseTimeThresholdMs": 10000,
      "expectedStatus": 200
    },
    {
      "name": "Ubuntu服务器",
      "type": "tcp",
      "host": "server.example.com",
      "port": 22,
      "timeoutMs": 5000
    }
  ],
  "alertFrom": "monitor@yourdomain.com",
  "alertTo": "admin@example.com"
}
```

### 通过 Cloudflare Variables 配置（推荐，最多 5 个站点）

你也可以把每个站点配置单独放到 Cloudflare 的 Worker Variables（Dashboard → Workers → 你的 Worker → Variables）中，变量名为 `SITE_1`、`SITE_2` … `SITE_5`，最多支持 5 个站点。告警发件与收件使用 `ALERT_FROM` 和 `ALERT_TO` 变量。

要点：

- 每个 `SITE_N` 的值是单个站点的 JSON 对象（非数组）。
- 系统优先使用 `SITE_1`（存在时表示使用 Variables 模式）；若没有 `SITE_1` 则回退到 `CONFIG`（secret）方式。
- 仅支持最多 5 个 `SITE_N`；超过请合并到单个 `CONFIG` 中。

示例（HTTP 站点，作为 `SITE_1` 的值）：

```json
{
  "name": "我的博客",
  "type": "http",
  "url": "https://example.com",
  "responseTimeThresholdMs": 10000,
  "expectedStatus": 200,
  "expectedKeyword": "wp-content"
}
```

示例（TCP 站点，作为 `SITE_2` 的值）：

```json
{
  "name": "Ubuntu服务器",
  "type": "tcp",
  "host": "server.example.com",
  "port": 22,
  "timeoutMs": 5000
}
```

示例：设置告警邮箱为 Variables：

```
ALERT_FROM = monitor@yourdomain.com
ALERT_TO   = admin@example.com
```

如何设置：

- 在 Cloudflare Dashboard 打开你的 Worker，进入「Settings」→「Variables」，点击 Add variable，分别创建 `SITE_1`..`SITE_5` 与 `ALERT_FROM`/`ALERT_TO`，将上面的 JSON 粘贴为变量值。
- 也可以通过 Cloudflare API 批量管理 Variables（高级用法）。

注意：为方便在 Dashboard 中查看与修改，建议把单个站点的配置放到 `SITE_N`，并保证 JSON 格式正确。

### 5. 部署

```bash
npm run deploy
```

## 配置详解

### HTTP 类型检查

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `type` | — | 固定 `"http"` |
| `url` | — | 完整 URL（含协议） |
| `expectedStatus` | `200` | 期望 HTTP 状态码 |
| `responseTimeThresholdMs` | `10000` | 响应时间阈值（毫秒） |
| `expectedKeyword` | 无 | 响应体必须包含的关键词（如 `"wp-content"`） |

### TCP 类型检查

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `type` | — | 固定 `"tcp"` |
| `host` | — | 主机名或 IP 地址 |
| `port` | `22` | TCP 端口 |
| `timeoutMs` | `5000` | 连接超时（毫秒） |

### 告警限频说明

- 站点从健康变为不健康时：**立即**发送告警
- 站点持续不健康：距上次发送 **超过 1 小时**才再次发送
- 站点从不健康恢复为健康：**立即**发送恢复通知（不限频）
- 每个站点独立计数，互不影响

## 状态页

部署后可通过浏览器访问查看实时状态：

```
GET /          → HTML 状态页（显示所有站点的健康状态、延迟、上次检查时间）
GET /check     → 手动触发一次检查（返回 202，后台异步执行）
GET /          → 带 Accept: application/json 返回 JSON 格式
```

## 每日摘要邮件示例

```
===== 每日性能报告 =====
日期: 2026-06-13

站点: Ubuntu服务器
  总检查: 288 次
  可用率: 99.3%
  响应时间:
    最小值:  2 ms
    平均值: 15 ms
    最大值: 127 ms

  响应时间走势（UTC，按小时平均）:
  00:00 ████████ 18ms
  01:00 ████ 9ms
  ...
  23:00 ██████████████ 35ms
```

## 开发命令

```bash
npm run dev                           # 本地开发（wrangler dev）
npm run deploy                        # 部署
npx wrangler types                    # 生成类型定义
npx wrangler secret put CONFIG        # 更新配置
```

### 本地开发

1. 创建 `.dev.vars` 文件（参考 `.dev.vars.example`），填入本地 `CONFIG` 环境变量
2. 运行 `npm run dev`
3. 访问 `http://localhost:8787` 查看状态页
4. 触发 cron 检查：`curl "http://localhost:8787/cdn-cgi/handler/scheduled"`

## 许可证

MIT
