import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  Clock,
  Copy,
  Cog,
  Shield,
  AlertTriangle,
  GitMerge,
  ChevronRight,
  Search,
  X,
  Pin,
  Link2,
  Send,
  Zap,
} from "lucide-react";
import { useCredentials } from "@/contexts/credentials-context";
import { useLanguage } from "@/contexts/language-context";
import { SessionInspector } from "@/components/session-inspector";
import { getEndpointLabel as getSharedEndpointLabel } from "@/lib/endpoint-utils";

type SessionOutcome = "blocked" | "redacted" | "allowed" | "mixed" | "error";
type ThreatFilter = "all" | "any" | "pii" | "phi" | "jailbreak" | "secrets" | "pci";
type SortOrder = "newest" | "oldest" | "severity" | "stages";
type TimeWindow = "15m" | "1h" | "6h" | "all";

type SessionStage = {
  id: string;
  timestamp: Date;
  userMessage: string;
  status: "blocked" | "redacted" | "allowed";
  threatsDetected: string[];
  actionTaken: string;
  aimResponse: Record<string, unknown> | null;
  tier?: string;
  tierLabel?: string;
  stage?: string;
  stageLabel?: string;
  sequence?: number;
  sessionId?: string;
  toolName?: string;
};

type SessionGroup = {
  sessionId: string;
  stages: SessionStage[];
  firstTimestamp: Date;
  lastTimestamp: Date;
  overallStatus: SessionOutcome;
  blockedCount: number;
  redactedCount: number;
  allowedCount: number;
  errorCount: number;
  promptCount: number;
  hasToolStages: boolean;
};

type DiagStatus = "idle" | "running" | "ok" | "error";

interface DiagResult {
  status: DiagStatus;
  latencyMs?: number;
  error?: string;
  timestamp?: Date;
  endpoint?: string;
}

interface ConfigDiagResult {
  status: DiagStatus;
  timestamp?: Date;
}

type LiveTestStage = {
  stageName: string;
  stage: string;
  status: "allowed" | "blocked" | "redacted";
  actionTaken: string;
  actionKey: string;
  threatsDetected: string[];
  aimResponse: Record<string, unknown> | null;
  durationMs: number;
};

interface TroubleshootingPanelProps {
  groupedSessions: SessionGroup[];
  onLiveTestSession?: (message: string, stages: LiveTestStage[]) => void;
}

const SESSION_ID_PREFIX = "session-";
const CONCURRENCY_SETTINGS = "Max 10 concurrent / 20 RPS / 1200 RPM";
const MAX_SPARKLINE = 8;

function threatMatchesFilter(threats: string[], filter: ThreatFilter): boolean {
  if (filter === "all") return true;
  if (filter === "any") return threats.length > 0;
  const combined = threats.join(" ").toLowerCase();
  if (filter === "pii") return /pii|personal|ssn|email|phone|address|\bname\b/.test(combined);
  if (filter === "phi") return /phi|health|medical|hipaa/.test(combined);
  if (filter === "jailbreak") return /jailbreak|injection/.test(combined);
  if (filter === "secrets") return /secret|api.?key|token|password|credential/.test(combined);
  if (filter === "pci") return /pci|credit.?card|card.?number|payment|ccn/.test(combined);
  return true;
}

function severityScore(s: SessionGroup): number {
  return s.blockedCount * 100 + s.redactedCount * 10 + s.errorCount;
}

