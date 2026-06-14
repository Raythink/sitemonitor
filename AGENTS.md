# SiteMonitor — 开发指南

## 项目概述

SiteMonitor 是一个部署在 Cloudflare Workers 上的网站/服务器可用性监控工具。每 5 分钟通过 Cron Trigger 执行一次检查，发现问题时通过邮件告警，同一站点每小时最多一封告警邮件，避免告警轰炸。每天 UTC 00:00 发送前一日性能摘要邮件。

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Cloudflare Workers + TypeScript |
| 调度 | Cron Triggers（`*/5 * * * *` + `0 0 * * *`） |
| 持久化 | Cloudflare KV |
| 邮件 | Cloudflare Email Service（`send_email` binding） |

## 项目结构

```
sitemonitor/
├── src/
│   ├── index.ts       # Worker 入口（scheduled + fetch handler）
│   ├── config.ts      # 配置解析与校验
│   ├── monitor.ts     # 检查执行器（HTTP + TCP）
│   ├── alerter.ts     # 告警逻辑（状态判断 + 频率控制）
│   ├── summary.ts     # 每日性能记录与摘要生成
│   └── types.ts       # 共享类型定义
├── wrangler.jsonc     # Worker 配置
├── .dev.vars          # 本地开发环境变量
├── package.json
├── tsconfig.json
├── AGENTS.md
└── README.md
```

## 核心流程

### 定时检查（每 5 分钟）

```
Cron Trigger（*/5 * * * *）
    │
    ├── 遍历所有站点配置
    │     │
    │     ├── type === "http"
    │     │     → HTTP GET，检查状态码、响应时间、关键词
    │     │
    │     └── type === "tcp"
    │           → TCP connect，检查端口是否开放
    │
    ├── 对比 KV 中的历史状态
    │     │
    │     ├── 健康→不健康 → 立即告警
    │     ├── 持续不健康  → 距上次告警 > 1h 再发
    │     └── 不健康→健康 → 发恢复通知
    │
    └── 更新 KV（状态 + 每日历史记录）
```

### 每日摘要（UTC 00:00）

```
Cron Trigger（0 0 * * *）
    │
    ├── 遍历所有站点
    │     ├── 读取前一日 KV 历史：site:{name}:daily:YYYY-MM-DD
    │     ├── 计算总检查、可用率、最小/平均/最大延迟
    │     └── 生成按小时平均的 ASCII 走势图
    │
    ├── 发送汇总邮件
    └── 清理前一日 KV 记录
```

### HTTP 状态页

```
fetch handler 支持：
  GET /        → 显示所有站点当前状态（从 KV 读取）
  GET /check   → 手动触发一次检查（非阻塞）
```

## 配置格式

配置通过环境变量 `CONFIG`（secret）传入，JSON 格式：

```json
{
  "sites": [
    {
      "name": "站点名称",
      "type": "http",
      "url": "https://example.com",
      "responseTimeThresholdMs": 10000,
      "expectedStatus": 200,
      "expectedKeyword": "wp-content"
    },
    {
      "name": "服务器名称",
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

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sites` | array | 是 | 监控目标列表 |
| `sites[].name` | string | 是 | 站点标识名（用于 KV key） |
| `sites[].type` | `"http"\|"tcp"` | 是 | 检查类型 |
| `sites[].url` | string | HTTP 必填 | 目标 URL |
| `sites[].host` | string | TCP 必填 | 目标主机名/IP |
| `sites[].port` | number | TCP 必填（默认 22） | 目标端口 |
| `sites[].responseTimeThresholdMs` | number | 否 | HTTP 响应时间阈值（默认 10000） |
| `sites[].expectedStatus` | number | 否 | HTTP 期望状态码（默认 200） |
| `sites[].expectedKeyword` | string | 否 | HTTP 响应体关键词检测 |
| `sites[].timeoutMs` | number | 否 | TCP 超时时间（默认 5000） |
| `alertFrom` | string | 是 | 发件邮箱 |
| `alertTo` | string | 是 | 收件邮箱 |

## KV 设计

| Key | 值类型 | 说明 |
|-----|--------|------|
| `site:{name}:status` | `"healthy"\|"unhealthy"` | 当前健康状态 |
| `site:{name}:lastAlertTime` | ISO 8601 字符串 | 上次告警时间戳 |
| `site:{name}:lastCheckTime` | ISO 8601 字符串 | 上次检查时间戳 |
| `site:{name}:lastCheckResult` | JSON 字符串 | 最近一次检查详情 |
| `site:{name}:daily:YYYY-MM-DD` | JSON 数组 | 某日的所有检查记录（含时间、健康状态、延迟） |

## 检查逻辑

### HTTP 检查（`monitor.ts`）

```
1. fetch(url, { signal: AbortSignal.timeout(timeout) })
2. 验证 response.status === expectedStatus
3. 验证响应时间 < responseTimeThresholdMs
4. 如配置了 expectedKeyword，验证响应体是否包含
5. 全部通过 → healthy，否则 unhealthy
```

### TCP 检查（`monitor.ts`）

```
1. connect({ hostname, port })
2. 以 timeoutMs 为限等待连接建立
   - 连接成功 → alive（立即 close）
   - 超时 / 拒绝 → dead
3. 返回 { alive, latencyMs }
```

## 告警逻辑（`alerter.ts`）

```
read KV status
    │
    ├── current=healthy, previous=unhealthy
    │     → 发送恢复通知，更新 KV status=healthy
    │
    ├── current=unhealthy, previous=healthy
    │     → 发送告警，更新 KV status=unhealthy & lastAlertTime=now
    │
    ├── current=unhealthy, previous=unhealthy
    │     → 读取 lastAlertTime，距现在 > 1h 则再发并更新 lastAlertTime
    │
    └── current=healthy, previous=healthy
          → 静默，仅更新 lastCheckTime
```

## 部署步骤

```bash
# 1. 创建 KV namespace
npx wrangler kv namespace create SITEMONITOR_KV

# 2. 安装依赖
npm install

# 3. 设置配置（secret）
npx wrangler secret put CONFIG

# 4. 类型生成
npx wrangler types

# 5. 部署
npm run deploy
```

### 前置条件

- Cloudflare 账号
- 域名已接入 Cloudflare 并启用 Email Routing
- 收件地址在 Email Routing 中已验证
- 发件域名已通过 Email Service 验证

### 前置条件

- Cloudflare 账号
- 域名已接入 Cloudflare 并启用 Email Routing
- 收件地址在 Email Routing 中已验证
- 发件域名已通过 Email Service 验证

## 代码约定

- 使用 TypeScript，严格模式
- 不加注释，代码即文档
- 所有告警/状态判断在 `alerter.ts`，不散落在其他模块
- KV 操作统一处理错误，不阻断主流程
- 新增检查类型：在 `monitor.ts` 中添加新的 `check*` 函数，在 `config.ts` 的 `SiteConfig` 联合类型中添加对应 type
