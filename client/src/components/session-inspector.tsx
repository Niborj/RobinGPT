import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  X,
  Download,
  Copy,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Shield,
  Search,
  BarChart2,
  FileText,
  GitMerge,
  Minus,
  Play,
  RefreshCw,
  RotateCcw,
  SplitSquareHorizontal,
  ChevronDown,
  ChevronUp,
  Network,
  Clock,
  Activity,
} from "lucide-react";
import { useLanguage } from "@/contexts/language-context";
import { useBranding } from "@/contexts/branding-context";
import { useCredentials } from "@/contexts/credentials-context";
import { getEndpointLabel } from "@/lib/endpoint-utils";

type SessionOutcome = "blocked" | "redacted" | "allowed" | "mixed" | "error";

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

interface SessionInspectorProps {
  session: SessionGroup;
  onClose: () => void;
}

function outcomeBadgeClass(status: string) {
  if (status === "blocked") return "bg-destructive/10 text-destructive border-destructive/30";
  if (status === "redacted") return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30";
  if (status === "error") return "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30";
  if (status === "mixed") return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30";
  return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30";
}

function statusIcon(status: string, size = "w-3.5 h-3.5") {
  if (status === "blocked") return <XCircle className={`${size} text-destructive flex-shrink-0`} />;
  if (status === "redacted") return <AlertTriangle className={`${size} text-yellow-500 flex-shrink-0`} />;
  if (status === "error") return <AlertTriangle className={`${size} text-orange-500 flex-shrink-0`} />;
  return <CheckCircle className={`${size} text-green-500 flex-shrink-0`} />;
}

function extractEntityTypes(aimResponse: Record<string, unknown> | null): string[] {
  if (!aimResponse) return [];
  const entities: string[] = [];
  const guardians = aimResponse.guardians as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(guardians)) {
    for (const g of guardians) {
      if (g.triggered && g.name) entities.push(String(g.name));
    }
  }
  return entities;
}

function extractPolicyName(aimResponse: Record<string, unknown> | null): string | null {
  if (!aimResponse) return null;
  const action = aimResponse.required_action as Record<string, unknown> | undefined;
  if (action?.policy_name) return String(action.policy_name);
  if (action?.message) return String(action.message);
  return null;
}

function extractConfidence(aimResponse: Record<string, unknown> | null): number | null {
  if (!aimResponse) return null;
  if (typeof aimResponse.confidence === "number") return aimResponse.confidence;
  const action = aimResponse.required_action as Record<string, unknown> | undefined;
  if (typeof action?.confidence === "number") return action.confidence as number;
  const guardians = aimResponse.guardians as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(guardians)) {
    for (const g of guardians) {
      if (g.triggered && typeof g.confidence === "number") return g.confidence as number;
    }
  }
  return null;
}

function extractAnonymizedText(aimResponse: Record<string, unknown> | null, role: "user" | "assistant" = "user"): string | null {
  if (!aimResponse) return null;
  if (typeof aimResponse.anonymized_text === "string") return aimResponse.anonymized_text;
  if (typeof aimResponse.redacted_text === "string") return aimResponse.redacted_text;
  if (typeof aimResponse.sanitized === "string") return aimResponse.sanitized;
  const redactedChat = aimResponse.redacted_chat as Record<string, unknown> | undefined;
  const allRedacted = redactedChat?.all_redacted_messages as Array<Record<string, unknown>> | undefined;
  if (allRedacted?.length) {
    const roleMessages = allRedacted.filter((m) => m.role === role);
    if (roleMessages.length > 0) {
      const last = roleMessages[roleMessages.length - 1];
      return typeof last.content === "string" ? last.content : null;
    }
  }
  return null;
}

function extractReplacementPairs(aimResponse: Record<string, unknown> | null): Array<{ original: string; replacement: string }> {
  if (!aimResponse) return [];
  const pairs: Array<{ original: string; replacement: string }> = [];
  const guardians = aimResponse.guardians as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(guardians)) {
    for (const g of guardians) {
      if (!g.triggered) continue;
      const entities = g.entities as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(entities)) {
        for (const e of entities) {
          const original = String(e.original_text ?? e.text ?? e.value ?? "");
          const replacement = String(e.replacement ?? e.token ?? e.placeholder ?? e.anonymized ?? "");
          if (original && replacement) pairs.push({ original, replacement });
        }
      }
    }
  }
  const entityMap = aimResponse.entity_map as Record<string, string> | undefined;
  if (entityMap && typeof entityMap === "object") {
    for (const [original, replacement] of Object.entries(entityMap)) {
      if (!pairs.find((p) => p.original === original)) pairs.push({ original, replacement });
    }
  }
  return pairs;
}

function getStageName(stage: SessionStage): string {
  if (stage.stageLabel) return stage.stageLabel;
  if (stage.stage) return stage.stage.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  if (stage.tierLabel) return stage.tierLabel;
  return `Stage ${stage.sequence ?? ""}`;
}

function getNextStepHint(t: (k: string) => string, entities: string[]): string {
  const lower = entities.join(" ").toLowerCase();
  if (lower.includes("pii") || lower.includes("personal")) return t("troubleshooting.inspector.policy.hintPII");
  if (lower.includes("phi") || lower.includes("health")) return t("troubleshooting.inspector.policy.hintPHI");
  if (lower.includes("secret") || lower.includes("key") || lower.includes("token")) return t("troubleshooting.inspector.policy.hintSecret");
  if (lower.includes("jailbreak") || lower.includes("prompt injection")) return t("troubleshooting.inspector.policy.hintJailbreak");
  if (lower.includes("credit") || lower.includes("card") || lower.includes("ssn")) return t("troubleshooting.inspector.policy.hintPCI");
  return t("troubleshooting.inspector.policy.hintDefault");
}

function isOutputStage(stage: SessionStage): boolean {
  return stage.stage === "assistant-call" || stage.tier === "assistant";
}

function isInputStage(stage: SessionStage): boolean {
  return (
    stage.stage === "user-call" ||
    stage.stage === "system-call" ||
    stage.tier === "user" ||
    (!stage.stage && !stage.tier)
  );
}

type DiffToken = { text: string; changed: boolean };

function computeWordDiff(original: string, modified: string): { before: DiffToken[]; after: DiffToken[] } {
  const origWords = original.split(/(\s+)/);
  const modWords = modified.split(/(\s+)/);

  const n = origWords.length;
  const m = modWords.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (origWords[i] === modWords[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const before: DiffToken[] = [];
  const after: DiffToken[] = [];
  let i = 0;
  let j = 0;

  while (i < n || j < m) {
    if (i < n && j < m && origWords[i] === modWords[j]) {
      before.push({ text: origWords[i], changed: false });
      after.push({ text: modWords[j], changed: false });
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i + 1][j] <= dp[i][j + 1])) {
      after.push({ text: modWords[j], changed: true });
      j++;
    } else {
      before.push({ text: origWords[i], changed: true });
      i++;
    }
  }

  return { before, after };
}