export function TroubleshootingPanel({ groupedSessions, onLiveTestSession }: TroubleshootingPanelProps) {
  const { t } = useLanguage();
  const { credentials } = useCredentials();

  const [outcomeFilter, setOutcomeFilter] = useState<"all" | SessionOutcome>("all");
  const [firewallDiag, setFirewallDiag] = useState<DiagResult>({ status: "idle" });
  const [openaiDiag, setOpenaiDiag] = useState<DiagResult>({ status: "idle" });
  const [configDiag, setConfigDiag] = useState<ConfigDiagResult>({ status: "idle" });
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);
  const [configCopied, setConfigCopied] = useState(false);
  const [selectedSession, setSelectedSession] = useState<SessionGroup | null>(null);
  const [sessionSearch, setSessionSearch] = useState("");

  const [threatFilter, setThreatFilter] = useState<ThreatFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [pinnedSessions, setPinnedSessions] = useState<Set<string>>(new Set());
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("all");
  const [firewallHistory, setFirewallHistory] = useState<DiagResult[]>([]);
  const [openaiHistory, setOpenaiHistory] = useState<DiagResult[]>([]);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linkCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRunRef = useRef(false);
  const deepLinkRef = useRef(false);

  // Live test bar state
  const [liveTestInput, setLiveTestInput] = useState("");
  const [liveTestStatus, setLiveTestStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [liveTestResults, setLiveTestResults] = useState<{
    direct: { response: string | null; latencyMs: number; outcome: string; error: string | null };
    firewall: { response: string | null; latencyMs: number; outcome: string; actionTaken?: string; stages?: LiveTestStage[]; sessionId?: string | null; error: string | null };
  } | null>(null);
  const liveTestInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoRunRef.current) return;
    autoRunRef.current = true;
    runFirewallDiag();
    runOpenaiDiag();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (deepLinkRef.current) return;
    if (groupedSessions.length === 0) return;
    deepLinkRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("session");
    if (sid) {
      const found = groupedSessions.find((s) => s.sessionId === sid);
      if (found) setSelectedSession(found);
    }
  }, [groupedSessions]);

  const filteredSessions = useMemo(() => {
    const now = Date.now();
    const windowMs: Record<TimeWindow, number> = {
      "15m": 15 * 60 * 1000,
      "1h": 60 * 60 * 1000,
      "6h": 6 * 60 * 60 * 1000,
      "all": Infinity,
    };
    const cutoff = timeWindow === "all" ? 0 : now - windowMs[timeWindow];

    let list = groupedSessions.filter((s) => {
      // Outcome filter
      if (outcomeFilter !== "all" && s.overallStatus !== outcomeFilter) return false;
      // Threat filter
      if (threatFilter !== "all") {
        const hasMatch = s.stages.some((st) => threatMatchesFilter(st.threatsDetected, threatFilter));
        if (!hasMatch) return false;
      }
      // Time window
      if (timeWindow !== "all" && s.firstTimestamp.getTime() < cutoff) return false;
      // Keyword search
      if (sessionSearch.trim()) {
        const q = sessionSearch.trim().toLowerCase();
        if (!s.stages.some((st) => (st.userMessage || "").toLowerCase().includes(q))) return false;
      }
      return true;
    });

    // Sort
    list = [...list].sort((a, b) => {
      switch (sortOrder) {
        case "oldest":
          return a.firstTimestamp.getTime() - b.firstTimestamp.getTime();
        case "severity":
          return severityScore(b) - severityScore(a);
        case "stages":
          return b.stages.length - a.stages.length;
        default: // newest
          return b.lastTimestamp.getTime() - a.lastTimestamp.getTime();
      }
    });

    // Pinned sessions float to top
    const pinned = list.filter((s) => pinnedSessions.has(s.sessionId));
    const unpinned = list.filter((s) => !pinnedSessions.has(s.sessionId));
    return [...pinned, ...unpinned];
  }, [groupedSessions, outcomeFilter, threatFilter, timeWindow, sessionSearch, sortOrder, pinnedSessions]);

  const getEndpointLabel = () => getSharedEndpointLabel(credentials?.apiEndpoint || "aim");

  const copySessionId = (sessionId: string) => {
    navigator.clipboard.writeText(sessionId).catch(() => {});
    setCopiedSessionId(sessionId);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopiedSessionId(null), 2000);
  };

  const copySessionLink = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    const url = new URL(window.location.href);
    url.searchParams.set("session", sessionId);
    history.pushState(null, "", url.toString());
    navigator.clipboard.writeText(url.toString()).catch(() => {});
    setCopiedLinkId(sessionId);
    if (linkCopyTimeoutRef.current) clearTimeout(linkCopyTimeoutRef.current);
    linkCopyTimeoutRef.current = setTimeout(() => setCopiedLinkId(null), 2000);
  };

  const togglePin = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setPinnedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const copyConfig = () => {
    const snapshot = [
      `${t("troubleshooting.diagnostics.config.endpoint")}: ${getEndpointLabel()}`,
      `${t("troubleshooting.diagnostics.config.email")}: ${credentials?.email || t("troubleshooting.diagnostics.config.notConfigured")}`,
      `${t("troubleshooting.diagnostics.config.sessionIdPrefix")}: ${SESSION_ID_PREFIX}`,
      `${t("troubleshooting.diagnostics.config.concurrency")}: ${CONCURRENCY_SETTINGS}`,
    ].join("\n");
    navigator.clipboard.writeText(snapshot).catch(() => {});
    setConfigCopied(true);
    if (configCopyTimeoutRef.current) clearTimeout(configCopyTimeoutRef.current);
    configCopyTimeoutRef.current = setTimeout(() => setConfigCopied(false), 2000);
  };

  const runFirewallDiag = async () => {
    if (!credentials) {
      const result: DiagResult = { status: "error", error: t("troubleshooting.diagnostics.noCredentials"), timestamp: new Date() };
      setFirewallDiag(result);
      setFirewallHistory((prev) => [...prev, result].slice(-MAX_SPARKLINE));
      return;
    }
    setFirewallDiag({ status: "running" });
    try {
      const res = await fetch("/api/diagnostics/firewall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aimApiKey: credentials.apiKey,
          aimUserEmail: credentials.email,
          aimApiEndpoint: credentials.apiEndpoint || "aim",
        }),
      });
      const data = await res.json();
      const result: DiagResult = {
        status: data.ok ? "ok" : "error",
        latencyMs: data.latencyMs,
        error: data.error,
        timestamp: new Date(),
        endpoint: data.endpoint,
      };
      setFirewallDiag(result);
      setFirewallHistory((prev) => [...prev, result].slice(-MAX_SPARKLINE));
    } catch {
      const result: DiagResult = { status: "error", error: "Request failed", timestamp: new Date() };
      setFirewallDiag(result);
      setFirewallHistory((prev) => [...prev, result].slice(-MAX_SPARKLINE));
    }
  };

  const runOpenaiDiag = async () => {
    setOpenaiDiag({ status: "running" });
    try {
      const res = await fetch("/api/diagnostics/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openaiApiKey: credentials?.openaiApiKey }),
      });
      const data = await res.json();
      const result: DiagResult = {
        status: data.ok ? "ok" : "error",
        latencyMs: data.latencyMs,
        error: data.error,
        timestamp: new Date(),
      };
      setOpenaiDiag(result);
      setOpenaiHistory((prev) => [...prev, result].slice(-MAX_SPARKLINE));
    } catch {
      const result: DiagResult = { status: "error", error: "Request failed", timestamp: new Date() };
      setOpenaiDiag(result);
      setOpenaiHistory((prev) => [...prev, result].slice(-MAX_SPARKLINE));
    }
  };

  const runConfigDiag = () => {
    setConfigDiag({ status: "running" });
    setTimeout(() => {
      setConfigDiag({
        status: credentials ? "ok" : "error",
        timestamp: new Date(),
      });
    }, 300);
  };

  const runLiveTest = useCallback(async () => {
    const msg = liveTestInput.trim();
    if (!msg || liveTestStatus === "running") return;
    setLiveTestStatus("running");
    setLiveTestResults(null);
    try {
      const liveTestBody: Record<string, unknown> = {
        message: msg,
        aimApiKey: credentials?.apiKey,
        aimUserEmail: credentials?.email,
        aimApiEndpoint: credentials?.apiEndpoint || "aim",
        openaiApiKey: credentials?.openaiApiKey,
      };
      if (credentials?.llmProvider === "local" && credentials.llmBaseUrl) {
        liveTestBody.llmProvider = "local";
        liveTestBody.llmBaseUrl = credentials.llmBaseUrl;
        liveTestBody.llmModel = credentials.llmModel;
      }
      const res = await fetch("/api/live-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(liveTestBody),
      });
      if (!res.ok) {
        setLiveTestStatus("error");
        return;
      }
      const data = await res.json();
      setLiveTestResults(data);
      setLiveTestStatus("done");
      const stages: LiveTestStage[] = data?.firewall?.stages ?? [];
      if (onLiveTestSession && stages.length > 0) {
        onLiveTestSession(msg, stages);
      }
    } catch {
      setLiveTestStatus("error");
    }
  }, [liveTestInput, liveTestStatus, credentials, onLiveTestSession]);

  const isAnyDiagRunning =
    firewallDiag.status === "running" ||
    openaiDiag.status === "running";

  const runAllDiagnostics = () => {
    runFirewallDiag();
    runOpenaiDiag();
    runConfigDiag();
  };

  const formatTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const outcomeBadgeClass = (status: SessionOutcome) => {
    if (status === "blocked") return "bg-destructive/10 text-destructive border-destructive/30";
    if (status === "redacted") return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30";
    if (status === "error") return "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30";
    if (status === "mixed") return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30";
    return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30";
  };

  const outcomeLabel = (status: SessionOutcome) => {
    if (status === "blocked") return t("troubleshooting.sessionHistory.filterBlocked");
    if (status === "redacted") return t("troubleshooting.sessionHistory.filterRedacted");
    if (status === "error") return t("troubleshooting.sessionHistory.filterError");
    if (status === "mixed") return t("troubleshooting.sessionHistory.filterMixed");
    return t("troubleshooting.sessionHistory.filterAllowed");
  };

  const diagStatusIcon = (status: DiagStatus) => {
    if (status === "idle") return <Clock className="w-4 h-4 text-muted-foreground" />;
    if (status === "running") return <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />;
    if (status === "ok") return <CheckCircle className="w-4 h-4 text-green-500" />;
    return <XCircle className="w-4 h-4 text-destructive" />;
  };

  const Sparkline = ({ history }: { history: DiagResult[] }) => {
    const completed = history.filter((r) => r.status === "ok" || r.status === "error");
    if (completed.length < 2) return null;
    const latencies = completed.map((r) => r.latencyMs ?? 0);
    const maxMs = Math.max(...latencies, 1);
    const BAR_H = 20;
    return (
      <div className="flex items-end gap-0.5 mt-1" aria-label={t("troubleshooting.diagnostics.latencyHistory")} title={t("troubleshooting.diagnostics.latencyHistory")}>
        {completed.map((r, i) => {
          const h = Math.max(3, Math.round(((r.latencyMs ?? 0) / maxMs) * BAR_H));
          return (
            <div
              key={i}
              title={r.latencyMs != null ? `${r.latencyMs}ms` : "error"}
              style={{ height: `${h}px`, width: "6px" }}
              className={`rounded-sm flex-shrink-0 ${r.status === "ok" ? "bg-green-500" : "bg-destructive"}`}
            />
          );
        })}
      </div>
    );
  };

  const filterKeys: { value: "all" | SessionOutcome; labelKey: string }[] = [
    { value: "all", labelKey: "troubleshooting.sessionHistory.filterAll" },
    { value: "blocked", labelKey: "troubleshooting.sessionHistory.filterBlocked" },
    { value: "redacted", labelKey: "troubleshooting.sessionHistory.filterRedacted" },
    { value: "allowed", labelKey: "troubleshooting.sessionHistory.filterAllowed" },
    { value: "mixed", labelKey: "troubleshooting.sessionHistory.filterMixed" },
    { value: "error", labelKey: "troubleshooting.sessionHistory.filterError" },
  ];

  const threatFilterKeys: { value: ThreatFilter; labelKey: string }[] = [
    { value: "all", labelKey: "troubleshooting.sessionHistory.filterAll" },
    { value: "any", labelKey: "troubleshooting.sessionHistory.threatAny" },
    { value: "pii", labelKey: "troubleshooting.sessionHistory.threatPII" },
    { value: "phi", labelKey: "troubleshooting.sessionHistory.threatPHI" },
    { value: "jailbreak", labelKey: "troubleshooting.sessionHistory.threatJailbreak" },
    { value: "secrets", labelKey: "troubleshooting.sessionHistory.threatSecrets" },
    { value: "pci", labelKey: "troubleshooting.sessionHistory.threatPCI" },
  ];

  const sortKeys: { value: SortOrder; labelKey: string }[] = [
    { value: "newest", labelKey: "troubleshooting.sessionHistory.sortNewest" },
    { value: "oldest", labelKey: "troubleshooting.sessionHistory.sortOldest" },
    { value: "severity", labelKey: "troubleshooting.sessionHistory.sortSeverity" },
    { value: "stages", labelKey: "troubleshooting.sessionHistory.sortStages" },
  ];

  const timeWindowKeys: { value: TimeWindow; labelKey: string }[] = [
    { value: "all", labelKey: "troubleshooting.sessionHistory.timeWindowAll" },
    { value: "15m", labelKey: "troubleshooting.sessionHistory.timeWindow15m" },
    { value: "1h", labelKey: "troubleshooting.sessionHistory.timeWindow1h" },
    { value: "6h", labelKey: "troubleshooting.sessionHistory.timeWindow6h" },
  ];

  return (
    <div className="flex flex-col h-full">
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-foreground" data-testid="text-troubleshooting-title">
            {t("troubleshooting.title")}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">{t("troubleshooting.subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="flex flex-col" data-testid="card-session-history">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-base font-semibold">
                  {t("troubleshooting.sessionHistory.title")}
                </CardTitle>
                <div className="flex gap-1 flex-wrap">
                  {filterKeys.map((f) => (
                    <Button
                      key={f.value}
                      size="sm"
                      variant={outcomeFilter === f.value ? "default" : "ghost"}
                      className="h-7 text-xs px-2"
                      onClick={() => setOutcomeFilter(f.value)}
                      data-testid={`button-filter-${f.value}`}
                    >
                      {t(f.labelKey)}
                    </Button>
                  ))}
                </div>
              </div>

              {groupedSessions.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap mt-2">
                  <span className="text-[11px] text-muted-foreground mr-1 flex-shrink-0">
                    {t("troubleshooting.sessionHistory.threatFilter")}:
                  </span>
                  {threatFilterKeys.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors flex-shrink-0 ${
                        threatFilter === f.value
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-transparent text-muted-foreground border-border hover-elevate"
                      }`}
                      onClick={() => setThreatFilter(f.value)}
                      data-testid={`button-threat-filter-${f.value}`}
                    >
                      {t(f.labelKey)}
                    </button>
                  ))}
                </div>
              )}

              {groupedSessions.length > 0 && (
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <div className="flex items-center gap-1">
                    {timeWindowKeys.map((w) => (
                      <Button
                        key={w.value}
                        size="sm"
                        variant={timeWindow === w.value ? "default" : "ghost"}
                        className="h-6 text-[11px] px-2"
                        onClick={() => setTimeWindow(w.value)}
                        data-testid={`button-time-window-${w.value}`}
                      >
                        {t(w.labelKey)}
                      </Button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 ml-auto">
                    <span className="text-[11px] text-muted-foreground flex-shrink-0">
                      {t("troubleshooting.sessionHistory.sortLabel")}
                    </span>
                    <select
                      className="text-[11px] bg-transparent border border-border rounded px-1.5 py-0.5 text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
                      value={sortOrder}
                      onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                      data-testid="select-sort-order"
                    >
                      {sortKeys.map((s) => (
                        <option key={s.value} value={s.value}>
                          {t(s.labelKey)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {groupedSessions.length > 0 && (
                <div className="relative mt-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    className="pl-7 pr-7 h-8 text-xs"
                    placeholder={t("troubleshooting.sessionHistory.searchPlaceholder")}
                    value={sessionSearch}
                    onChange={(e) => setSessionSearch(e.target.value)}
                    data-testid="input-session-search"
                  />
                  {sessionSearch && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover-elevate rounded"
                      onClick={() => setSessionSearch("")}
                      data-testid="button-clear-session-search"
                      aria-label={t("troubleshooting.sessionHistory.clearSearch")}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              {groupedSessions.length > 0 && (() => {
                const totalBlocked = groupedSessions.reduce((acc, s) => acc + s.blockedCount, 0);
                const totalRedacted = groupedSessions.reduce((acc, s) => acc + s.redactedCount, 0);
                const totalAllowed = groupedSessions.reduce((acc, s) => acc + s.allowedCount, 0);
                const totalError = groupedSessions.reduce((acc, s) => acc + s.errorCount, 0);
                const summaryText = t("troubleshooting.sessionHistory.summary").replace("{total}", String(groupedSessions.length));
                return (
                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border text-[11px] flex-wrap" data-testid="div-session-summary">
                    <span className="text-muted-foreground font-medium">{summaryText}</span>
                    {totalBlocked > 0 && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md border font-medium ${outcomeBadgeClass("blocked")}`}>
                        {totalBlocked} {t("troubleshooting.sessionHistory.filterBlocked").toLowerCase()}
                      </span>
                    )}
                    {totalRedacted > 0 && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md border font-medium ${outcomeBadgeClass("redacted")}`}>
                        {totalRedacted} {t("troubleshooting.sessionHistory.filterRedacted").toLowerCase()}
                      </span>
                    )}
                    {totalAllowed > 0 && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md border font-medium ${outcomeBadgeClass("allowed")}`}>
                        {totalAllowed} {t("troubleshooting.sessionHistory.filterAllowed").toLowerCase()}
                      </span>
                    )}
                    {totalError > 0 && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md border font-medium ${outcomeBadgeClass("error")}`}>
                        {totalError} {t("troubleshooting.sessionHistory.filterError").toLowerCase()}
                      </span>
                    )}
                  </div>
                );
              })()}
            </CardHeader>

            <CardContent className="p-0 flex-1 overflow-y-auto">
              {groupedSessions.length === 0 ? (
                <div className="p-6 text-center" data-testid="text-session-history-empty">
                  <p className="text-sm text-muted-foreground">{t("troubleshooting.sessionHistory.empty")}</p>
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="p-6 text-center" data-testid="text-session-history-no-match">
                  <p className="text-sm text-muted-foreground">
                    {sessionSearch.trim() ? t("troubleshooting.sessionHistory.noSearchMatch") : t("troubleshooting.sessionHistory.noMatch")}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredSessions.map((session) => {
                    const isPinned = pinnedSessions.has(session.sessionId);
                    return (
                      <div
                        key={session.sessionId}
                        role="button"
                        tabIndex={0}
                        className={`w-full p-3 text-left hover-elevate active-elevate-2 transition-colors group cursor-pointer ${
                          selectedSession?.sessionId === session.sessionId ? "bg-muted/50" : ""
                        } ${isPinned ? "border-l-2 border-primary" : ""}`}
                        onClick={() => setSelectedSession(session)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedSession(session); }}
                        data-testid={`row-session-${session.sessionId}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${outcomeBadgeClass(session.overallStatus)}`}
                                data-testid={`badge-outcome-${session.sessionId}`}
                              >
                                {session.overallStatus === "error" && <AlertTriangle className="w-2.5 h-2.5 mr-1" />}
                                {session.overallStatus === "mixed" && <GitMerge className="w-2.5 h-2.5 mr-1" />}
                                {outcomeLabel(session.overallStatus)}
                              </span>
                              {isPinned && (
                                <span className="inline-flex items-center gap-0.5 text-[11px] text-primary font-medium">
                                  <Pin className="w-2.5 h-2.5" />
                                  {t("troubleshooting.sessionHistory.pinnedLabel")}
                                </span>
                              )}
                              <span className="text-xs text-muted-foreground" data-testid={`text-prompt-count-${session.sessionId}`}>
                                {session.promptCount} {t("troubleshooting.sessionHistory.prompts")}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <code
                                className="text-xs text-foreground font-mono truncate max-w-[160px]"
                                data-testid={`text-session-id-${session.sessionId}`}
                              >
                                {session.sessionId === "no-session" ? "Direct Call" : session.sessionId}
                              </code>
                              <span
                                className="flex-shrink-0 p-1"
                                onClick={(e) => { e.stopPropagation(); copySessionId(session.sessionId); }}
                                data-testid={`button-copy-session-${session.sessionId}`}
                                title={t("troubleshooting.sessionHistory.copyId")}
                              >
                                {copiedSessionId === session.sessionId ? (
                                  <CheckCircle className="w-3 h-3 text-green-500" />
                                ) : (
                                  <Copy className="w-3 h-3 text-muted-foreground" />
                                )}
                              </span>
                              <span
                                className="flex-shrink-0 p-1"
                                onClick={(e) => copySessionLink(e, session.sessionId)}
                                data-testid={`button-copy-link-${session.sessionId}`}
                                title={copiedLinkId === session.sessionId
                                  ? t("troubleshooting.sessionHistory.linkCopied")
                                  : t("troubleshooting.sessionHistory.copyLink")}
                              >
                                {copiedLinkId === session.sessionId ? (
                                  <CheckCircle className="w-3 h-3 text-green-500" />
                                ) : (
                                  <Link2 className="w-3 h-3 text-muted-foreground" />
                                )}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {formatTime(session.lastTimestamp)}
                            </div>
                          </div>
                          <div className="flex items-start gap-2 flex-shrink-0">
                            <div className="text-right space-y-0.5">
                              {session.blockedCount > 0 && (
                                <div className="text-[11px] text-destructive">
                                  {session.blockedCount} {t("troubleshooting.sessionHistory.filterBlocked").toLowerCase()}
                                </div>
                              )}
                              {session.redactedCount > 0 && (
                                <div className="text-[11px] text-yellow-600 dark:text-yellow-400">
                                  {session.redactedCount} {t("troubleshooting.sessionHistory.filterRedacted").toLowerCase()}
                                </div>
                              )}
                              {session.allowedCount > 0 && (
                                <div className="text-[11px] text-muted-foreground">
                                  {session.allowedCount} {t("troubleshooting.sessionHistory.filterAllowed").toLowerCase()}
                                </div>
                              )}
                              {session.errorCount > 0 && (
                                <div className="text-[11px] text-orange-600 dark:text-orange-400">
                                  {session.errorCount} {t("troubleshooting.sessionHistory.filterError").toLowerCase()}
                                </div>
                              )}
                            </div>
                              <div className="flex flex-col items-center gap-1">
                              <button
                                type="button"
                                className={`p-0.5 rounded transition-colors ${isPinned ? "text-primary" : "text-muted-foreground opacity-0 group-hover:opacity-100"}`}
                                onClick={(e) => togglePin(e, session.sessionId)}
                                data-testid={`button-pin-${session.sessionId}`}
                                title={isPinned ? t("troubleshooting.sessionHistory.unpinSession") : t("troubleshooting.sessionHistory.pinSession")}
                              >
                                <Pin className="w-3.5 h-3.5" />
                              </button>
                              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {selectedSession ? (
            <Card className="flex flex-col min-h-0" style={{ minHeight: "520px" }} data-testid="card-session-inspector">
              <SessionInspector
                session={selectedSession}
                onClose={() => setSelectedSession(null)}
              />
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    {t("troubleshooting.diagnostics.title")}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {t("troubleshooting.diagnostics.subtitle")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs flex-shrink-0"
                  onClick={runAllDiagnostics}
                  disabled={isAnyDiagRunning}
                  data-testid="button-run-all-diagnostics"
                >
                  {isAnyDiagRunning ? (
                    <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3 mr-1.5" />
                  )}
                  {t("troubleshooting.diagnostics.runAll")}
                </Button>
              </div>

              <Card data-testid="card-diag-firewall">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      {diagStatusIcon(firewallDiag.status)}
                      <span className="text-sm font-medium text-foreground">
                        {t("troubleshooting.diagnostics.firewall.title")}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs flex-shrink-0"
                      onClick={runFirewallDiag}
                      disabled={firewallDiag.status === "running"}
                      data-testid="button-run-firewall-diag"
                    >
                      {firewallDiag.status === "running"
                        ? t("troubleshooting.diagnostics.running")
                        : t("troubleshooting.diagnostics.runCheck")}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t("troubleshooting.diagnostics.firewall.description")}
                  </p>
                  {firewallDiag.status !== "idle" && (
                    <div className="mt-2 pt-2 border-t border-border space-y-1">
                      {firewallDiag.status === "ok" && (
                        <div
                          className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400"
                          data-testid="text-firewall-diag-ok"
                        >
                          <CheckCircle className="w-3 h-3 flex-shrink-0" />
                          <span>
                            {t("troubleshooting.diagnostics.ok")} — {t("troubleshooting.diagnostics.latency")}:{" "}
                            {firewallDiag.latencyMs}ms
                          </span>
                        </div>
                      )}
                      {firewallDiag.status === "error" && (
                        <div className="text-xs text-destructive" data-testid="text-firewall-diag-error">
                          {t("troubleshooting.diagnostics.error")}: {firewallDiag.error}
                        </div>
                      )}
                      {firewallDiag.timestamp && (
                        <div className="text-xs text-muted-foreground">
                          {t("troubleshooting.diagnostics.checkedAt")}: {formatTime(firewallDiag.timestamp)}
                        </div>
                      )}
                      <Sparkline history={firewallHistory} />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card data-testid="card-diag-openai">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      {diagStatusIcon(openaiDiag.status)}
                      <span className="text-sm font-medium text-foreground">
                        {t("troubleshooting.diagnostics.openai.title")}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs flex-shrink-0"
                      onClick={runOpenaiDiag}
                      disabled={openaiDiag.status === "running"}
                      data-testid="button-run-openai-diag"
                    >
                      {openaiDiag.status === "running"
                        ? t("troubleshooting.diagnostics.running")
                        : t("troubleshooting.diagnostics.runCheck")}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t("troubleshooting.diagnostics.openai.description")}
                  </p>
                  {openaiDiag.status !== "idle" && (
                    <div className="mt-2 pt-2 border-t border-border space-y-1">
                      {openaiDiag.status === "ok" && (
                        <div
                          className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400"
                          data-testid="text-openai-diag-ok"
                        >
                          <CheckCircle className="w-3 h-3 flex-shrink-0" />
                          <span>
                            {t("troubleshooting.diagnostics.ok")} — {t("troubleshooting.diagnostics.latency")}:{" "}
                            {openaiDiag.latencyMs}ms
                          </span>
                        </div>
                      )}
                      {openaiDiag.status === "error" && (
                        <div className="text-xs text-destructive" data-testid="text-openai-diag-error">
                          {t("troubleshooting.diagnostics.error")}: {openaiDiag.error}
                        </div>
                      )}
                      {openaiDiag.timestamp && (
                        <div className="text-xs text-muted-foreground">
                          {t("troubleshooting.diagnostics.checkedAt")}: {formatTime(openaiDiag.timestamp)}
                        </div>
                      )}
                      <Sparkline history={openaiHistory} />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card data-testid="card-diag-config">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      {configDiag.status === "idle"
                        ? <Cog className="w-4 h-4 text-muted-foreground" />
                        : diagStatusIcon(configDiag.status)}
                      <span className="text-sm font-medium text-foreground">
                        {t("troubleshooting.diagnostics.config.title")}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={runConfigDiag}
                        disabled={configDiag.status === "running"}
                        data-testid="button-run-config-diag"
                      >
                        {configDiag.status === "running"
                          ? t("troubleshooting.diagnostics.running")
                          : t("troubleshooting.diagnostics.runCheck")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={copyConfig}
                        data-testid="button-copy-config"
                      >
                        {configCopied ? (
                          <>
                            <CheckCircle className="w-3 h-3 mr-1.5 text-green-500" />
                            {t("troubleshooting.diagnostics.config.copied")}
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 mr-1.5" />
                            {t("troubleshooting.diagnostics.config.copyAll")}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    {t("troubleshooting.diagnostics.config.description")}
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {t("troubleshooting.diagnostics.config.endpoint")}
                      </span>
                      <span
                        className="text-xs font-mono text-foreground text-right break-all"
                        data-testid="text-config-endpoint"
                      >
                        {credentials ? getEndpointLabel() : t("troubleshooting.diagnostics.config.notConfigured")}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {t("troubleshooting.diagnostics.config.email")}
                      </span>
                      <span
                        className="text-xs font-mono text-foreground text-right break-all"
                        data-testid="text-config-email"
                      >
                        {credentials?.email || t("troubleshooting.diagnostics.config.notConfigured")}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {t("troubleshooting.diagnostics.config.sessionIdPrefix")}
                      </span>
                      <span
                        className="text-xs font-mono text-foreground text-right"
                        data-testid="text-config-session-prefix"
                      >
                        {SESSION_ID_PREFIX}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {t("troubleshooting.diagnostics.config.concurrency")}
                      </span>
                      <span
                        className="text-xs font-mono text-foreground text-right"
                        data-testid="text-config-concurrency"
                      >
                        {CONCURRENCY_SETTINGS}
                      </span>
                    </div>
                    {configDiag.timestamp && (
                      <div className="pt-2 border-t border-border space-y-1">
                        {configDiag.status === "ok" && (
                          <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                            <CheckCircle className="w-3 h-3 flex-shrink-0" />
                            <span>{t("troubleshooting.diagnostics.config.configRefreshed")}</span>
                          </div>
                        )}
                        {configDiag.status === "error" && (
                          <div className="flex items-center gap-2 text-xs text-destructive">
                            <XCircle className="w-3 h-3 flex-shrink-0" />
                            <span>{t("troubleshooting.diagnostics.noCredentials")}</span>
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {t("troubleshooting.diagnostics.checkedAt")}: {formatTime(configDiag.timestamp)}
                        </div>
                      </div>
                    )}
                    {!credentials && configDiag.status === "idle" && (
                      <div className="mt-2 pt-2 border-t border-border">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Shield className="w-3 h-3 flex-shrink-0" />
                          <span>{t("troubleshooting.diagnostics.noCredentials")}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Live Test Bar — always visible at bottom of Troubleshooting Panel */}
    <div className="border-t border-border bg-muted/20 flex-shrink-0">
      {/* Results area — expands above the input bar when results are available */}
      {liveTestStatus === "done" && liveTestResults && (
        <div className="border-b border-border">
          <div className="max-w-7xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Zap className="w-3 h-3" />
                {t("troubleshooting.liveTest.resultsTitle")}
              </p>
              <Button
                size="icon"
                variant="ghost"
                className="w-6 h-6"
                onClick={() => { setLiveTestResults(null); setLiveTestStatus("idle"); }}
                data-testid="button-live-test-dismiss"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* Direct (no firewall) column */}
              <div className="rounded-md border border-border bg-background p-3 space-y-1.5">
                <p className="text-[11px] font-semibold text-foreground uppercase tracking-wide">{t("troubleshooting.liveTest.directColumn")}</p>
                <p className="text-[11px] text-muted-foreground font-mono">{liveTestResults.direct.latencyMs}ms</p>
                {liveTestResults.direct.error ? (
                  <p className="text-[11px] text-destructive">{liveTestResults.direct.error}</p>
                ) : (
                  <p className="text-xs text-foreground max-h-20 overflow-y-auto break-words" data-testid="text-live-test-direct-response">
                    {liveTestResults.direct.response}
                  </p>
                )}
              </div>
              {/* Through Firewall column */}
              <div className={`rounded-md border p-3 space-y-1.5 ${
                liveTestResults.firewall.outcome === "blocked" ? "border-destructive/30 bg-destructive/5" :
                liveTestResults.firewall.outcome === "redacted" ? "border-yellow-500/30 bg-yellow-500/5" :
                "border-green-500/30 bg-green-500/5"
              }`}>
                <div className="flex items-center gap-1.5">
                  <Shield className="w-3 h-3 text-muted-foreground" />
                  <p className="text-[11px] font-semibold text-foreground uppercase tracking-wide">{t("troubleshooting.liveTest.firewallColumn")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                    liveTestResults.firewall.outcome === "blocked" ? "bg-destructive/10 text-destructive border-destructive/30" :
                    liveTestResults.firewall.outcome === "redacted" ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30" :
                    liveTestResults.firewall.outcome === "error" ? "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30" :
                    "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30"
                  }`}>
                    {liveTestResults.firewall.outcome.toUpperCase()}
                  </span>
                  <p className="text-[11px] text-muted-foreground font-mono">{liveTestResults.firewall.latencyMs}ms</p>
                </div>
                {liveTestResults.firewall.error ? (
                  <p className="text-[11px] text-muted-foreground">{liveTestResults.firewall.error}</p>
                ) : (
                  <div className="space-y-1">
                    {liveTestResults.firewall.actionTaken && (
                      <p className="text-[11px] font-medium text-muted-foreground">
                        {t("troubleshooting.liveTest.action")}: <span className="font-mono">{liveTestResults.firewall.actionTaken}</span>
                      </p>
                    )}
                    {liveTestResults.firewall.outcome === "blocked" ? (
                      <p className="text-[11px] text-destructive">{t("troubleshooting.liveTest.blocked")}</p>
                    ) : liveTestResults.firewall.response ? (
                      <p className="text-xs text-foreground max-h-20 overflow-y-auto break-words" data-testid="text-live-test-firewall-response">
                        {liveTestResults.firewall.response}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {liveTestStatus === "error" && (
        <div className="border-b border-border">
          <div className="max-w-7xl mx-auto px-4 py-2">
            <div className="flex items-center gap-2 text-xs text-destructive">
              <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {t("troubleshooting.liveTest.error")}
              <Button size="sm" variant="ghost" className="h-6 text-xs ml-auto" onClick={() => setLiveTestStatus("idle")}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <Textarea
              ref={liveTestInputRef}
              className="resize-none text-xs min-h-[36px] max-h-40 py-2 overflow-y-auto"
              rows={1}
              placeholder={credentials ? t("troubleshooting.liveTest.placeholder") : t("troubleshooting.liveTest.disabledPlaceholder")}
              disabled={!credentials || liveTestStatus === "running"}
              value={liveTestInput}
              onChange={(e) => {
                setLiveTestInput(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  runLiveTest();
                  if (liveTestInputRef.current) {
                    liveTestInputRef.current.style.height = "auto";
                  }
                }
              }}
              data-testid="textarea-live-test-input"
            />
          </div>
          <Button
            size="icon"
            variant="default"
            disabled={!credentials || !liveTestInput.trim() || liveTestStatus === "running"}
            onClick={runLiveTest}
            data-testid="button-live-test-submit"
          >
            {liveTestStatus === "running" ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        {!credentials && (
          <p className="text-[11px] text-muted-foreground mt-1">{t("troubleshooting.liveTest.credentialsRequired")}</p>
        )}
      </div>
    </div>
    </div>
  );
}
