export interface HttpSiteConfig {
  name: string;
  type: "http";
  url: string;
  responseTimeThresholdMs: number;
  expectedStatus: number;
  expectedKeyword?: string;
}

export interface TcpSiteConfig {
  name: string;
  type: "tcp";
  host: string;
  port: number;
  timeoutMs: number;
}

export type SiteConfig = HttpSiteConfig | TcpSiteConfig;

export interface AppConfig {
  sites: SiteConfig[];
  alertFrom: string;
  alertTo: string;
}

export interface CheckResult {
  healthy: boolean;
  statusCode?: number;
  responseTimeMs?: number;
  latencyMs?: number;
  error?: string;
}
