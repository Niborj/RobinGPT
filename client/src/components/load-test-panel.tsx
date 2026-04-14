import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useCredentials } from "@/contexts/credentials-context";
import { useLanguage } from "@/contexts/language-context";
import { useToast } from "@/hooks/use-toast";
import { GENERIC_TEXT_PROMPTS } from "@/data/generic-text-prompts";
import { CODE_DEV_PROMPTS } from "@/data/code-dev-prompts";
import { MIXED_LANG_PROMPTS } from "@/data/mixed-lang-prompts";
import {
  Play, Square, Zap, Activity, Clock, ChevronDown, Download,
  CheckCircle, XCircle, ShieldAlert, AlertTriangle, Loader2,
} from "lucide-react";

interface LoadTestKpis {
  total: number;
  completed: number;
  successCount: number;
  errorCount: number;
  rateLimitedCount: number;
  serverErrorCount: number;
  timeoutCount: number;
  otherErrorCount: number;
  flaggedCount: number;
  actionBreakdown: Record<string, number>;
  firewallLatencyP50?: number;
  firewallLatencyP95?: number;
  firewallLatencyP99?: number;
  totalRttP50?: number;
  totalRttP95?: number;
  totalRttP99?: number;
  achievedRps: number;
  achievedAcceptedRps: number;
  avgRps: number;
  peakRps: number;
  peakAcceptedRps: number;
  startedAt: number;
  elapsedMs: number;
  throughputTimeline: Array<{ second: number; count: number }>;
  acceptedTimeline: Array<{ second: number; count: number }>;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function ThroughputSparkline({ timeline, acceptedTimeline, peakRps }: { timeline: Array<{ second: number; count: number }>; acceptedTimeline?: Array<{ second: number; count: number }>; peakRps: number }) {
  if (timeline.length < 2) return null;

  const width = 400;
  const height = 100;
  const padding = { top: 8, right: 8, bottom: 30, left: 36 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxCount = Math.max(peakRps, 1);
  const maxSec = timeline[timeline.length - 1].second;
  if (maxSec === 0) return null;

  const points = timeline.map(({ second, count }) => {
    const x = padding.left + (second / maxSec) * chartW;
    const y = padding.top + chartH - (count / maxCount) * chartH;
    return `${x},${y}`;
  });

  const acceptedPoints = acceptedTimeline?.map(({ second, count }) => {
    const x = padding.left + (second / maxSec) * chartW;
    const y = padding.top + chartH - (count / maxCount) * chartH;
    return `${x},${y}`;
  });

  const yTicks = [0, Math.round(maxCount / 2), maxCount];

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-md" preserveAspectRatio="xMidYMid meet">
        {yTicks.map((v) => {
          const y = padding.top + chartH - (v / maxCount) * chartH;
          return (
            <g key={v}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="currentColor" strokeOpacity={0.1} />
              <text x={padding.left - 4} y={y + 3} textAnchor="end" className="fill-muted-foreground" fontSize="8">{v}</text>
            </g>
          );
        })}
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeOpacity={0.4}
        />
        {acceptedPoints && (
          <polyline
            points={acceptedPoints.join(" ")}
            fill="none"
            stroke="hsl(var(--chart-2))"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        )}
        <text x={padding.left + chartW / 2} y={height - 2} textAnchor="middle" className="fill-muted-foreground" fontSize="8">
          Time (seconds)
        </text>
        <text x={2} y={padding.top + chartH / 2} textAnchor="middle" className="fill-muted-foreground" fontSize="8" transform={`rotate(-90, 2, ${padding.top + chartH / 2})`}>
          req/s
        </text>
      </svg>
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground pl-9">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: "hsl(var(--primary))", opacity: 0.4 }} />
          Total (incl. errors)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: "hsl(var(--chart-2))" }} />
          Accepted (HTTP 200)
        </span>
      </div>
    </div>
  );
}

