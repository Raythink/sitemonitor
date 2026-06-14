import { parseConfig } from "./config";
import { checkHttp, checkTcp } from "./monitor";
import { processResult } from "./alerter";
import { sendDailySummary } from "./summary";
import { HttpSiteConfig, TcpSiteConfig, AppConfig } from "./types";

declare global {
  interface Env {
    CONFIG: string;
  }
}

let cachedConfig: AppConfig | null = null;

function getConfig(env: Env): AppConfig {
  if (!cachedConfig) {
    cachedConfig = parseConfig(env.CONFIG);
  }
  return cachedConfig;
}

async function runChecks(env: Env): Promise<void> {
  const config = getConfig(env);

  for (const site of config.sites) {
    try {
      const result = site.type === "http"
        ? await checkHttp(site as HttpSiteConfig)
        : await checkTcp(site as TcpSiteConfig);

      await processResult(
        env.SITEMONITOR_KV,
        env.EMAIL,
        site,
        result,
        config.alertFrom,
        config.alertTo,
      );
    } catch (err) {
      console.error(`检查站点 "${site.name}" 时出错:`, err);
    }
  }
}

async function runDailySummary(env: Env): Promise<void> {
  const config = getConfig(env);

  await sendDailySummary(
    env.SITEMONITOR_KV,
    env.EMAIL,
    config.sites,
    config.alertFrom,
    config.alertTo,
  );
}

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/check") {
    ctx.waitUntil(runChecks(env));
    return new Response("检查已触发", { status: 202 });
  }

  const config = getConfig(env);
  const lines = [`# SiteMonitor 状态\n`, `更新时间: ${new Date().toISOString()}\n`];

  for (const site of config.sites) {
    const status = await env.SITEMONITOR_KV.get(`site:${site.name}:status`);
    const lastCheck = await env.SITEMONITOR_KV.get(`site:${site.name}:lastCheckTime`);
    const lastResult = await env.SITEMONITOR_KV.get(`site:${site.name}:lastCheckResult`);
    const lastAlert = await env.SITEMONITOR_KV.get(`site:${site.name}:lastAlertTime`);

    lines.push(`## ${site.name}`);
    lines.push(`  状态: ${status ?? "unknown"}`);
    lines.push(`  上次检查: ${lastCheck ?? "-"}`);
    if (lastResult) {
      const r = JSON.parse(lastResult);
      lines.push(`  结果: ${r.healthy ? "✅ 正常" : "❌ 异常"}${r.latencyMs ? ` (${r.latencyMs}ms)` : ""}${r.error ? ` - ${r.error}` : ""}`);
    }
    lines.push(`  上次告警: ${lastAlert ?? "-"}`);
    lines.push("");
  }

  const body = lines.join("\n");

  if (request.headers.get("Accept")?.includes("application/json")) {
    return Response.json({ ok: true, timestamp: new Date().toISOString() });
  }

  return new Response(`<html><head><meta charset="utf-8"><title>SiteMonitor</title><style>body{font-family:monospace;white-space:pre-wrap;padding:2em}</style></head><body>${body}</body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export default {
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (controller.cron === "0 0 * * *") {
      await runDailySummary(env);
    } else {
      await runChecks(env);
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};
