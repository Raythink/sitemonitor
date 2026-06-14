import net from "node:net";
import { HttpSiteConfig, TcpSiteConfig, CheckResult } from "./types";

export async function checkHttp(site: HttpSiteConfig): Promise<CheckResult> {
  const start = Date.now();
  try {
    const response = await fetch(site.url, {
      signal: AbortSignal.timeout(site.responseTimeThresholdMs),
    });
    const responseTimeMs = Date.now() - start;

    if (response.status !== site.expectedStatus) {
      return {
        healthy: false,
        statusCode: response.status,
        responseTimeMs,
        error: `状态码异常：期望 ${site.expectedStatus}，实际 ${response.status}`,
      };
    }

    if (responseTimeMs > site.responseTimeThresholdMs) {
      return {
        healthy: false,
        statusCode: response.status,
        responseTimeMs,
        error: `响应超时：${responseTimeMs}ms（阈值 ${site.responseTimeThresholdMs}ms）`,
      };
    }

    if (site.expectedKeyword) {
      const text = await response.text();
      if (!text.includes(site.expectedKeyword)) {
        return {
          healthy: false,
          statusCode: response.status,
          responseTimeMs,
          error: `未找到关键词 "${site.expectedKeyword}"`,
        };
      }
    }

    return { healthy: true, statusCode: response.status, responseTimeMs };
  } catch (err) {
    return {
      healthy: false,
      error: err instanceof Error ? err.message : "HTTP 请求异常",
    };
  }
}

export async function checkTcp(site: TcpSiteConfig): Promise<CheckResult> {
  const start = Date.now();
  try {
    const alive = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      let settled = false;

      socket.setTimeout(site.timeoutMs);

      socket.on("connect", () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(true);
      });

      socket.on("timeout", () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(false);
      });

      socket.on("error", () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(false);
      });

      socket.on("close", () => {
        if (settled) return;
        settled = true;
        resolve(false);
      });

      socket.connect(site.port, site.host);
    });

    if (alive) {
      return { healthy: true, latencyMs: Date.now() - start };
    }
    return {
      healthy: false,
      error: `TCP 连接失败：${site.host}:${site.port} 无响应`,
    };
  } catch (err) {
    return {
      healthy: false,
      error: err instanceof Error ? err.message : "TCP 连接异常",
    };
  }
}
