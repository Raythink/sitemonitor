# SiteMonitor

Serverless website & server uptime monitoring powered by Cloudflare Workers. Zero infrastructure cost — check services from Cloudflare's edge network every 5 minutes, get email alerts on failures, and receive daily performance digests.

> [中文版文档](README.zh.md)

## Features

- **HTTP Monitoring** — Check status code, response time, and content keywords
- **TCP Monitoring** — Zero-intrusion port check (TCP handshake only, no data sent)
- **Smart Alert Throttling** — Max 1 alert per site per hour to prevent noise
- **Recovery Notifications** — Automatic recovery email when service comes back
- **Daily Digest** — Performance report every midnight (UTC) with response time chart
- **Live Status Page** — Visit the Worker URL to see all sites at a glance
- **Multi-site** — Monitor any number of HTTP & TCP targets from a single Worker
- **Free Tier** — Runs entirely within Cloudflare's free plan

## Architecture

```
                    Cron Trigger (every 5 min)
                           │
                    ┌──────┴──────┐
                    │             │
               HTTP check     TCP port check
               (fetch)       (node:net)
                    │             │
                    └──────┬──────┘
                           │
                    State comparison
                           │
               ┌───────────┼───────────┐
               │           │           │
          New down    Still down     Recovery
               │           │           │
          Alert now   >1h since      Notify
                      last alert?
                        Yes→Alert

                    Cron Trigger (00:00 UTC)
                           │
                    Read yesterday's history
                           │
                    Generate summary
                    (uptime %, min/avg/max latency,
                     hourly ASCII chart)
                           │
                    Send digest email
```

## Prerequisites

1. A Cloudflare account
2. A domain on Cloudflare (for Email Routing sender)
3. A verified recipient address in Cloudflare Email Routing

## Quick Start

### 1. Create the project

```bash
npm create cloudflare@latest sitemonitor -- --ts
cd sitemonitor
npm install
```

### 2. Create a KV namespace

```bash
npx wrangler kv namespace create SITEMONITOR_KV
```

Put the returned ID into `wrangler.jsonc`.

### 3. Configure wrangler.jsonc

```jsonc
{
  "name": "sitemonitor",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-14",
  "compatibility_flags": ["nodejs_compat"],
  "kv_namespaces": [
    {
      "binding": "SITEMONITOR_KV",
      "id": "YOUR_KV_NAMESPACE_ID"
    }
  ],
  "send_email": [
    {
      "name": "EMAIL",
      "destination_address": "YOUR_VERIFIED_EMAIL"
    }
  ],
  "triggers": {
    "crons": ["*/5 * * * *", "0 0 * * *"]
  }
}
```

### 4. Set the monitoring config

```bash
npx wrangler secret put CONFIG
```

Paste the JSON configuration (example):

```json
{
  "sites": [
    {
      "name": "My WordPress",
      "type": "http",
      "url": "https://example.com",
      "responseTimeThresholdMs": 10000,
      "expectedStatus": 200
    },
    {
      "name": "Production Server",
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

### 5. Deploy

```bash
npm run deploy
```

## Configuration Reference

### HTTP Site

| Field | Default | Description |
|-------|---------|-------------|
| `type` | — | Must be `"http"` |
| `url` | — | Full URL with protocol |
| `expectedStatus` | `200` | Expected HTTP status code |
| `responseTimeThresholdMs` | `10000` | Max acceptable response time (ms) |
| `expectedKeyword` | none | Keyword the response body must contain |

### TCP Site

| Field | Default | Description |
|-------|---------|-------------|
| `type` | — | Must be `"tcp"` |
| `host` | — | Hostname or IP address |
| `port` | `22` | TCP port |
| `timeoutMs` | `5000` | Connection timeout (ms) |

### Alert Throttling

- **Healthy → Unhealthy**: alert **immediately**
- **Still unhealthy**: alert again only if **> 1 hour** since last alert
- **Unhealthy → Healthy**: recovery notification sent immediately (no throttle)
- Each site tracks its own alert timer independently

## Status Page

Once deployed, visit your Worker URL:

```
GET /          → HTML status page (all sites' health, latency, last check)
GET /check     → Trigger a manual check (returns 202, runs in background)
Accept: json   → Returns JSON instead of HTML
```

## Daily Digest Sample

```
===== Daily Performance Report =====
Date: 2026-06-13

Site: Production Server
  Total checks:  288
  Uptime:        99.3%
  Latency:
    Min:    2 ms
    Avg:   15 ms
    Max:  127 ms

  Hourly latency trend (UTC):
  00:00 ████████ 18ms
  01:00 ████ 9ms
  ...
  23:00 ██████████████ 35ms
```

## Development

```bash
npm run dev                           # Local dev (wrangler dev)
npm run deploy                        # Deploy to Cloudflare
npx wrangler types                    # Regenerate type definitions
npx wrangler secret put CONFIG        # Update config
```

### Local Setup

1. Copy `.dev.vars.example` to `.dev.vars` and fill in your config
2. Run `npm run dev`
3. Visit `http://localhost:8787` to see the status page
4. Trigger a cron check: `curl "http://localhost:8787/cdn-cgi/handler/scheduled"`

## Project Structure

```
sitemonitor/
├── src/
│   ├── index.ts       # Worker entry (scheduled + fetch handler)
│   ├── config.ts      # Config parsing & validation
│   ├── monitor.ts     # HTTP & TCP check logic
│   ├── alerter.ts     # Alert logic & rate limiting
│   ├── summary.ts     # Daily history recording & digest
│   └── types.ts       # Shared TypeScript types
├── wrangler.jsonc     # Worker configuration
├── .dev.vars          # Local environment variables
├── package.json
├── tsconfig.json
├── AGENTS.md          # Developer guide (Chinese)
└── README.zh.md       # Chinese documentation
```

## KV Schema

| Key | Type | Description |
|-----|------|-------------|
| `site:{name}:status` | `"healthy"\|"unhealthy"` | Current health |
| `site:{name}:lastAlertTime` | ISO 8601 | Last alert timestamp |
| `site:{name}:lastCheckTime` | ISO 8601 | Last check timestamp |
| `site:{name}:lastCheckResult` | JSON | Last check details |
| `site:{name}:daily:YYYY-MM-DD` | JSON array | All checks for the day |

## License

MIT
