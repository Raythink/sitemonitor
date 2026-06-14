import { CheckResult, SiteConfig } from "./types";
import { recordDailyCheck } from "./summary";

const ONE_HOUR_MS = 60 * 60 * 1000;
const KV_PREFIX = "site";

function kvKey(name: string, suffix: string): string {
  return `${KV_PREFIX}:${name}:${suffix}`;
}

function buildBody(site: SiteConfig, result: CheckResult): string {
  const lines: string[] = [
    `站点: ${site.name}`,
    `时间: ${new Date().toISOString()}`,
  ];
  if (result.statusCode !== undefined) lines.push(`状态码: ${result.statusCode}`);
  if (result.responseTimeMs !== undefined) lines.push(`响应时间: ${result.responseTimeMs}ms`);
  if (result.latencyMs !== undefined) lines.push(`延迟: ${result.latencyMs}ms`);
  if (result.error) lines.push(`错误: ${result.error}`);
  return lines.join("\n");
}

async function sendMail(
  email: SendEmail,
  from: string,
  to: string,
  siteName: string,
  tag: string,
  body: string,
): Promise<void> {
  try {
    await email.send({
      from: { name: "SiteMonitor", email: from },
      to: [{ name: siteName, email: to }],
      subject: `[SiteMonitor] ${siteName} - ${tag}`,
      text: body,
    });
  } catch (err) {
    console.error(`发送邮件失败 (${siteName}):`, err);
  }
}

export async function processResult(
  kv: KVNamespace,
  email: SendEmail,
  site: SiteConfig,
  result: CheckResult,
  alertFrom: string,
  alertTo: string,
): Promise<void> {
  const now = new Date().toISOString();
  const statusKey = kvKey(site.name, "status");
  const prevStatus = await kv.get(statusKey);

  if (result.healthy) {
    if (prevStatus === "unhealthy") {
      await sendMail(
        email, alertFrom, alertTo, site.name, "已恢复",
        `服务已恢复正常。\n\n${buildBody(site, result)}`,
      );
    }
    await kv.put(statusKey, "healthy");
    await kv.put(kvKey(site.name, "lastCheckTime"), now);

    await recordDailyCheck(kv, site.name, result);
    return;
  }

  const alertTimeKey = kvKey(site.name, "lastAlertTime");

  if (prevStatus === "healthy" || prevStatus === null) {
    await sendMail(
      email, alertFrom, alertTo, site.name, "告警",
      `服务不可用。\n\n${buildBody(site, result)}`,
    );
    await kv.put(statusKey, "unhealthy");
    await kv.put(alertTimeKey, now);
  } else {
    const lastAlert = await kv.get(alertTimeKey);
    const elapsed = lastAlert ? Date.now() - new Date(lastAlert).getTime() : Infinity;
    if (elapsed > ONE_HOUR_MS) {
      await sendMail(
        email, alertFrom, alertTo, site.name, "持续告警",
        `服务仍不可用（距上次告警已超过 1 小时）。\n\n${buildBody(site, result)}`,
      );
      await kv.put(alertTimeKey, now);
    }
  }

  await kv.put(statusKey, "unhealthy");
  await kv.put(kvKey(site.name, "lastCheckTime"), now);
  await kv.put(kvKey(site.name, "lastCheckResult"), JSON.stringify(result));

  await recordDailyCheck(kv, site.name, result);
}
