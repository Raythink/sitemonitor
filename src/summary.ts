import { CheckResult, SiteConfig } from "./types";

interface HistoryEntry {
  time: string;
  healthy: boolean;
  latencyMs?: number;
}

const KV_PREFIX = "site";

function kvKey(name: string, suffix: string): string {
  return `${KV_PREFIX}:${name}:${suffix}`;
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function recordDailyCheck(
  kv: KVNamespace,
  name: string,
  result: CheckResult,
): Promise<void> {
  const key = kvKey(name, `daily:${dateStr(new Date())}`);

  let history: HistoryEntry[] = [];
  const raw = await kv.get(key);
  if (raw) {
    try { history = JSON.parse(raw); } catch {}
  }

  history.push({
    time: new Date().toISOString(),
    healthy: result.healthy,
    latencyMs: result.latencyMs ?? result.responseTimeMs,
  });

  await kv.put(key, JSON.stringify(history));
}

function buildChart(
  history: HistoryEntry[],
  title: string,
  maxBarWidth: number,
): string {
  const buckets: { avg: number; cnt: number }[] = Array.from({ length: 24 }, () => ({ avg: 0, cnt: 0 }));
  for (const h of history) {
    if (h.latencyMs === undefined) continue;
    const hour = new Date(h.time).getUTCHours();
    buckets[hour].avg += h.latencyMs;
    buckets[hour].cnt++;
  }

  const maxAvg = Math.max(...buckets.map(b => b.cnt > 0 ? b.avg / b.cnt : 0));
  let chart = `${title}\n`;
  for (let h = 0; h < 24; h++) {
    const b = buckets[h];
    if (b.cnt === 0) {
      chart += `${String(h).padStart(2, "0")}:00 -\n`;
      continue;
    }
    const avg = Math.round(b.avg / b.cnt);
    const barLen = maxAvg > 0 ? Math.round((avg / maxAvg) * maxBarWidth) : 0;
    chart += `${String(h).padStart(2, "0")}:00 ${"█".repeat(Math.max(barLen, 1))} ${avg}ms\n`;
  }
  return chart;
}

export async function sendDailySummary(
  kv: KVNamespace,
  email: SendEmail,
  sites: SiteConfig[],
  alertFrom: string,
  alertTo: string,
): Promise<void> {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const ds = dateStr(yesterday);
  const parts: string[] = [
    `===== 每日性能报告 =====`,
    `日期: ${ds}`,
    "",
  ];

  for (const site of sites) {
    const key = kvKey(site.name, `daily:${ds}`);
    const raw = await kv.get(key);
    if (!raw) {
      parts.push(`站点: ${site.name}`, "  当天无数据\n");
      continue;
    }

    let history: HistoryEntry[];
    try { history = JSON.parse(raw); } catch { continue; }

    if (history.length === 0) continue;

    const total = history.length;
    const success = history.filter(h => h.healthy).length;
    const pct = (success / total * 100).toFixed(1);

    const latencies = history.filter(h => h.latencyMs !== undefined).map(h => h.latencyMs!);
    const hasLatency = latencies.length > 0;
    const minL = hasLatency ? Math.min(...latencies) : 0;
    const maxL = hasLatency ? Math.max(...latencies) : 0;
    const avgL = hasLatency ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

    parts.push(
      `站点: ${site.name}`,
      `  总检查: ${total} 次`,
      `  可用率: ${pct}%`,
      hasLatency ? `  响应时间:` : "",
      hasLatency ? `    最小值:  ${minL} ms` : "",
      hasLatency ? `    平均值:  ${avgL} ms` : "",
      hasLatency ? `    最大值:  ${maxL} ms` : "",
      "",
    );

    if (hasLatency) {
      parts.push(buildChart(history, "  响应时间走势（UTC，按小时平均）:", 20));
    }

    parts.push("");

    await kv.delete(key).catch(() => {});
  }

  const body = parts.join("\n");

  try {
    await email.send({
      from: { name: "SiteMonitor", email: alertFrom },
      to: [{ name: "管理员", email: alertTo }],
      subject: `[SiteMonitor] 每日报告 ${ds}`,
      text: body,
    });
    console.log(`已发送 ${ds} 每日摘要`);
  } catch (err) {
    console.error("发送每日摘要失败:", err);
  }
}
