import pidusage from "pidusage";

export interface ProcessMetricsSample {
  sampledAt: string;
  cpuPercent: number;
  memoryBytes: number;
}

export interface ProcessMetricsResult {
  metrics: ProcessMetricsSample | null;
  reason?: string;
}

export async function sampleProcessMetrics(pid: number | undefined): Promise<ProcessMetricsResult> {
  if (pid === undefined || !Number.isFinite(pid) || pid <= 0) {
    return { metrics: null, reason: "invalid_pid" };
  }
  try {
    const stat = await pidusage(pid);
    return {
      metrics: {
        sampledAt: new Date().toISOString(),
        cpuPercent: stat.cpu ?? 0,
        memoryBytes: stat.memory ?? 0,
      },
    };
  } catch (e) {
    return {
      metrics: null,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