function ErrorBreakdownSection({ kpis }: { kpis: LoadTestKpis }) {
  const [expanded, setExpanded] = useState(true);

  const categories = [
    { label: "429 Rate Limited", count: kpis.rateLimitedCount, color: "text-orange-600 dark:text-orange-400", dotColor: "bg-orange-500" },
    { label: "5xx Server Error", count: kpis.serverErrorCount, color: "text-red-600 dark:text-red-400", dotColor: "bg-red-500" },
    { label: "Timeout / Network", count: kpis.timeoutCount, color: "text-yellow-600 dark:text-yellow-400", dotColor: "bg-yellow-500" },
    { label: "Other", count: kpis.otherErrorCount, color: "text-muted-foreground", dotColor: "bg-muted-foreground" },
  ].filter(c => c.count > 0);

  if (categories.length === 0) return null;

  return (
    <div className="rounded-md border p-3 space-y-2" data-testid="section-error-breakdown">
      <button
        type="button"
        className="flex items-center justify-between w-full text-left"
        onClick={() => setExpanded(!expanded)}
        data-testid="button-toggle-error-breakdown"
      >
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <XCircle className="w-3 h-3" />
          Error Breakdown
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="space-y-1.5">
          {categories.map(({ label, count, color, dotColor }) => (
            <div key={label} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                {label}
              </span>
              <span className={`font-medium tabular-nums ${color}`}>{count.toLocaleString()}</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-xs border-t border-border/50 pt-1">
            <span className="text-muted-foreground font-medium">Total Errors</span>
            <span className="font-semibold text-red-600 dark:text-red-400 tabular-nums">{kpis.errorCount.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}


function downloadPromptSet(prompts: string[], filename: string) {
  const content = prompts.join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface LoadTestPanelProps {
  loadedPrompts?: string[];
}

export function LoadTestPanel({ loadedPrompts }: LoadTestPanelProps) {
  const [targetCount, setTargetCount] = useState("1000");
  const [concurrency, setConcurrency] = useState("50");
  const [promptSource, setPromptSource] = useState<"generic" | "code" | "multilang" | "loaded" | "custom">(
    loadedPrompts && loadedPrompts.length > 0 ? "loaded" : "generic"
  );
  const [customPrompts, setCustomPrompts] = useState("");
  const [runStatus, setRunStatus] = useState<"idle" | "running" | "completed" | "stopped" | "failed">("idle");
  const [kpis, setKpis] = useState<LoadTestKpis | null>(null);
  const [elapsedDisplay, setElapsedDisplay] = useState(0);

  const jobIdRef = useRef<string | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppingRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const dashboardRef = useRef<HTMLDivElement>(null);

  const { credentials } = useCredentials();
  const { t } = useLanguage();
  const { toast } = useToast();

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (jobIdRef.current) {
        fetch("/api/load-test/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: jobIdRef.current }),
        }).catch(() => {});
      }
    };
  }, []);

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedDisplay(Date.now() - startTimeRef.current);
    }, 250);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedulePoll = useCallback((jobId: string) => {
    const poll = async () => {
      try {
        const r = await fetch(`/api/load-test/progress?jobId=${jobId}`);
        if (!r.ok) {
          pollTimeoutRef.current = setTimeout(poll, 1000);
          return;
        }
        const data = await r.json();

        if (data.kpis) {
          setKpis(data.kpis as LoadTestKpis);
        }

        if (data.status !== "running") {
          stopTimer();
          setRunStatus(data.status as "completed" | "stopped" | "failed");
          if (data.kpis) setKpis(data.kpis as LoadTestKpis);
          stoppingRef.current = false;
          pollTimeoutRef.current = null;
          return;
        }
      } catch {
        // transient error, keep polling
      }
      pollTimeoutRef.current = setTimeout(poll, 1000);
    };
    pollTimeoutRef.current = setTimeout(poll, 1000);
  }, [stopTimer]);

  const startLoadTest = useCallback(async () => {
    const { apiKey, email, apiEndpoint } = credentials || {};
    if (!apiKey) return;

    jobIdRef.current = null;
    stoppingRef.current = false;
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }

    setKpis(null);
    setRunStatus("running");
    setElapsedDisplay(0);
    startTimer();

    setTimeout(() => {
      dashboardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);

    let prompts: string[];
    if (promptSource === "loaded" && loadedPrompts && loadedPrompts.length > 0) {
      prompts = loadedPrompts;
    } else if (promptSource === "custom" && customPrompts.trim()) {
      prompts = customPrompts.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    } else if (promptSource === "code") {
      prompts = CODE_DEV_PROMPTS;
    } else if (promptSource === "multilang") {
      prompts = MIXED_LANG_PROMPTS;
    } else {
      prompts = GENERIC_TEXT_PROMPTS;
    }

    try {
      const response = await fetch("/api/load-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompts,
          targetCount: parseInt(targetCount, 10) || 1000,
          concurrency: parseInt(concurrency, 10) || 50,
          aimApiKey: apiKey,
          aimUserEmail: email,
          aimApiEndpoint: apiEndpoint || "aim",
        }),
      });

      if (!response.ok) {
        stopTimer();
        setRunStatus("failed");
        toast({ title: "Load test failed", description: `Server returned ${response.status}`, variant: "destructive" });
        return;
      }

      const { jobId } = await response.json();
      jobIdRef.current = jobId;
      schedulePoll(jobId);
    } catch (error) {
      stopTimer();
      setRunStatus("failed");
      toast({ title: "Load test failed", description: String(error), variant: "destructive" });
    }
  }, [credentials, targetCount, concurrency, promptSource, customPrompts, loadedPrompts, toast, startTimer, stopTimer, schedulePoll]);

  const stopLoadTest = useCallback(() => {
    stoppingRef.current = true;
    if (jobIdRef.current) {
      fetch("/api/load-test/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: jobIdRef.current }),
      }).catch(() => {});
    }
  }, []);

  const resetTest = useCallback(() => {
    stopTimer();
    stoppingRef.current = false;
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    jobIdRef.current = null;
    setRunStatus("idle");
    setKpis(null);
    setElapsedDisplay(0);
  }, [stopTimer]);

  const downloadReport = useCallback(() => {
    if (!kpis) return;
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date(kpis.startedAt);
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

    const csvField = (v: string | number | null | undefined): string => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csvRow = (cols: (string | number | null | undefined)[]) => cols.map(csvField).join(",");

    const successRatePct = kpis.completed > 0 ? Math.round((kpis.successCount / kpis.completed) * 10000) / 100 : 0;
    const errorRatePct = kpis.completed > 0 ? Math.round((kpis.errorCount / kpis.completed) * 10000) / 100 : 0;
    const flaggedRatePct = kpis.successCount > 0 ? Math.round((kpis.flaggedCount / kpis.successCount) * 10000) / 100 : 0;
    const durationSec = Math.round(kpis.elapsedMs / 100) / 10;
    const exactDurationSec = kpis.elapsedMs / 1000;

    const summaryHeader = csvRow([
      "Date", "Time", "Run Status", "Endpoint", "Prompt Category", "Concurrency", "Total Requests", "Completed",
      "Success", "Success Rate %", "Errors", "Error Rate %",
      "Rate Limited (429)", "Server Errors (5xx)", "Timeouts", "Other Errors",
      "Flagged", "Flagged Rate %", "Avg Total RPS", "Peak Total RPS",
      "Avg Accepted RPS", "Peak Accepted RPS", "Duration (s)",
      "FW Latency P50 (ms)", "FW Latency P95 (ms)", "FW Latency P99 (ms)",
      "Total RTT P50 (ms)", "Total RTT P95 (ms)", "Total RTT P99 (ms)",
      "Blocked", "Redacted", "Monitored", "Allowed",
    ]);

    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const avgAcceptedRps = exactDurationSec > 0 ? Math.round((kpis.successCount / exactDurationSec) * 10) / 10 : 0;
    const summaryValues = csvRow([
      dateStr, timeStr, runStatus,
      credentials?.apiEndpoint || "aim",
      promptSource,
      parseInt(concurrency, 10) || 50,
      kpis.total, kpis.completed,
      kpis.successCount, successRatePct,
      kpis.errorCount, errorRatePct,
      kpis.rateLimitedCount, kpis.serverErrorCount, kpis.timeoutCount, kpis.otherErrorCount,
      kpis.flaggedCount, flaggedRatePct,
      kpis.avgRps, kpis.peakRps,
      avgAcceptedRps, kpis.peakAcceptedRps, durationSec,
      kpis.firewallLatencyP50 ?? "", kpis.firewallLatencyP95 ?? "", kpis.firewallLatencyP99 ?? "",
      kpis.totalRttP50 ?? "", kpis.totalRttP95 ?? "", kpis.totalRttP99 ?? "",
      kpis.actionBreakdown?.block_action ?? 0,
      kpis.actionBreakdown?.anonymize_action ?? 0,
      kpis.actionBreakdown?.monitor_action ?? 0,
      kpis.actionBreakdown?.none ?? 0,
    ]);

    const timelineHeader = csvRow(["Second", "Total RPS", "Accepted RPS"]);
    const maxSec = Math.max(
      kpis.throughputTimeline.length > 0 ? kpis.throughputTimeline[kpis.throughputTimeline.length - 1].second : 0,
      kpis.acceptedTimeline.length > 0 ? kpis.acceptedTimeline[kpis.acceptedTimeline.length - 1].second : 0,
    );
    const totalMap = new Map(kpis.throughputTimeline.map(r => [r.second, r.count]));
    const acceptedMap = new Map(kpis.acceptedTimeline.map(r => [r.second, r.count]));
    const timelineRows = Array.from({ length: maxSec + 1 }, (_, s) =>
      csvRow([s, totalMap.get(s) ?? 0, acceptedMap.get(s) ?? 0])
    );

    const csv = [summaryHeader, summaryValues, "", timelineHeader, ...timelineRows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `load-test-report-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [kpis, runStatus, targetCount, concurrency, promptSource, credentials]);

  const downloadJsonReport = useCallback(() => {
    if (!kpis) return;
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date(kpis.startedAt);
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

    const durationSec = kpis.elapsedMs / 1000;
    const avgAcceptedRps = durationSec > 0 ? Math.round((kpis.successCount / durationSec) * 10) / 10 : 0;
    const report = {
      generatedAt: new Date().toISOString(),
      runStatus,
      config: {
        targetCount: parseInt(targetCount, 10) || 1000,
        concurrency: parseInt(concurrency, 10) || 50,
        promptSource,
        endpoint: credentials?.apiEndpoint || "aim",
      },
      summary: {
        startedAt: kpis.startedAt,
        durationMs: kpis.elapsedMs,
        completed: kpis.completed,
        successCount: kpis.successCount,
        successRatePct: kpis.completed > 0 ? Math.round((kpis.successCount / kpis.completed) * 10000) / 100 : 0,
        errorCount: kpis.errorCount,
        errorRatePct: kpis.completed > 0 ? Math.round((kpis.errorCount / kpis.completed) * 10000) / 100 : 0,
        rateLimitedCount: kpis.rateLimitedCount,
        serverErrorCount: kpis.serverErrorCount,
        timeoutCount: kpis.timeoutCount,
        otherErrorCount: kpis.otherErrorCount,
        flaggedCount: kpis.flaggedCount,
        flaggedRatePct: kpis.successCount > 0 ? Math.round((kpis.flaggedCount / kpis.successCount) * 10000) / 100 : 0,
        avgTotalRps: kpis.avgRps,
        peakTotalRps: kpis.peakRps,
        avgAcceptedRps,
        peakAcceptedRps: kpis.peakAcceptedRps,
        actionBreakdown: kpis.actionBreakdown,
      },
      latency: {
        firewallP50Ms: kpis.firewallLatencyP50 ?? null,
        firewallP95Ms: kpis.firewallLatencyP95 ?? null,
        firewallP99Ms: kpis.firewallLatencyP99 ?? null,
        totalRttP50Ms: kpis.totalRttP50 ?? null,
        totalRttP95Ms: kpis.totalRttP95 ?? null,
        totalRttP99Ms: kpis.totalRttP99 ?? null,
      },
      timeline: {
        totalRps: kpis.throughputTimeline,
        acceptedRps: kpis.acceptedTimeline,
      },
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `load-test-report-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [kpis, runStatus, targetCount, concurrency, promptSource, credentials]);

  const isIdle = runStatus === "idle";
  const isRunning = runStatus === "running";
  const isDone = runStatus === "completed" || runStatus === "stopped" || runStatus === "failed";
  const progressPct = kpis ? Math.round((kpis.completed / Math.max(1, kpis.total)) * 100) : 0;
  const errorRate = kpis && kpis.completed > 0 ? Math.round((kpis.errorCount / kpis.completed) * 10000) / 100 : 0;

  const actionColors: Record<string, string> = {
    block_action: "bg-red-500",
    anonymize_action: "bg-amber-400",
    monitor_action: "bg-blue-400",
    none: "bg-green-500",
  };

  const actionLabels: Record<string, string> = {
    block_action: "Blocked",
    anonymize_action: "Redacted",
    monitor_action: "Monitored",
    none: "Allowed",
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 sm:py-6">
      <div className="max-w-5xl mx-auto space-y-4">

        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2" data-testid="text-load-test-title">
            <Zap className="w-5 h-5" />
            Load Test
          </h2>
          <p className="text-sm text-muted-foreground">
            Stress test your AI Firewall to find its throughput limits. Prompts are cycled automatically to reach your target count.
          </p>
        </div>

        {isIdle && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Total Requests</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100000}
                    value={targetCount}
                    onChange={(e) => setTargetCount(e.target.value)}
                    data-testid="input-target-count"
                  />
                  <span className="text-[10px] text-muted-foreground">Max: 100,000</span>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Concurrency</Label>
                  <Input
                    type="number"
                    min={1}
                    max={2000}
                    value={concurrency}
                    onChange={(e) => setConcurrency(e.target.value)}
                    data-testid="input-concurrency"
                  />
                  <span className="text-[10px] text-muted-foreground">Max: 2,000 concurrent workers</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Prompt Source</Label>
                <div className="flex items-center gap-3 flex-wrap">
                  {loadedPrompts && loadedPrompts.length > 0 && (
                    <Button
                      variant={promptSource === "loaded" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPromptSource("loaded")}
                      data-testid="button-prompt-loaded"
                    >
                      Loaded Prompts ({loadedPrompts.length})
                    </Button>
                  )}
                  <div className="flex items-center gap-1">
                    <Button
                      variant={promptSource === "generic" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPromptSource("generic")}
                      data-testid="button-prompt-generic"
                    >
                      Generic Text ({GENERIC_TEXT_PROMPTS.length})
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => downloadPromptSet(GENERIC_TEXT_PROMPTS, "load-test-generic-text-prompts.txt")}
                      data-testid="button-download-generic-prompts"
                      title="Download Generic Text prompts"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant={promptSource === "code" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPromptSource("code")}
                      data-testid="button-prompt-code"
                    >
                      Code and Development ({CODE_DEV_PROMPTS.length})
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => downloadPromptSet(CODE_DEV_PROMPTS, "load-test-code-dev-prompts.txt")}
                      data-testid="button-download-code-prompts"
                      title="Download Code and Development prompts"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant={promptSource === "multilang" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPromptSource("multilang")}
                      data-testid="button-prompt-multilang"
                    >
                      Mixed Language ({MIXED_LANG_PROMPTS.length})
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => downloadPromptSet(MIXED_LANG_PROMPTS, "load-test-mixed-lang-prompts.txt")}
                      data-testid="button-download-multilang-prompts"
                      title="Download Mixed Language prompts"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <Button
                    variant={promptSource === "custom" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPromptSource("custom")}
                    data-testid="button-prompt-custom"
                  >
                    Custom Prompts
                  </Button>
                </div>
                {promptSource === "loaded" && loadedPrompts && (
                  <p className="text-[10px] text-muted-foreground">
                    {loadedPrompts.length} loaded prompts from Batch Analysis will be cycled to reach the target count
                  </p>
                )}
                {promptSource === "generic" && (
                  <p className="text-[10px] text-muted-foreground">
                    {GENERIC_TEXT_PROMPTS.length} prompts with PII, general enquiries, and mixed sensitive content
                  </p>
                )}
                {promptSource === "code" && (
                  <p className="text-[10px] text-muted-foreground">
                    {CODE_DEV_PROMPTS.length} prompts with API keys, secrets, credentials, and code review scenarios
                  </p>
                )}
                {promptSource === "multilang" && (
                  <p className="text-[10px] text-muted-foreground">
                    {MIXED_LANG_PROMPTS.length} prompts in English, German, Japanese, Spanish, and French
                  </p>
                )}
                {promptSource === "custom" && (
                  <div className="space-y-1">
                    <Textarea
                      value={customPrompts}
                      onChange={(e) => setCustomPrompts(e.target.value)}
                      placeholder="Enter one prompt per line. These will be cycled to reach the target count."
                      className="text-sm min-h-[80px]"
                      data-testid="textarea-custom-prompts"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {customPrompts.split("\n").filter(l => l.trim()).length} prompt(s) entered
                    </p>
                  </div>
                )}
              </div>

              <div className="rounded-md bg-blue-50 dark:bg-blue-950 p-3 text-sm space-y-1">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-blue-800 dark:text-blue-200">
                      Each worker sends a request, waits for the response, then immediately sends the next one.
                      Actual throughput is determined entirely by the AI Firewall's response time.
                      At {parseInt(concurrency, 10) || 50} concurrent workers and a 50ms firewall response, estimated peak is{" "}
                      <strong>{(parseInt(concurrency, 10) || 50) * 20} req/s</strong>.
                      Duration depends on how quickly the firewall responds.
                    </p>
                  </div>
                </div>
              </div>

              <Button
                onClick={startLoadTest}
                disabled={!credentials?.apiKey || (promptSource === "custom" && !customPrompts.trim())}
                data-testid="button-start-load-test"
              >
                <Play className="w-4 h-4 mr-2" />
                Start Load Test
              </Button>
            </CardContent>
          </Card>
        )}

        {(isRunning || isDone) && (
          <div ref={dashboardRef} className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  {isRunning && <Loader2 className="w-4 h-4 animate-spin" />}
                  {runStatus === "completed" && <CheckCircle className="w-4 h-4 text-green-600" />}
                  {runStatus === "stopped" && <Square className="w-4 h-4 text-amber-500" />}
                  {runStatus === "failed" && <XCircle className="w-4 h-4 text-red-500" />}
                  Load Test {isRunning ? "Running" : runStatus === "completed" ? "Complete" : runStatus === "stopped" ? "Stopped" : "Failed"}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {isRunning && (
                    <Button variant="destructive" size="sm" onClick={stopLoadTest} data-testid="button-stop-load-test">
                      <Square className="w-3 h-3 mr-1" /> Stop
                    </Button>
                  )}
                  {isDone && (
                    <Button variant="outline" size="sm" onClick={resetTest} data-testid="button-reset-load-test">
                      New Test
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{kpis?.completed.toLocaleString() || 0} / {kpis?.total.toLocaleString() || targetCount} requests</span>
                    <span>{progressPct}%</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>{formatDuration(kpis?.elapsedMs || elapsedDisplay)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-md border p-3 space-y-1">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Accepted RPS (5s)</div>
                    <div className="text-2xl font-bold text-foreground" data-testid="text-achieved-rps">
                      {kpis?.achievedAcceptedRps.toFixed(1) || "0.0"}
                    </div>
                    <div className="text-[10px] text-muted-foreground">AI-FW processed</div>
                    <div className="text-[9px] text-muted-foreground">Total incl. 429s: {kpis?.achievedRps.toFixed(1) || "0.0"}</div>
                  </div>
                  <div className="rounded-md border p-3 space-y-1">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Peak Accepted RPS</div>
                    <div className="text-2xl font-bold text-foreground" data-testid="text-peak-rps">
                      {kpis?.peakAcceptedRps || 0}
                    </div>
                    <div className="text-[10px] text-muted-foreground">AI-FW processed</div>
                    <div className="text-[9px] text-muted-foreground">Total peak: {kpis?.peakRps || 0}</div>
                  </div>
                  <div className="rounded-md border p-3 space-y-1">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Success Rate</div>
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-success-rate">
                      {kpis && kpis.completed > 0 ? (100 - errorRate).toFixed(1) : "0.0"}%
                    </div>
                  </div>
                  <div className="rounded-md border p-3 space-y-1">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Errors</div>
                    <div className={`text-2xl font-bold ${kpis && kpis.errorCount > 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}`} data-testid="text-error-count">
                      {kpis?.errorCount.toLocaleString() || 0}
                    </div>
                  </div>
                </div>

                {kpis && kpis.errorCount > 0 && (
                  <ErrorBreakdownSection kpis={kpis} />
                )}

                {kpis && kpis.completed > 0 && kpis.rateLimitedCount / kpis.completed > 0.5 && (
                  <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 space-y-2" data-testid="callout-rate-limit">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                      <div className="space-y-1.5 text-xs text-foreground">
                        <div className="font-semibold">High rate-limit rejection rate: {kpis.rateLimitedCount.toLocaleString()} of {kpis.completed.toLocaleString()} requests received HTTP 429 ({((kpis.rateLimitedCount / kpis.completed) * 100).toFixed(0)}%)</div>
                        <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                          <li>Most requests are receiving HTTP 429 (Too Many Requests) from the AI Firewall before being inspected.</li>
                          <li>The AI Firewall dashboard will show fewer invocations than this load tester reports, because rejected requests are not processed.</li>
                          <li>The spiky throughput chart is typical of rate limiting: 429 responses return almost instantly, inflating apparent RPS.</li>
                          <li>To achieve higher sustained throughput, a higher rate-limit tier is needed on the API key.</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-md border p-3 space-y-2">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Firewall Latency</div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-xs text-muted-foreground">P50</div>
                        <div className="text-sm font-semibold text-green-600 dark:text-green-400" data-testid="text-fw-p50">
                          {kpis?.firewallLatencyP50 !== undefined ? `${kpis.firewallLatencyP50}ms` : "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">P95</div>
                        <div className="text-sm font-semibold text-green-600 dark:text-green-400" data-testid="text-fw-p95">
                          {kpis?.firewallLatencyP95 !== undefined ? `${kpis.firewallLatencyP95}ms` : "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">P99</div>
                        <div className="text-sm font-semibold text-green-600 dark:text-green-400" data-testid="text-fw-p99">
                          {kpis?.firewallLatencyP99 !== undefined ? `${kpis.firewallLatencyP99}ms` : "--"}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-md border p-3 space-y-2">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Round-Trip Time</div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-xs text-muted-foreground">P50</div>
                        <div className="text-sm font-semibold text-foreground" data-testid="text-rtt-p50">
                          {kpis?.totalRttP50 !== undefined ? `${kpis.totalRttP50}ms` : "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">P95</div>
                        <div className="text-sm font-semibold text-foreground" data-testid="text-rtt-p95">
                          {kpis?.totalRttP95 !== undefined ? `${kpis.totalRttP95}ms` : "--"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">P99</div>
                        <div className="text-sm font-semibold text-foreground" data-testid="text-rtt-p99">
                          {kpis?.totalRttP99 !== undefined ? `${kpis.totalRttP99}ms` : "--"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {kpis && kpis.completed > 0 && (
                  <div className="rounded-md border p-3 space-y-2">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Action Distribution</div>
                    <div className="flex h-4 rounded-md overflow-hidden gap-px">
                      {Object.entries(kpis.actionBreakdown)
                        .filter(([, v]) => v > 0)
                        .map(([action, count]) => (
                          <div
                            key={action}
                            className={`${actionColors[action] || "bg-muted"} transition-all duration-300`}
                            style={{ width: `${(count / Math.max(1, kpis.successCount)) * 100}%` }}
                            title={`${actionLabels[action] || action}: ${count}`}
                          />
                        ))}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {Object.entries(kpis.actionBreakdown)
                        .filter(([, v]) => v > 0)
                        .map(([action, count]) => (
                          <div key={action} className="flex items-center gap-1.5 text-xs">
                            <div className={`w-2 h-2 rounded-sm ${actionColors[action] || "bg-muted"}`} />
                            <span className="text-muted-foreground">{actionLabels[action] || action}: {count.toLocaleString()}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {kpis && kpis.throughputTimeline.length >= 2 && (
                  <div className="rounded-md border p-3 space-y-2">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Throughput Over Time</div>
                    <div className="text-[10px] text-muted-foreground">Workers fire continuously with no artificial delays; actual throughput is set by the AI Firewall's response time. Total RPS includes 429 rate-limit rejections (which return in ~5ms and inflate the total line). Accepted RPS shows only successfully inspected requests.</div>
                    <ThroughputSparkline timeline={kpis.throughputTimeline} acceptedTimeline={kpis.acceptedTimeline} peakRps={kpis.peakRps} />
                  </div>
                )}

                {isDone && kpis && (
                  <Card className="border-2 border-primary/20">
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                          <Activity className="w-4 h-4" />
                          Summary
                        </h3>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={downloadReport}
                            data-testid="button-download-report"
                          >
                            <Download className="w-3.5 h-3.5 mr-1.5" />
                            Download CSV
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={downloadJsonReport}
                            data-testid="button-download-json-report"
                          >
                            <Download className="w-3.5 h-3.5 mr-1.5" />
                            Download JSON
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">Total Completed</div>
                          <div className="font-semibold" data-testid="text-summary-completed">{kpis.completed.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Duration</div>
                          <div className="font-semibold">{formatDuration(kpis.elapsedMs)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Avg Total RPS</div>
                          <div className="font-semibold">{kpis.avgRps.toFixed(1)} req/s</div>
                          <div className="text-[9px] text-muted-foreground">(incl. rate-limited)</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Peak Accepted RPS</div>
                          <div className="font-semibold">{kpis.peakAcceptedRps} req/s</div>
                          <div className="text-[9px] text-muted-foreground">Total: {kpis.peakRps} req/s</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Flagged</div>
                          <div className="font-semibold">{kpis.flaggedCount.toLocaleString()} ({kpis.completed > 0 ? ((kpis.flaggedCount / kpis.completed) * 100).toFixed(1) : 0}%)</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Errors</div>
                          <div className={`font-semibold ${kpis.errorCount > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{kpis.errorCount.toLocaleString()} ({errorRate}%)</div>
                          {kpis.errorCount > 0 && (
                            <div className="text-[10px] text-muted-foreground mt-0.5 space-y-0">
                              {kpis.rateLimitedCount > 0 && <div>429: {kpis.rateLimitedCount.toLocaleString()}</div>}
                              {kpis.serverErrorCount > 0 && <div>5xx: {kpis.serverErrorCount.toLocaleString()}</div>}
                              {kpis.timeoutCount > 0 && <div>Timeout: {kpis.timeoutCount.toLocaleString()}</div>}
                              {kpis.otherErrorCount > 0 && <div>Other: {kpis.otherErrorCount.toLocaleString()}</div>}
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">FW Latency P50</div>
                          <div className="font-semibold text-green-600 dark:text-green-400">{kpis.firewallLatencyP50 !== undefined ? `${kpis.firewallLatencyP50}ms` : "--"}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">FW Latency P99</div>
                          <div className="font-semibold text-green-600 dark:text-green-400">{kpis.firewallLatencyP99 !== undefined ? `${kpis.firewallLatencyP99}ms` : "--"}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