function SpanDiff({
  original,
  modified,
  beforeLabel,
  afterLabel,
  t,
}: {
  original: string;
  modified: string;
  beforeLabel: string;
  afterLabel: string;
  t: (k: string) => string;
}) {
  if (!original && !modified) return null;

  const noChange = original === modified;

  if (noChange) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[11px] text-muted-foreground mb-1">{beforeLabel}</p>
          <div className="rounded-md bg-muted/40 p-3 text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
            {original || t("troubleshooting.inspector.diff.empty")}
          </div>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mb-1">{afterLabel}</p>
          <div className="rounded-md bg-muted/40 border border-border p-3 text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed flex items-center justify-center min-h-[60px]">
            <span className="text-muted-foreground italic text-[11px]">{t("troubleshooting.inspector.diff.noChanges")}</span>
          </div>
        </div>
      </div>
    );
  }

  const { before, after } = computeWordDiff(original, modified);

  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <p className="text-[11px] text-muted-foreground mb-1">{beforeLabel}</p>
        <div className="rounded-md bg-destructive/5 border border-destructive/20 p-3 text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
          {before.map((tok, i) => (
            <span
              key={i}
              className={tok.changed ? "bg-destructive/20 text-destructive rounded px-0.5" : ""}
            >
              {tok.text}
            </span>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[11px] text-muted-foreground mb-1">{afterLabel}</p>
        <div className="rounded-md bg-green-500/5 border border-green-500/20 p-3 text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
          {after.map((tok, i) => (
            <span
              key={i}
              className={tok.changed ? "bg-green-500/20 text-green-700 dark:text-green-400 rounded px-0.5" : ""}
            >
              {tok.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

type ReplayStage = {
  stageName: string;
  stage: string;
  status: "allowed" | "blocked" | "redacted";
  actionTaken: string;
  actionKey?: string;
  threatsDetected: string[];
  aimResponse: Record<string, unknown> | null;
  durationMs: number;
};

type ReplayResult = {
  outcome: "allowed" | "blocked" | "redacted";
  stages: ReplayStage[];
  aiResponse: string | null;
};

function buildMarkdownExport(
  session: SessionGroup,
  replayResult: ReplayResult | null,
  t: (key: string) => string,
  endpointKey?: string,
): string {
  const lines: string[] = [];
  const now = new Date().toISOString();
  const sortedStages = [...session.stages].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const inputStages = sortedStages.filter(isInputStage);
  const outputStages = sortedStages.filter(isOutputStage);
  const totalDurationMs = session.lastTimestamp.getTime() - session.firstTimestamp.getTime();
  const formatDate = (d: Date) =>
    d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  lines.push(`# ${t("troubleshooting.inspector.export.summaryTitle")}`);
  lines.push("");
  lines.push(`**${t("troubleshooting.inspector.export.sessionId")}:** \`${session.sessionId}\``);
  lines.push(`**${t("troubleshooting.inspector.export.outcome")}:** ${session.overallStatus.toUpperCase()}`);
  if (endpointKey) {
    lines.push(`**AI Firewall Provider:** ${getEndpointLabel(endpointKey)}`);
  }
  lines.push(`**${t("troubleshooting.inspector.export.timestamp")}:** ${formatDate(session.firstTimestamp)}`);
  lines.push(`**${t("troubleshooting.inspector.export.duration")}:** ${totalDurationMs}ms`);
  lines.push(`**${t("troubleshooting.inspector.export.prompts")}:** ${session.promptCount}`);
  lines.push(`**${t("troubleshooting.inspector.export.stages")}:** ${sortedStages.length}`);
  lines.push(`**${t("troubleshooting.inspector.export.exportedAt")}:** ${now}`);
  lines.push("");

  lines.push(`## ${t("troubleshooting.inspector.export.stageBreakdown")}`);
  lines.push("");
  lines.push(`| ${t("troubleshooting.inspector.export.mdColStage")} | ${t("troubleshooting.inspector.export.mdColStatus")} | ${t("troubleshooting.inspector.export.mdColThreats")} | ${t("troubleshooting.inspector.export.mdColPolicy")} | ${t("troubleshooting.inspector.export.mdColConfidence")} |`);
  lines.push("|---|---|---|---|---|");
  for (const s of sortedStages) {
    const entities = extractEntityTypes(s.aimResponse);
    const policy = extractPolicyName(s.aimResponse);
    const conf = extractConfidence(s.aimResponse);
    const confStr = conf !== null ? `${Math.round(conf * 100)}%` : "-";
    lines.push(`| ${getStageName(s)} | ${s.status.toUpperCase()} | ${entities.join(", ") || "-"} | ${policy || "-"} | ${confStr} |`);
  }
  lines.push("");

  const redactedInputs = inputStages.filter((s) => {
    const anonymized = extractAnonymizedText(s.aimResponse);
    return anonymized && anonymized !== s.userMessage;
  });
  const redactedOutputs = outputStages.filter((s) => {
    const anonymized = extractAnonymizedText(s.aimResponse);
    return anonymized && anonymized !== s.userMessage;
  });

  if (redactedInputs.length > 0 || redactedOutputs.length > 0) {
    lines.push(`## ${t("troubleshooting.inspector.export.mdRedactionDiff")}`);
    lines.push("");
    for (const s of [...redactedInputs, ...redactedOutputs]) {
      const anonymized = extractAnonymizedText(s.aimResponse) ?? "";
      lines.push(`### ${getStageName(s)}`);
      lines.push("");
      lines.push(`**${t("troubleshooting.inspector.diff.original")}:**`);
      lines.push("```");
      lines.push(s.userMessage);
      lines.push("```");
      lines.push("");
      lines.push(`**${t("troubleshooting.inspector.diff.sanitized")}:**`);
      lines.push("```");
      lines.push(anonymized);
      lines.push("```");
      lines.push("");
    }
  }

  if (replayResult) {
    lines.push(`## ${t("troubleshooting.inspector.export.mdReplayResult")}`);
    lines.push("");
    lines.push(`**${t("troubleshooting.inspector.replay.outcome")}:** ${replayResult.outcome.toUpperCase()}`);
    lines.push(`**${t("troubleshooting.inspector.replay.stages")}:** ${replayResult.stages.length}`);
    if (replayResult.aiResponse) {
      lines.push("");
      lines.push(`**${t("troubleshooting.inspector.replay.aiResponseLabel")}:**`);
      lines.push("");
      lines.push(replayResult.aiResponse);
    }
  }

  return lines.join("\n");
}

export function SessionInspector({ session, onClose }: SessionInspectorProps) {
  const { t } = useLanguage();
  const { credentials } = useCredentials();
  const { branding } = useBranding();
  const brandedAppName = branding.appName || "RobinGPT";
  const [summaryCopied, setSummaryCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Translate a server-generated stage key to the locale-appropriate label.
  // Reuses existing stageTerminology business-view labels so no new i18n keys are needed.
  const stageLabel = (stage: string, fallback: string): string => {
    const map: Record<string, string> = {
      "system-call": t("stageTerminology.business.systemCallLabel"),
      "user-call": t("stageTerminology.business.userCallLabel"),
      "tool-request": t("stageTerminology.business.toolRequestLabel"),
      "tool-call": t("stageTerminology.business.toolCallLabel"),
      "assistant-call": t("stageTerminology.business.assistantCallLabel"),
      "static-analysis": t("stageTerminology.business.staticAnalysisLabel"),
      "sandbox-check": t("stageTerminology.business.sandboxCheckLabel"),
      "auth-review": t("stageTerminology.business.authReviewLabel"),
      "log-scrub": t("stageTerminology.business.logScrubLabel"),
      "access-control": t("stageTerminology.business.accessControlLabel"),
      "openai": t("troubleshooting.inspector.replay.openaiStageLabel"),
    };
    return map[stage] ?? fallback;
  };

  // Tab state
  const [activeTab, setActiveTab] = useState("chain");

  // Replay state
  const [replayStatus, setReplayStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayFirewall, setReplayFirewall] = useState(true);
  const [replayCopied, setReplayCopied] = useState(false);
  const [replayPromptOverride, setReplayPromptOverride] = useState<string | null>(null);
  // Feature 1: editable prompt textarea value (separate from override used for run)
  const [editablePromptValue, setEditablePromptValue] = useState<string | null>(null);
  // Track which specific stage was selected for per-row replay to build an accurate original comparison.
  const [replayOriginalStage, setReplayOriginalStage] = useState<SessionStage | null>(null);
  // Track the stage ID triggering the current replay run, for per-row loading affordance.
  const [replayingStageId, setReplayingStageId] = useState<string | null>(null);
  const replayCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [comparisonResult, setComparisonResult] = useState<ReplayResult | null>(null);
  const [comparisonStatus, setComparisonStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  const [expandedJsonStageId, setExpandedJsonStageId] = useState<string | null>(null);
  const [copiedPolicyId, setCopiedPolicyId] = useState<string | null>(null);
  const policyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [waterfallBreakdownOpen, setWaterfallBreakdownOpen] = useState(false);
  const [tracerouteStatus, setTracerouteStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [tracerouteHops, setTracerouteHops] = useState<Array<{ url: string; latencyMs: number | null; error?: string }>>([]);
  const [exportPreviewCopied, setExportPreviewCopied] = useState(false);
  const exportCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setReplayStatus("idle");
    setReplayResult(null);
    setReplayError(null);
    setReplayPromptOverride(null);
    setEditablePromptValue(null);
    setReplayOriginalStage(null);
    setReplayingStageId(null);
    setExpandedJsonStageId(null);
    setComparisonResult(null);
    setComparisonStatus("idle");
    setComparisonError(null);
    setShowComparison(false);
    setTracerouteStatus("idle");
    setTracerouteHops([]);
    setExportPreviewCopied(false);
  }, [session.sessionId]);

  useEffect(() => {
    return () => {
      if (policyTimeoutRef.current) clearTimeout(policyTimeoutRef.current);
      if (exportCopyTimeoutRef.current) clearTimeout(exportCopyTimeoutRef.current);
    };
  }, []);

  const sortedStages = [...session.stages].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  const blockedRedactedStages = sortedStages.filter(
    (s) => s.status === "blocked" || s.status === "redacted"
  );

  const inputStages = sortedStages.filter(isInputStage);
  const outputStages = sortedStages.filter(isOutputStage);

  const formatTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const formatDate = (d: Date) =>
    d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const stagesWithTiming = sortedStages.map((stage, idx) => {
    const embedded = typeof stage.aimResponse?._durationMs === "number" ? (stage.aimResponse._durationMs as number) : null;
    const prevTimestamp = idx === 0 ? session.firstTimestamp : sortedStages[idx - 1].timestamp;
    const timestampDiff = Math.max(0, stage.timestamp.getTime() - prevTimestamp.getTime());
    const durationMs = embedded !== null ? embedded : timestampDiff;
    return { stage, durationMs };
  });

  const rawTimestampDuration = session.lastTimestamp.getTime() - session.firstTimestamp.getTime();
  const summedDuration = stagesWithTiming.reduce((sum, s) => sum + s.durationMs, 0);
  const totalDurationMs = rawTimestampDuration > 0 ? rawTimestampDuration : summedDuration;

  const maxDuration = Math.max(...stagesWithTiming.map((s) => s.durationMs), 1);

  // Replay the original prompt through the AI Firewall + OpenAI
  // Only use user-call stages for the default prompt — never system-call (system prompt is not user input).
  const userInputStages = sortedStages.filter(s => s.stage === "user-call" || (s.tier === "user" && s.stage !== "system-call"));
  const defaultPrompt = userInputStages.length > 0
    ? userInputStages[0].userMessage
    : sortedStages.find(s => s.stage !== "system-call" && s.userMessage)?.userMessage || "";
  const activeReplayPrompt = replayPromptOverride ?? defaultPrompt;

  const replayStageRow = (stagePrompt: string, selectedStage?: SessionStage) => {
    setReplayPromptOverride(stagePrompt);
    setEditablePromptValue(stagePrompt);
    setReplayOriginalStage(selectedStage ?? null);
    setReplayingStageId(selectedStage?.id ?? null);
    setReplayStatus("idle");
    setReplayResult(null);
    setReplayError(null);
    setComparisonResult(null);
    setComparisonStatus("idle");
    setComparisonError(null);
    setShowComparison(false);
    setActiveTab("replay");
    // Auto-run replay immediately after switching to the replay tab
    // Use a microtask to let state updates flush before the async call
    Promise.resolve().then(() => {
      setReplayStatus("running");
      const body: Record<string, unknown> = {
        message: stagePrompt,
        useFirewall: replayFirewall,
      };
      if (credentials) {
        body.aimApiKey = credentials.apiKey;
        body.aimUserEmail = credentials.email;
        body.aimApiEndpoint = credentials.apiEndpoint || "aim";
        body.openaiApiKey = credentials.openaiApiKey;
        if (credentials.llmProvider === "local" && credentials.llmBaseUrl) {
          body.llmProvider = "local";
          body.llmBaseUrl = credentials.llmBaseUrl;
          body.llmModel = credentials.llmModel;
        }
      }
      fetch("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: t("troubleshooting.inspector.replay.replayFailed") })) as { error?: string };
            setReplayError(err.error || t("troubleshooting.inspector.replay.replayFailed"));
            setReplayStatus("error");
            return;
          }
          const data: ReplayResult = await res.json();
          setReplayResult(data);
          setReplayStatus("done");
        })
        .catch((e) => {
          setReplayError(e instanceof Error ? e.message : t("troubleshooting.inspector.replay.replayFailed"));
          setReplayStatus("error");
        });
    });
  };

  const runReplay = async () => {
    const promptToUse = editablePromptValue ?? activeReplayPrompt;
    if (!promptToUse) return;
    setReplayStatus("running");
    setReplayResult(null);
    setReplayError(null);
    setComparisonResult(null);
    setComparisonStatus("idle");
    setComparisonError(null);
    setShowComparison(false);
    try {
      const body: Record<string, unknown> = {
        message: promptToUse,
        useFirewall: replayFirewall,
      };
      if (credentials) {
        body.aimApiKey = credentials.apiKey;
        body.aimUserEmail = credentials.email;
        body.aimApiEndpoint = credentials.apiEndpoint || "aim";
        body.openaiApiKey = credentials.openaiApiKey;
        if (credentials.llmProvider === "local" && credentials.llmBaseUrl) {
          body.llmProvider = "local";
          body.llmBaseUrl = credentials.llmBaseUrl;
          body.llmModel = credentials.llmModel;
        }
      }
      const res = await fetch("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: t("troubleshooting.inspector.replay.replayFailed") })) as { error?: string };
        setReplayError(err.error || t("troubleshooting.inspector.replay.replayFailed"));
        setReplayStatus("error");
        return;
      }
      const data: ReplayResult = await res.json();
      setReplayResult(data);
      setReplayStatus("done");
    } catch (e) {
      setReplayError(e instanceof Error ? e.message : t("troubleshooting.inspector.replay.replayFailed"));
      setReplayStatus("error");
    }
  };

  const runComparison = async () => {
    const promptToUse = editablePromptValue ?? activeReplayPrompt;
    if (!promptToUse || !replayResult) return;
    const comparisonFirewall = !replayFirewall;
    setComparisonStatus("running");
    setComparisonResult(null);
    setComparisonError(null);
    try {
      const body: Record<string, unknown> = {
        message: promptToUse,
        useFirewall: comparisonFirewall,
      };
      if (credentials) {
        body.aimApiKey = credentials.apiKey;
        body.aimUserEmail = credentials.email;
        body.aimApiEndpoint = credentials.apiEndpoint || "aim";
        body.openaiApiKey = credentials.openaiApiKey;
        if (credentials.llmProvider === "local" && credentials.llmBaseUrl) {
          body.llmProvider = "local";
          body.llmBaseUrl = credentials.llmBaseUrl;
          body.llmModel = credentials.llmModel;
        }
      }
      const res = await fetch("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: t("troubleshooting.inspector.replay.replayFailed") })) as { error?: string };
        setComparisonError(err.error || t("troubleshooting.inspector.replay.replayFailed"));
        setComparisonStatus("error");
        return;
      }
      const data: ReplayResult = await res.json();
      setComparisonResult(data);
      setComparisonStatus("done");
      setShowComparison(true);
    } catch (e) {
      setComparisonError(e instanceof Error ? e.message : t("troubleshooting.inspector.replay.replayFailed"));
      setComparisonStatus("error");
    }
  };

  const downloadMarkdown = () => {
    const md = buildMarkdownExport(session, replayResult, t, credentials?.apiEndpoint || "aim");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${session.sessionId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyReplayComparison = () => {
    if (!replayResult) return;
    const origOutcome = (replayOriginalStage?.status ?? session.overallStatus).toUpperCase();
    const replayOutcome = replayResult.outcome.toUpperCase();
    const lines = [
      t("troubleshooting.inspector.replay.comparisonTitle"),
      "=".repeat(40),
      `${t("troubleshooting.inspector.replay.sessionId")}: ${session.sessionId}`,
      `${t("troubleshooting.inspector.replay.prompt")}: ${activeReplayPrompt.slice(0, 120)}${activeReplayPrompt.length > 120 ? "..." : ""}`,
      "",
      `${t("troubleshooting.inspector.replay.original")}:`,
      `  ${t("troubleshooting.inspector.replay.outcome")}: ${origOutcome}`,
      `  ${t("troubleshooting.inspector.replay.stages")}: ${sortedStages.length}`,
      "",
      `${t("troubleshooting.inspector.replay.replay")}:`,
      `  ${t("troubleshooting.inspector.replay.outcome")}: ${replayOutcome}`,
      `  ${t("troubleshooting.inspector.replay.stages")}: ${replayResult.stages.length}`,
      `  ${t("troubleshooting.inspector.replay.firewallEnabled")}: ${replayFirewall ? t("troubleshooting.inspector.replay.yes") : t("troubleshooting.inspector.replay.no")}`,
    ];
    if (origOutcome !== replayOutcome) {
      lines.push("", t("troubleshooting.inspector.replay.outcomeChanged").replace("{from}", origOutcome).replace("{to}", replayOutcome));
    } else {
      lines.push("", t("troubleshooting.inspector.replay.outcomeUnchanged"));
    }
    navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
    setReplayCopied(true);
    if (replayCopyTimeoutRef.current) clearTimeout(replayCopyTimeoutRef.current);
    replayCopyTimeoutRef.current = setTimeout(() => setReplayCopied(false), 2000);
  };

  const downloadEvidence = () => {
    const bundle = {
      exportedAt: new Date().toISOString(),
      sessionId: session.sessionId,
      overallOutcome: session.overallStatus,
      firstTimestamp: session.firstTimestamp.toISOString(),
      lastTimestamp: session.lastTimestamp.toISOString(),
      totalDurationMs,
      promptCount: session.promptCount,
      counts: {
        blocked: session.blockedCount,
        redacted: session.redactedCount,
        allowed: session.allowedCount,
        error: session.errorCount,
      },
      stages: sortedStages.map((s) => ({
        sequence: s.sequence,
        stage: s.stage,
        stageLabel: getStageName(s),
        isInputStage: isInputStage(s),
        isOutputStage: isOutputStage(s),
        status: s.status,
        timestamp: s.timestamp.toISOString(),
        threatsDetected: s.threatsDetected,
        actionTaken: s.actionTaken,
        originalContent: s.userMessage,
        sanitizedContent: extractAnonymizedText(s.aimResponse),
        entityTypes: extractEntityTypes(s.aimResponse),
        policyName: extractPolicyName(s.aimResponse),
        confidence: extractConfidence(s.aimResponse),
        toolName: s.toolName ?? null,
        durationMs: stagesWithTiming.find((sw) => sw.stage.id === s.id)?.durationMs ?? null,
      })),
    };

    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evidence-${session.sessionId.slice(0, 16)}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyPolicyParagraph = (stageId: string, text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedPolicyId(stageId);
    if (policyTimeoutRef.current) clearTimeout(policyTimeoutRef.current);
    policyTimeoutRef.current = setTimeout(() => setCopiedPolicyId(null), 2000);
  };

  const copyExportPreview = () => {
    const md = buildMarkdownExport(session, replayResult, t, credentials?.apiEndpoint || "aim");
    navigator.clipboard.writeText(md).catch(() => {});
    setExportPreviewCopied(true);
    if (exportCopyTimeoutRef.current) clearTimeout(exportCopyTimeoutRef.current);
    exportCopyTimeoutRef.current = setTimeout(() => setExportPreviewCopied(false), 2000);
  };

  const runTraceroute = async () => {
    setTracerouteStatus("running");
    setTracerouteHops([]);
    try {
      const res = await fetch("/api/traceroute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aimApiEndpoint: credentials?.apiEndpoint || "aim",
        }),
      });
      if (!res.ok) {
        setTracerouteStatus("error");
        return;
      }
      const data = await res.json() as { hops: Array<{ url: string; latencyMs: number | null; error?: string }> };
      setTracerouteHops(data.hops || []);
      setTracerouteStatus("done");
    } catch {
      setTracerouteStatus("error");
    }
  };

  const copySummary = () => {
    const lines = [
      `${t("troubleshooting.inspector.export.summaryTitle")}`,
      `${"=".repeat(40)}`,
      `${t("troubleshooting.inspector.export.sessionId")}: ${session.sessionId}`,
      `${t("troubleshooting.inspector.export.outcome")}: ${session.overallStatus.toUpperCase()}`,
      `AI Firewall Provider: ${getEndpointLabel(credentials?.apiEndpoint || "aim")}`,
      `${t("troubleshooting.inspector.export.timestamp")}: ${formatDate(session.firstTimestamp)}`,
      `${t("troubleshooting.inspector.export.duration")}: ${totalDurationMs}ms`,
      `${t("troubleshooting.inspector.export.prompts")}: ${session.promptCount}`,
      `${t("troubleshooting.inspector.export.stages")}: ${sortedStages.length}`,
      ``,
      `${t("troubleshooting.inspector.export.stageBreakdown")}:`,
      ...sortedStages.map((s) => {
        const conf = extractConfidence(s.aimResponse);
        const confStr = conf !== null ? ` (${Math.round(conf * 100)}% confidence)` : "";
        return `  [${s.status.toUpperCase()}] ${getStageName(s)}${s.threatsDetected.length ? ` - ${s.threatsDetected.join(", ")}` : ""}${confStr}`;
      }),
    ];

    if (blockedRedactedStages.length > 0) {
      lines.push(``, `${t("troubleshooting.inspector.export.policiesTriggered")}:`);
      blockedRedactedStages.forEach((s) => {
        const entities = extractEntityTypes(s.aimResponse);
        const policy = extractPolicyName(s.aimResponse);
        if (entities.length || policy) {
          lines.push(`  ${getStageName(s)}: ${[policy, ...entities].filter(Boolean).join(", ")}`);
        }
      });
    }

    navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
    setSummaryCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setSummaryCopied(false), 2000);
  };

  const affectedInputCount = inputStages.filter((s) => s.status === "blocked" || s.status === "redacted").length;
  const affectedOutputCount = outputStages.filter((s) => s.status === "blocked" || s.status === "redacted").length;
  const diffSectionCount = (affectedInputCount > 0 ? 1 : 0) + (affectedOutputCount > 0 ? 1 : 0);

  return (
    <div className="flex flex-col h-full" data-testid="panel-session-inspector">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${outcomeBadgeClass(session.overallStatus)}`}
            >
              {session.overallStatus.toUpperCase()}
            </span>
            <h3 className="text-sm font-semibold text-foreground">{t("troubleshooting.inspector.title")}</h3>
          </div>
          <code className="text-xs text-muted-foreground font-mono mt-1 block truncate">
            {session.sessionId}
          </code>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            <span>{formatDate(session.firstTimestamp)}</span>
            <span>{session.promptCount} {t("troubleshooting.inspector.prompts")}</span>
            <span>{sortedStages.length} {t("troubleshooting.inspector.stagesCount")}</span>
            {totalDurationMs > 0 && <span>{totalDurationMs}ms {t("troubleshooting.inspector.total")}</span>}
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClose}
          data-testid="button-inspector-close"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b border-border px-4 overflow-x-auto">
            <TabsList className="h-9 gap-0 bg-transparent p-0 w-max">
              <TabsTrigger value="chain" className="text-xs h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3">
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                {t("troubleshooting.inspector.tabs.chainOfCustody")}
              </TabsTrigger>
              <TabsTrigger value="diff" className="text-xs h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3">
                <GitMerge className="w-3.5 h-3.5 mr-1.5" />
                {t("troubleshooting.inspector.tabs.diff")}
                {diffSectionCount > 0 && (
                  <span className="ml-1.5 bg-muted text-muted-foreground text-[10px] rounded px-1">{diffSectionCount}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="policy" className="text-xs h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3" disabled={blockedRedactedStages.length === 0}>
                <Shield className="w-3.5 h-3.5 mr-1.5" />
                {t("troubleshooting.inspector.tabs.policy")}
                {blockedRedactedStages.length > 0 && (
                  <span className="ml-1.5 bg-destructive/10 text-destructive text-[10px] rounded px-1">
                    {blockedRedactedStages.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="waterfall" className="text-xs h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3">
                <BarChart2 className="w-3.5 h-3.5 mr-1.5" />
                {t("troubleshooting.inspector.tabs.waterfall")}
              </TabsTrigger>
              <TabsTrigger value="replay" className="text-xs h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3" disabled={!activeReplayPrompt}>
                <Play className="w-3.5 h-3.5 mr-1.5" />
                {t("troubleshooting.inspector.tabs.replay")}
                {replayStatus === "done" && replayResult && (
                  <span className={`ml-1.5 text-[10px] rounded px-1 ${replayResult.outcome === "blocked" ? "bg-destructive/10 text-destructive" : replayResult.outcome === "redacted" ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" : "bg-green-500/10 text-green-600 dark:text-green-400"}`}>
                    {replayResult.outcome.toUpperCase()}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="export" className="text-xs h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3">
                <Download className="w-3.5 h-3.5 mr-1.5" />
                {t("troubleshooting.inspector.tabs.export")}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Chain of Custody */}
          <TabsContent value="chain" className="flex-1 overflow-y-auto p-4 space-y-3 mt-0">
            {sortedStages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("troubleshooting.inspector.chain.empty")}</p>
            ) : (
              sortedStages.map((stage, idx) => {
                const entities = extractEntityTypes(stage.aimResponse);
                const anonymized = extractAnonymizedText(stage.aimResponse);
                const isOutput = isOutputStage(stage);
                return (
                  <div key={stage.id} className="relative flex gap-3">
                    {idx < sortedStages.length - 1 && (
                      <div className="absolute left-[14px] top-7 bottom-0 w-px bg-border" />
                    )}
                    <div className="flex-shrink-0 mt-0.5">
                      {statusIcon(stage.status, "w-4 h-4")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-semibold text-foreground">{getStageName(stage)}</span>
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${outcomeBadgeClass(stage.status)}`}
                        >
                          {stage.status.toUpperCase()}
                        </span>
                        {isOutput && (
                          <span className="text-[10px] bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 rounded px-1.5 py-0.5">
                            {t("troubleshooting.inspector.chain.aiResponse")}
                          </span>
                        )}
                        {(() => {
                          const conf = extractConfidence(stage.aimResponse);
                          if (conf === null) return null;
                          const pct = Math.round(conf * 100);
                          return (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {pct}% confidence
                            </span>
                          );
                        })()}
                        <span className="text-[10px] text-muted-foreground">{formatTime(stage.timestamp)}</span>
                        {!isOutput && stage.userMessage && (
                          <button
                            type="button"
                            data-testid={`button-replay-stage-${stage.id}`}
                            onClick={() => replayStageRow(stage.userMessage, stage)}
                            disabled={replayStatus === "running"}
                            className="inline-flex items-center gap-1 text-[10px] text-primary hover-elevate px-1.5 py-0.5 rounded border border-primary/20 bg-primary/5 disabled:opacity-40 disabled:pointer-events-none"
                          >
                            {replayStatus === "running" && replayingStageId === stage.id
                              ? <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                              : <Play className="w-2.5 h-2.5" />
                            }
                            {replayStatus === "running" && replayingStageId === stage.id
                              ? t("troubleshooting.inspector.replay.running")
                              : t("troubleshooting.inspector.tabs.replay")
                            }
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground mb-2">{stage.actionTaken}</p>
                      {(() => {
                        const policyName = extractPolicyName(stage.aimResponse);
                        if (!policyName) return null;
                        return (
                          <p className="text-[10px] text-muted-foreground mb-2">
                            <span className="font-medium">{t("troubleshooting.inspector.policy.policyName")}:</span> {policyName}
                          </p>
                        );
                      })()}

                      {stage.userMessage && (
                        <div className="mb-2">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                            {isOutput ? t("troubleshooting.inspector.chain.rawAiOutput") : t("troubleshooting.inspector.chain.userInput")}
                          </p>
                          <div className="bg-muted/30 rounded p-2 text-xs font-mono text-foreground break-words">
                            {stage.userMessage}
                          </div>
                        </div>
                      )}

                      {anonymized && anonymized !== stage.userMessage && (
                        <div className="mb-2">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                            {isOutput ? t("troubleshooting.inspector.chain.finalOutput") : t("troubleshooting.inspector.chain.sanitizedOutput")}
                          </p>
                          <div className="bg-green-500/5 border border-green-500/20 rounded p-2 text-xs font-mono text-foreground break-words">
                            {anonymized}
                          </div>
                        </div>
                      )}

                      {entities.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                          <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          {entities.map((e) => (
                            <span key={e} className="text-[10px] bg-muted rounded px-1.5 py-0.5 text-muted-foreground">
                              {e}
                            </span>
                          ))}
                        </div>
                      )}

                      {stage.toolName && (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {t("troubleshooting.inspector.chain.tool")}: <span className="font-mono">{stage.toolName}</span>
                        </div>
                      )}

                      {/* Feature 2: Raw AI Firewall JSON viewer */}
                      {stage.aimResponse && (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => setExpandedJsonStageId(expandedJsonStageId === stage.id ? null : stage.id)}
                            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover-elevate px-1.5 py-0.5 rounded border border-border bg-muted/30"
                            data-testid={`button-toggle-json-${stage.id}`}
                          >
                            <span className="font-mono font-semibold">{"{ }"}</span>
                            <span>{expandedJsonStageId === stage.id ? t("troubleshooting.inspector.chain.hideJson") : t("troubleshooting.inspector.chain.rawJson")}</span>
                          </button>
                          {expandedJsonStageId === stage.id && (
                            <pre className="mt-1.5 bg-muted/40 border border-border rounded p-2 text-[10px] font-mono text-foreground overflow-x-auto overflow-y-auto max-h-48 whitespace-pre-wrap break-words">
                              {JSON.stringify(stage.aimResponse, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>

          {/* Diff View */}
          <TabsContent value="diff" className="flex-1 overflow-y-auto p-4 mt-0">
            <p className="text-xs text-muted-foreground mb-4">{t("troubleshooting.inspector.diff.description")}</p>
            {(() => {
              const affectedInputs = inputStages.filter((s) => s.status === "blocked" || s.status === "redacted");
              const affectedOutputs = outputStages.filter((s) => s.status === "blocked" || s.status === "redacted");
              if (affectedInputs.length === 0 && affectedOutputs.length === 0) {
                return <p className="text-sm text-muted-foreground text-center py-8">{t("troubleshooting.inspector.diff.empty")}</p>;
              }
              return (
                <div className="space-y-6">
                  {affectedInputs.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide mb-3">
                        {t("troubleshooting.inspector.diff.inputSection")}
                      </h4>
                      <div className="space-y-4">
                        {affectedInputs.map((stage) => {
                          const sanitized = extractAnonymizedText(stage.aimResponse, "user");
                          return (
                            <Card key={stage.id}>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-xs text-muted-foreground font-normal flex items-center gap-2">
                                  {statusIcon(stage.status)}
                                  {getStageName(stage)}
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="pt-0">
                                {stage.status === "blocked" ? (
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <p className="text-[11px] text-muted-foreground mb-1">{t("troubleshooting.inspector.diff.original")}</p>
                                      <div className="rounded-md bg-destructive/5 border border-destructive/20 p-3 text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
                                        {stage.userMessage || t("troubleshooting.inspector.diff.empty")}
                                      </div>
                                    </div>
                                    <div>
                                      <p className="text-[11px] text-muted-foreground mb-1">{t("troubleshooting.inspector.diff.forwarded")}</p>
                                      <div className="rounded-md bg-destructive/5 border border-destructive/30 p-3 text-xs font-mono text-destructive whitespace-pre-wrap break-words leading-relaxed flex items-center justify-center min-h-[60px]">
                                        {t("troubleshooting.inspector.diff.blockedNotForwarded")}
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <SpanDiff
                                    original={stage.userMessage}
                                    modified={sanitized ?? stage.userMessage}
                                    beforeLabel={t("troubleshooting.inspector.diff.original")}
                                    afterLabel={t("troubleshooting.inspector.diff.forwarded")}
                                    t={t}
                                  />
                                )}
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {affectedOutputs.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide mb-3">
                        {t("troubleshooting.inspector.diff.outputSection")}
                      </h4>
                      <div className="space-y-4">
                        {affectedOutputs.map((stage) => {
                          const sanitizedAssistant = extractAnonymizedText(stage.aimResponse, "assistant");
                          return (
                            <Card key={stage.id}>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-xs text-muted-foreground font-normal flex items-center gap-2">
                                  {statusIcon(stage.status)}
                                  {getStageName(stage)}
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="pt-0">
                                {stage.status === "blocked" ? (
                                  <div className="rounded-md bg-destructive/5 border border-destructive/30 p-3 text-xs font-mono text-destructive whitespace-pre-wrap break-words leading-relaxed flex items-center justify-center min-h-[60px]">
                                    {t("troubleshooting.inspector.diff.blockedNotReturned")}
                                  </div>
                                ) : sanitizedAssistant ? (
                                  <div>
                                    <p className="text-[11px] text-muted-foreground mb-1">{t("troubleshooting.inspector.diff.returnedToUser")}</p>
                                    <div className="rounded-md bg-yellow-500/5 border border-yellow-500/30 p-3 text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
                                      {sanitizedAssistant}
                                    </div>
                                    <p className="text-[10px] text-muted-foreground mt-1.5">{t("troubleshooting.inspector.diff.outputRedactedNote")}</p>
                                  </div>
                                ) : (
                                  <p className="text-xs text-muted-foreground italic">{t("troubleshooting.inspector.diff.noRedactedContent")}</p>
                                )}
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </TabsContent>

          {/* Policy & Rule Explainer */}
          <TabsContent value="policy" className="flex-1 overflow-y-auto p-4 mt-0">
            <p className="text-xs text-muted-foreground mb-4">{t("troubleshooting.inspector.policy.description")}</p>
            {blockedRedactedStages.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">{t("troubleshooting.inspector.policy.noPolicies")}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {blockedRedactedStages.map((stage, idx) => {
                  const entities = extractEntityTypes(stage.aimResponse);
                  const policy = extractPolicyName(stage.aimResponse);
                  const confidence = extractConfidence(stage.aimResponse);
                  const isBlocked = stage.status === "blocked";
                  const stageName = getStageName(stage);
                  const confPct = confidence !== null ? Math.round(confidence * 100) : null;
                  const entityList = entities.length > 0 ? entities.join(", ") : null;

                  const isInput = isInputStage(stage);
                  const isOutput = isOutputStage(stage);
                  const stageRole = isInput ? "user input" : isOutput ? "AI response" : "message";
                  const forwardTarget = isInput ? "the AI model" : "the user";

                  const replacementPairs = extractReplacementPairs(stage.aimResponse);
                  const anonymizedText = isBlocked ? null : extractAnonymizedText(stage.aimResponse, isOutput ? "assistant" : "user");
                  const roundTripMs = typeof stage.aimResponse?._durationMs === "number" ? (stage.aimResponse._durationMs as number) : null;

                  const sentSnippet = stage.userMessage
                    ? stage.userMessage.length > 120
                      ? `"${stage.userMessage.slice(0, 120)}..."`
                      : `"${stage.userMessage}"`
                    : null;

                  const timingClause = roundTripMs !== null
                    ? ` The AI Firewall took ${roundTripMs}ms to assess this content (round-trip including network transit from the ${brandedAppName} backend to the AI Firewall and back).`
                    : "";

                  const policyClause = policy ? ` the "${policy}" policy` : " an active security policy";
                  const confClause = confPct !== null ? ` with ${confPct}% confidence` : "";
                  const entityClause = entityList ? `, detecting the following content category: ${entityList}` : "";

                  const para1 = sentSnippet
                    ? `The text ${sentSnippet} was sent to the AI Firewall at the ${stageName} checkpoint for inspection. The firewall analysed it and found it matched${policyClause}${confClause}${entityClause}.${timingClause}`
                    : `The ${stageRole} was sent to the AI Firewall at the ${stageName} checkpoint for inspection. The firewall analysed it and found it matched${policyClause}${confClause}${entityClause}.${timingClause}`;

                  const para2 = isBlocked
                    ? `After matching the policy, the ${stageRole} was blocked completely. It was NOT forwarded to ${forwardTarget}. The pipeline halted at this checkpoint and the user received an error response instead.`
                    : replacementPairs.length > 0
                      ? `After matching the policy, the following substitutions were made: ${replacementPairs.map((p) => `"${p.original}" was anonymised and replaced with "${p.replacement}"`).join("; ")}. The sanitized version was forwarded to ${forwardTarget} in place of the original.`
                      : anonymizedText
                        ? `After matching the policy, the sensitive content was anonymised and replaced with neutral placeholders. The sanitized text forwarded to ${forwardTarget} was: "${anonymizedText.length > 200 ? anonymizedText.slice(0, 200) + "..." : anonymizedText}".`
                        : `After matching the policy, the sensitive portions of the ${stageRole} were automatically replaced with neutral placeholders. The cleaned-up version was forwarded to ${forwardTarget} instead of the original.`;

                  const para3 = isBlocked
                    ? `No data from this message was passed along. The end user received a notification that their message could not be processed due to a policy match.`
                    : `This means ${forwardTarget} only ever saw the sanitized content. The original sensitive data was never exposed to the AI model or returned to the user.`;

                  const para4 = isBlocked
                    ? `In plain terms: a ${isInput ? "message was sent" : "response was generated"} containing content your organization has classified as not allowed (${entityList ?? "a policy violation"}). The AI Firewall caught it and stopped it before any harm could occur.`
                    : `In plain terms: the ${stageRole} contained ${entityList ?? "sensitive data"} that your organization's policies say must be protected. Rather than blocking the whole conversation, the AI Firewall quietly cleaned out the sensitive parts and let the rest through.`;

                  const fullText = [para1, para2, para3, para4].join("\n\n");

                  return (
                    <div key={stage.id}>
                      {idx > 0 && <hr className="border-border mb-4" />}
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-3 flex-wrap">
                            {statusIcon(stage.status, "w-3.5 h-3.5")}
                            <span className="text-xs font-semibold text-foreground">{stageName}</span>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${outcomeBadgeClass(stage.status)}`}>
                              {stage.status.toUpperCase()}
                            </span>
                          </div>
                          <div className="space-y-3 bg-muted/30 rounded-md p-4" data-testid={`text-policy-paragraph-${stage.id}`}>
                            <p className="text-xs text-foreground leading-relaxed">{para1}</p>
                            <p className="text-xs text-foreground leading-relaxed">{para2}</p>
                            <p className="text-xs text-foreground leading-relaxed">{para3}</p>
                            <p className="text-xs text-muted-foreground leading-relaxed italic">{para4}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs flex-shrink-0 mt-8"
                          onClick={() => copyPolicyParagraph(stage.id, fullText)}
                          data-testid={`button-copy-policy-${stage.id}`}
                        >
                          {copiedPolicyId === stage.id ? (
                            <>
                              <CheckCircle className="w-3 h-3 mr-1.5 text-green-500" />
                              {t("troubleshooting.inspector.policy.copied")}
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 mr-1.5" />
                              {t("troubleshooting.inspector.policy.copy")}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Latency Waterfall */}
          <TabsContent value="waterfall" className="flex-1 overflow-y-auto p-4 mt-0">
            <p className="text-xs text-muted-foreground mb-4">{t("troubleshooting.inspector.waterfall.description")}</p>
            {stagesWithTiming.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("troubleshooting.inspector.waterfall.empty")}</p>
            ) : (
              <div className="space-y-4">
                {/* Summary stat cards */}
                {(() => {
                  const firewallStages = stagesWithTiming.filter(({ stage }) => stage.stage !== "openai");
                  const firewallMs = firewallStages.reduce((sum, { durationMs }) => sum + durationMs, 0);
                  const avgPerStageMs = firewallStages.length > 0 ? Math.round(firewallMs / firewallStages.length) : 0;
                  return (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-md border border-border bg-muted/30 p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("troubleshooting.inspector.waterfall.totalRoundTrip")}</span>
                        </div>
                        <p className="text-lg font-semibold text-foreground" data-testid="text-waterfall-network-rtt">{totalDurationMs}ms</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t("troubleshooting.inspector.waterfall.totalRoundTripHint")}</p>
                      </div>
                      <div className="rounded-md border border-border bg-muted/30 p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Activity className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("troubleshooting.inspector.waterfall.avgPerStage")}</span>
                        </div>
                        <p className="text-lg font-semibold text-foreground" data-testid="text-waterfall-firewall-time">{avgPerStageMs}ms</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t("troubleshooting.inspector.waterfall.avgPerStageHint")}</p>
                      </div>
                    </div>
                  );
                })()}

                {/* Collapsible stage breakdown */}
                <div>
                  <button
                    type="button"
                    className="flex items-center gap-2 text-xs font-medium text-foreground hover-elevate rounded px-2 py-1 -mx-2"
                    onClick={() => setWaterfallBreakdownOpen((v) => !v)}
                    data-testid="button-waterfall-breakdown-toggle"
                  >
                    {waterfallBreakdownOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {t("troubleshooting.inspector.waterfall.stageBreakdown")}
                  </button>
                  {waterfallBreakdownOpen && (
                    <div className="mt-3 space-y-3">
                      {stagesWithTiming.map(({ stage, durationMs }) => {
                        const pct = maxDuration > 0 ? Math.max((durationMs / maxDuration) * 100, 4) : 4;
                        const barColor =
                          stage.status === "blocked"
                            ? "bg-destructive"
                            : stage.status === "redacted"
                            ? "bg-yellow-500"
                            : "bg-green-500";

                        return (
                          <div key={stage.id} className="flex items-center gap-3">
                            <div className="w-28 flex-shrink-0 text-right">
                              <p className="text-xs font-medium text-foreground truncate">{getStageName(stage)}</p>
                            </div>
                            <div className="flex-1 flex items-center gap-2">
                              <div className="flex-1 bg-muted/40 rounded-full h-5 relative">
                                <div
                                  className={`h-5 rounded-full ${barColor} transition-all`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-14 flex-shrink-0 text-right">
                                {durationMs}ms
                              </span>
                            </div>
                          </div>
                        );
                      })}

                      {/* Total bar */}
                      <div className="flex items-center gap-3 pt-2 border-t border-border">
                        <div className="w-28 flex-shrink-0 text-right">
                          <p className="text-xs font-semibold text-foreground">{t("troubleshooting.inspector.waterfall.total")}</p>
                        </div>
                        <div className="flex-1 flex items-center gap-2">
                          <div className="flex-1 bg-primary/20 rounded-full h-5">
                            <div className="h-5 rounded-full bg-primary w-full" />
                          </div>
                          <span className="text-xs font-semibold text-foreground w-14 flex-shrink-0 text-right">
                            {totalDurationMs}ms
                          </span>
                        </div>
                      </div>

                      {totalDurationMs === 0 && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                          <Minus className="w-3 h-3" />
                          {t("troubleshooting.inspector.waterfall.sameTimestamp")}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Traceroute */}
                <div className="pt-2 border-t border-border">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Network className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-foreground">{t("troubleshooting.inspector.waterfall.traceroute")}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={runTraceroute}
                      disabled={tracerouteStatus === "running"}
                      data-testid="button-run-traceroute"
                    >
                      {tracerouteStatus === "running" ? (
                        <>
                          <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                          {t("troubleshooting.inspector.waterfall.tracerouteRunning")}
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 mr-1.5" />
                          {t("troubleshooting.inspector.waterfall.tracerouteRun")}
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-3">{t("troubleshooting.inspector.waterfall.tracerouteHint")}</p>
                  {tracerouteStatus === "error" && (
                    <div className="flex items-center gap-2 text-xs text-destructive p-2 bg-destructive/10 rounded-md">
                      <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      {t("troubleshooting.inspector.waterfall.tracerouteError")}
                    </div>
                  )}
                  {tracerouteStatus === "done" && tracerouteHops.length > 0 && (
                    <div className="space-y-1.5">
                      {tracerouteHops.map((hop, idx) => (
                        <div key={idx} className="flex items-center gap-3 text-xs">
                          <span className="w-5 text-muted-foreground font-mono flex-shrink-0 text-right">{idx + 1}</span>
                          <span className="flex-1 font-mono text-foreground truncate" title={hop.url}>{hop.url}</span>
                          {hop.error ? (
                            <span className="text-destructive text-[11px] flex-shrink-0">{hop.error}</span>
                          ) : (
                            <span className="text-muted-foreground font-mono flex-shrink-0 w-14 text-right">
                              {hop.latencyMs !== null ? `${hop.latencyMs}ms` : "—"}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Replay Tab */}
          <TabsContent value="replay" className="flex-1 overflow-y-auto p-4 mt-0">
            {/* Controls */}
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-3">
                {t("troubleshooting.inspector.replay.description")}
              </p>

              {/* Editable prompt textarea (Feature 1) */}
              <div className="mb-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{t("troubleshooting.inspector.replay.promptLabel")}</p>
                <Textarea
                  className="text-xs font-mono min-h-[80px] resize-y"
                  placeholder={t("troubleshooting.inspector.replay.editPromptPlaceholder")}
                  value={editablePromptValue ?? activeReplayPrompt}
                  onChange={(e) => setEditablePromptValue(e.target.value)}
                  disabled={replayStatus === "running"}
                  data-testid="textarea-replay-prompt"
                />
              </div>

              {/* Firewall toggle + Run button + Reset */}
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <div
                    role="switch"
                    aria-checked={replayFirewall}
                    data-testid="toggle-replay-firewall"
                    onClick={() => {
                      setReplayFirewall((v) => !v);
                      setComparisonResult(null);
                      setComparisonStatus("idle");
                      setComparisonError(null);
                      setShowComparison(false);
                    }}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${replayFirewall ? "bg-primary" : "bg-muted-foreground/30"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${replayFirewall ? "translate-x-4" : "translate-x-0.5"}`} />
                  </div>
                  <span className="text-xs text-foreground">{t("troubleshooting.inspector.replay.firewallToggle")}</span>
                </label>

                <Button
                  size="sm"
                  variant="default"
                  className="h-8 text-xs"
                  onClick={runReplay}
                  disabled={replayStatus === "running" || !(editablePromptValue ?? activeReplayPrompt)}
                  data-testid="button-run-replay"
                >
                  {replayStatus === "running" ? (
                    <>
                      <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                      {t("troubleshooting.inspector.replay.running")}
                    </>
                  ) : replayStatus === "done" ? (
                    <>
                      <RotateCcw className="w-3 h-3 mr-1.5" />
                      {t("troubleshooting.inspector.replay.runAgain")}
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3 mr-1.5" />
                      {t("troubleshooting.inspector.replay.run")}
                    </>
                  )}
                </Button>

                {/* Reset to original button — only shown when textarea differs from defaultPrompt */}
                {(editablePromptValue ?? activeReplayPrompt) !== defaultPrompt && defaultPrompt && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => {
                      setEditablePromptValue(defaultPrompt);
                      setReplayPromptOverride(null);
                    }}
                    disabled={replayStatus === "running"}
                    data-testid="button-reset-replay-prompt"
                  >
                    <RotateCcw className="w-3 h-3 mr-1.5" />
                    {t("troubleshooting.inspector.replay.resetPrompt")}
                  </Button>
                )}
              </div>
            </div>

            {/* Error state */}
            {replayStatus === "error" && replayError && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-md mb-4">
                <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{replayError}</p>
              </div>
            )}

            {/* Side-by-side comparison */}
            {replayStatus === "done" && replayResult && (
              <div className="space-y-4">
                {/* Outcome comparison header */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Original */}
                  {/* When a specific row was selected for replay, show that row's data.
                      Otherwise fall back to session-level aggregate for context. */}
                  <div className="border border-border rounded-md p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">{t("troubleshooting.inspector.replay.original")}</p>
                    <div className="flex items-center gap-2 mb-2">
                      {statusIcon(replayOriginalStage?.status ?? session.overallStatus, "w-4 h-4")}
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${outcomeBadgeClass(replayOriginalStage?.status ?? session.overallStatus)}`}>
                        {(replayOriginalStage?.status ?? session.overallStatus).toUpperCase()}
                      </span>
                    </div>
                    {replayOriginalStage ? (
                      <>
                        <p className="text-xs text-muted-foreground">{getStageName(replayOriginalStage)}</p>
                        <p className="text-xs text-muted-foreground mb-2">{replayOriginalStage.actionTaken}</p>
                        {replayOriginalStage.userMessage && (
                          <div className="mt-2">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{t("troubleshooting.inspector.replay.promptLabel")}</p>
                            <div className="bg-muted/20 border border-border rounded p-2 text-[10px] font-mono text-foreground break-words max-h-20 overflow-y-auto">
                              {replayOriginalStage.userMessage}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">{sortedStages.length} {t("troubleshooting.inspector.stagesCount")}</p>
                        <p className="text-xs text-muted-foreground">{totalDurationMs}ms {t("troubleshooting.inspector.total")}</p>
                        {/* Original stage list with timing (matches replay stage list format) */}
                        <div className="mt-3 space-y-1.5">
                          {stagesWithTiming.map(({ stage: s, durationMs }) => (
                            <div key={s.id} className="flex items-center gap-1.5 text-[10px]">
                              {statusIcon(s.status, "w-3 h-3")}
                              <span className="text-foreground truncate">{getStageName(s)}</span>
                              <span className="text-muted-foreground font-mono ml-1">{durationMs}ms</span>
                              <span className={`ml-auto px-1 rounded ${outcomeBadgeClass(s.status)} text-[9px]`}>{s.status.toUpperCase()}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {/* Original final AI response (from last output stage) */}
                    {!replayOriginalStage && outputStages.length > 0 && outputStages[outputStages.length - 1].userMessage && (
                      <div className="mt-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{t("troubleshooting.inspector.replay.aiResponseLabel")}</p>
                        <div className="bg-muted/20 border border-border rounded p-2 text-[10px] font-mono text-foreground break-words max-h-24 overflow-y-auto">
                          {outputStages[outputStages.length - 1].userMessage}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Replay */}
                  <div className={`border rounded-md p-3 ${replayResult.outcome !== (replayOriginalStage?.status ?? session.overallStatus) ? "border-primary/50 bg-primary/5" : "border-border"}`}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("troubleshooting.inspector.replay.replay")}</p>
                      {!replayFirewall && (
                        <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">{t("troubleshooting.inspector.replay.noFirewall")}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      {statusIcon(replayResult.outcome, "w-4 h-4")}
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${outcomeBadgeClass(replayResult.outcome)}`}>
                        {replayResult.outcome.toUpperCase()}
                      </span>
                      {replayResult.outcome !== (replayOriginalStage?.status ?? session.overallStatus) && (
                        <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 rounded px-1.5 py-0.5">
                          {t("troubleshooting.inspector.replay.changed")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{replayResult.stages.length} {t("troubleshooting.inspector.stagesCount")}</p>
                    {/* Replay stage list */}
                    <div className="mt-3 space-y-1.5">
                      {replayResult.stages.map((rs, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[10px]">
                          {statusIcon(rs.status, "w-3 h-3")}
                          <span className="text-foreground truncate">{stageLabel(rs.stage, rs.stageName)}</span>
                          <span className="text-muted-foreground font-mono ml-1">{rs.durationMs}ms</span>
                          <span className={`ml-auto px-1 rounded ${outcomeBadgeClass(rs.status)} text-[9px]`}>{rs.status.toUpperCase()}</span>
                        </div>
                      ))}
                    </div>
                    {/* Replay final AI response */}
                    {replayResult.aiResponse && (
                      <div className="mt-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{t("troubleshooting.inspector.replay.aiResponseLabel")}</p>
                        <div className="bg-muted/20 border border-border rounded p-2 text-[10px] font-mono text-foreground break-words max-h-24 overflow-y-auto">
                          {replayResult.aiResponse}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Change banner — compare against the selected stage's status (not session aggregate) */}
                {replayResult.outcome !== (replayOriginalStage?.status ?? session.overallStatus) ? (
                  <div className="flex items-start gap-2 p-3 bg-primary/5 border border-primary/20 rounded-md">
                    <AlertTriangle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-foreground">
                      {t("troubleshooting.inspector.replay.outcomeChanged")
                        .replace("{from}", (replayOriginalStage?.status ?? session.overallStatus).toUpperCase())
                        .replace("{to}", replayResult.outcome.toUpperCase())}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 p-3 bg-muted/30 border border-border rounded-md">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-foreground">{t("troubleshooting.inspector.replay.outcomeUnchanged")}</p>
                  </div>
                )}

                {/* Replay stages breakdown */}
                {replayResult.stages.length > 0 && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">{t("troubleshooting.inspector.replay.replayStages")}</p>
                    <div className="space-y-2">
                      {replayResult.stages.map((rs, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs">
                          {statusIcon(rs.status, "w-3.5 h-3.5 mt-0.5")}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium text-foreground">{stageLabel(rs.stage, rs.stageName)}</span>
                              <span className={`inline-flex items-center px-1 py-0 rounded text-[9px] font-medium border ${outcomeBadgeClass(rs.status)}`}>
                                {rs.status.toUpperCase()}
                              </span>
                              <span className="text-muted-foreground font-mono">{rs.durationMs}ms</span>
                            </div>
                            <p className="text-muted-foreground mt-0.5">{rs.actionKey ? t(rs.actionKey) : rs.actionTaken}</p>
                            {rs.threatsDetected.length > 0 && (
                              <div className="flex gap-1 flex-wrap mt-0.5">
                                {rs.threatsDetected.map((th) => (
                                  <span key={th} className="text-[10px] bg-muted rounded px-1.5 py-0.5 text-muted-foreground">{th}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI Response preview */}
                {replayResult.aiResponse && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{t("troubleshooting.inspector.replay.aiResponseLabel")}</p>
                    <div className="bg-muted/20 border border-border rounded-md p-3 text-xs text-foreground break-words max-h-36 overflow-y-auto">
                      {replayResult.aiResponse}
                    </div>
                  </div>
                )}

                {/* Copy comparison + Compare toggle */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant={showComparison ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => {
                      if (showComparison) {
                        setShowComparison(false);
                      } else if (comparisonStatus === "done" && comparisonResult) {
                        setShowComparison(true);
                      } else {
                        runComparison();
                      }
                    }}
                    disabled={comparisonStatus === "running"}
                    data-testid="button-compare-firewall"
                  >
                    {comparisonStatus === "running" ? (
                      <>
                        <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                        {t("troubleshooting.inspector.replay.comparisonRunning")}
                      </>
                    ) : showComparison ? (
                      <>
                        <X className="w-3 h-3 mr-1.5" />
                        {t("troubleshooting.inspector.replay.dismissComparison")}
                      </>
                    ) : (
                      <>
                        <SplitSquareHorizontal className="w-3 h-3 mr-1.5" />
                        {replayFirewall
                          ? t("troubleshooting.inspector.replay.compareWithout")
                          : t("troubleshooting.inspector.replay.compareWith")}
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={copyReplayComparison}
                    data-testid="button-copy-replay-comparison"
                  >
                    {replayCopied ? (
                      <>
                        <CheckCircle className="w-3 h-3 mr-1.5 text-green-500" />
                        {t("troubleshooting.inspector.replay.copied")}
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 mr-1.5" />
                        {t("troubleshooting.inspector.replay.copyComparison")}
                      </>
                    )}
                  </Button>
                </div>

                {/* Comparison error */}
                {comparisonStatus === "error" && comparisonError && (
                  <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-md">
                    <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-destructive">{comparisonError}</p>
                  </div>
                )}

                {/* Side-by-side comparison */}
                {showComparison && comparisonResult && (
                  <div className="pt-2 border-t border-border space-y-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                      {t("troubleshooting.inspector.replay.comparisonHeading")}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Protected column */}
                      {(() => {
                        const protectedResult = replayFirewall ? replayResult : comparisonResult;
                        return (
                          <div className="border border-green-500/30 bg-green-500/5 rounded-md p-3 space-y-2">
                            <p className="text-[10px] font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide flex items-center gap-1">
                              <Shield className="w-3 h-3" />
                              {t("troubleshooting.inspector.replay.protectedColumn")}
                            </p>
                            <div className="flex items-center gap-2">
                              {statusIcon(protectedResult.outcome, "w-4 h-4")}
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${outcomeBadgeClass(protectedResult.outcome)}`}>
                                {protectedResult.outcome.toUpperCase()}
                              </span>
                            </div>
                            <div className="space-y-1">
                              {protectedResult.stages.map((rs, idx) => (
                                <div key={idx} className="flex items-center gap-1.5">
                                  <span className={`inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium border ${outcomeBadgeClass(rs.status)}`}>
                                    {rs.status.toUpperCase()}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground truncate">{rs.stageName || rs.stage}</span>
                                </div>
                              ))}
                            </div>
                            {protectedResult.aiResponse && (
                              <div>
                                <p className="text-[10px] text-muted-foreground mb-1">{t("troubleshooting.inspector.replay.aiResponseLabel")}</p>
                                <div className="bg-muted/20 border border-border rounded p-2 text-[10px] font-mono text-foreground break-words max-h-20 overflow-y-auto">
                                  {protectedResult.aiResponse}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Unprotected column */}
                      {(() => {
                        const unprotectedResult = replayFirewall ? comparisonResult : replayResult;
                        return (
                          <div className="border border-destructive/30 bg-destructive/5 rounded-md p-3 space-y-2">
                            <p className="text-[10px] font-semibold text-destructive uppercase tracking-wide">
                              {t("troubleshooting.inspector.replay.unprotectedColumn")}
                            </p>
                            <div className="flex items-center gap-2">
                              {statusIcon(unprotectedResult.outcome, "w-4 h-4")}
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${outcomeBadgeClass(unprotectedResult.outcome)}`}>
                                {unprotectedResult.outcome.toUpperCase()}
                              </span>
                            </div>
                            <div className="space-y-1">
                              {unprotectedResult.stages.map((rs, idx) => (
                                <div key={idx} className="flex items-center gap-1.5">
                                  <span className={`inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium border ${outcomeBadgeClass(rs.status)}`}>
                                    {rs.status.toUpperCase()}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground truncate">{rs.stageName || rs.stage}</span>
                                </div>
                              ))}
                            </div>
                            {unprotectedResult.aiResponse && (
                              <div>
                                <p className="text-[10px] text-muted-foreground mb-1">{t("troubleshooting.inspector.replay.aiResponseLabel")}</p>
                                <div className="bg-muted/20 border border-border rounded p-2 text-[10px] font-mono text-foreground break-words max-h-20 overflow-y-auto">
                                  {unprotectedResult.aiResponse}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Security impact callout */}
                    {(() => {
                      const protectedResult = replayFirewall ? replayResult : comparisonResult;
                      const unprotectedResult = replayFirewall ? comparisonResult : replayResult;
                      const firewallBlocked = protectedResult.outcome === "blocked" || protectedResult.outcome === "redacted";
                      const unprotectedAllowed = unprotectedResult.outcome === "allowed";
                      if (firewallBlocked && unprotectedAllowed) {
                        return (
                          <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-md">
                            <Shield className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-foreground font-medium">
                              {t("troubleshooting.inspector.replay.securityImpactCallout")}
                            </p>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Idle state hint */}
            {replayStatus === "idle" && (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <Play className="w-8 h-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">{t("troubleshooting.inspector.replay.idle")}</p>
              </div>
            )}
          </TabsContent>

          {/* Evidence Export Tab */}
          <TabsContent value="export" className="flex-1 overflow-hidden flex flex-col p-0 mt-0">
            <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs flex-shrink-0"
                onClick={copyExportPreview}
                data-testid="button-export-copy-clipboard"
              >
                {exportPreviewCopied ? (
                  <>
                    <CheckCircle className="w-3 h-3 mr-1.5 text-green-500" />
                    {t("troubleshooting.inspector.export.copied")}
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 mr-1.5" />
                    {t("troubleshooting.inspector.export.copyToClipboard")}
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs flex-shrink-0"
                onClick={downloadMarkdown}
                data-testid="button-export-download-md"
              >
                <Download className="w-3 h-3 mr-1.5" />
                {t("troubleshooting.inspector.export.downloadMd")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs flex-shrink-0 ml-auto"
                onClick={downloadEvidence}
                data-testid="button-export-json"
              >
                <Download className="w-3 h-3 mr-1.5" />
                {t("troubleshooting.inspector.export.downloadJson")}
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed" data-testid="text-export-preview">
                {buildMarkdownExport(session, replayResult, t, credentials?.apiEndpoint || "aim")}
              </pre>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

