import { AppConfig, SiteConfig } from "./types";

function parseSite(raw: Record<string, unknown>): SiteConfig {
  const name = String(raw.name ?? "");
  if (!name) throw new Error("站点缺少 name");

  const type = raw.type;
  if (type === "http") {
    const url = raw.url;
    if (!url) throw new Error(`HTTP 站点 "${name}" 缺少 url`);
    return {
      name,
      type: "http",
      url: String(url),
      responseTimeThresholdMs: Number(raw.responseTimeThresholdMs ?? 10000),
      expectedStatus: Number(raw.expectedStatus ?? 200),
      expectedKeyword: raw.expectedKeyword ? String(raw.expectedKeyword) : undefined,
    };
  }

  if (type === "tcp") {
    const host = raw.host;
    if (!host) throw new Error(`TCP 站点 "${name}" 缺少 host`);
    return {
      name,
      type: "tcp",
      host: String(host),
      port: Number(raw.port ?? 22),
      timeoutMs: Number(raw.timeoutMs ?? 5000),
    };
  }

  throw new Error(`站点 "${name}" 的 type 必须为 "http" 或 "tcp"`);
}

export function parseConfig(jsonStr: string): AppConfig {
  const raw = JSON.parse(jsonStr);

  if (!Array.isArray(raw.sites) || raw.sites.length === 0) {
    throw new Error("配置中必须包含至少一个站点");
  }
  if (!raw.alertFrom || !raw.alertTo) {
    throw new Error("必须配置 alertFrom 和 alertTo");
  }

  return {
    sites: raw.sites.map(parseSite),
    alertFrom: String(raw.alertFrom),
    alertTo: String(raw.alertTo),
  };
}
