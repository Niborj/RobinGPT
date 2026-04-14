import { v4 as uuidv4 } from "uuid";

export type AimActionType = "block_action" | "monitor_action" | "anonymize_action" | "none";
export type DetectionCertainty = "LOW" | "MODERATE" | "HIGH" | string;
export type GroundTruthClassification = "TP" | "FP" | "FN" | "TN" | "UNK";

export interface BulkPromptInput {
  id: string;
  prompt: string;
  expectedFlagged?: boolean | null;
  expectedPolicy?: string;
  expectedAction?: string;
}

export interface AimDetection {
  message: string;
  certainty: DetectionCertainty | null;
  policyId: string;
  policyName: string;
}

export interface BulkResultDetail {
  id: string;
  promptId: string;
  prompt: string;
  promptSnippet: string;
  status: "ok" | "error";
  errorMessage?: string;
  flagged: boolean;
  actionType: AimActionType;
  triggeredPolicyNames: string[];
  detections: AimDetection[];
  maxCertainty?: string;
  detectionsCount: number;
  analysisTimeMs?: number;
  rttMs?: number;
  redactedPreview?: string;
  expectedFlagged?: boolean | null;
  expectedPolicy?: string;
  expectedAction?: string;
  groundTruthClassification?: GroundTruthClassification;
  rawResponse?: any;
}

export interface BulkRunKpis {
  total: number;
  completed: number;
  flaggedCount: number;
  flaggedPct: number;
  errorCount: number;
  actionBreakdown: Record<AimActionType, number>;
  categoryCounts: Record<string, number>;
  latencyP50?: number;
  latencyP95?: number;
  firewallLatencyP50?: number;
  firewallLatencyP95?: number;
  firewallLatencyP99?: number;
  networkLatencyP50?: number;
  networkLatencyP95?: number;
  networkLatencyP99?: number;
  totalRttP50?: number;
  totalRttP95?: number;
  totalRttP99?: number;
  groundTruth: {
    tp: number;
    fp: number;
    fn: number;
    tn: number;
    accuracy?: number;
    precision?: number;
    recall?: number;
    f1?: number;
  };
}

export interface BulkRunProgress {
  runId: string;
  status: "running" | "completed" | "stopped" | "failed";
  kpis: BulkRunKpis;
  results: BulkResultDetail[];
  failureReason?: string;
}

export interface BulkIncrementalUpdate {
  type: "incremental";
  runId: string;
  status: "running";
  kpis: BulkRunKpis;
  latestResult: Omit<BulkResultDetail, "rawResponse">;
}

interface RunningState {
  completedCount: number;
  flaggedCount: number;
  errorCount: number;
  actionBreakdown: Record<AimActionType, number>;
  categoryCounts: Record<string, number>;
  latencies: number[];
  firewallLatencies: number[];
  networkLatencies: number[];
  totalRttLatencies: number[];
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

function makeRunningState(): RunningState {
  return {
    completedCount: 0,
    flaggedCount: 0,
    errorCount: 0,
    actionBreakdown: { block_action: 0, monitor_action: 0, anonymize_action: 0, none: 0 },
    categoryCounts: {},
    latencies: [],
    firewallLatencies: [],
    networkLatencies: [],
    totalRttLatencies: [],
    tp: 0,
    fp: 0,
    fn: 0,
    tn: 0,
  };
}

function applyResultToRunningState(state: RunningState, detail: BulkResultDetail): void {
  state.completedCount++;
  if (detail.status === "error") {
    state.errorCount++;
    return;
  }
  if (detail.flagged) state.flaggedCount++;
  state.actionBreakdown[detail.actionType] = (state.actionBreakdown[detail.actionType] || 0) + 1;
  for (const pName of detail.triggeredPolicyNames) {
    state.categoryCounts[pName] = (state.categoryCounts[pName] || 0) + 1;
  }
  const latencyVal = detail.analysisTimeMs !== undefined ? detail.analysisTimeMs : detail.rttMs;
  if (latencyVal !== undefined) state.latencies.push(latencyVal);

  if (detail.analysisTimeMs !== undefined) {
    state.firewallLatencies.push(detail.analysisTimeMs);
  }
  if (detail.rttMs !== undefined) {
    state.totalRttLatencies.push(detail.rttMs);
    if (detail.analysisTimeMs !== undefined) {
      const networkMs = detail.rttMs - detail.analysisTimeMs;
      if (networkMs >= 0) state.networkLatencies.push(networkMs);
    }
  }

  if (detail.groundTruthClassification === "TP") state.tp++;
  else if (detail.groundTruthClassification === "FP") state.fp++;
  else if (detail.groundTruthClassification === "FN") state.fn++;
  else if (detail.groundTruthClassification === "TN") state.tn++;
}

function buildKpisFromState(state: RunningState, total: number): BulkRunKpis {
  const completed = state.completedCount;
  const flaggedPct = completed > 0 ? Math.round((state.flaggedCount / completed) * 10000) / 100 : 0;

  const { tp, fp, fn, tn } = state;
  const gtTotal = tp + fp + fn + tn;
  let accuracy: number | undefined;
  let precision: number | undefined;
  let recall: number | undefined;
  let f1: number | undefined;

  if (gtTotal > 0) accuracy = (tp + tn) / gtTotal;
  if (tp + fp > 0) precision = tp / (tp + fp);
  if (tp + fn > 0) recall = tp / (tp + fn);
  if (precision !== undefined && recall !== undefined && (precision + recall) > 0) {
    f1 = (2 * precision * recall) / (precision + recall);
  }

  const latencies = state.latencies;
  const latencyP50 = percentile(latencies, 50);
  const latencyP95 = percentile(latencies, 95);

  const firewallLatencyP50 = percentile(state.firewallLatencies, 50);
  const firewallLatencyP95 = percentile(state.firewallLatencies, 95);
  const firewallLatencyP99 = percentile(state.firewallLatencies, 99);
  const networkLatencyP50 = percentile(state.networkLatencies, 50);
  const networkLatencyP95 = percentile(state.networkLatencies, 95);
  const networkLatencyP99 = percentile(state.networkLatencies, 99);
  const totalRttP50 = percentile(state.totalRttLatencies, 50);
  const totalRttP95 = percentile(state.totalRttLatencies, 95);
  const totalRttP99 = percentile(state.totalRttLatencies, 99);

  return {
    total,
    completed,
    flaggedCount: state.flaggedCount,
    flaggedPct,
    errorCount: state.errorCount,
    actionBreakdown: { ...state.actionBreakdown },
    categoryCounts: { ...state.categoryCounts },
    latencyP50,
    latencyP95,
    firewallLatencyP50,
    firewallLatencyP95,
    firewallLatencyP99,
    networkLatencyP50,
    networkLatencyP95,
    networkLatencyP99,
    totalRttP50,
    totalRttP95,
    totalRttP99,
    groundTruth: { tp, fp, fn, tn, accuracy, precision, recall, f1 },
  };
}

function getAimApiUrl(endpoint?: string): string {
  if (endpoint === "cato") {
    return "https://api.aisec.catonetworks.com/fw/v1/analyze";
  }
  if (endpoint === "cato-us1") {
    return "https://api.aisec.us1.catonetworks.com/fw/v1/analyze";
  }
  return "https://api.aim.security/fw/v1/analyze";
}

interface NormalizedAimResponse {
  actionType: AimActionType;
  flagged: boolean;
  triggeredPolicyNames: string[];
  detections: AimDetection[];
  maxCertainty?: string;
  analysisTimeMs?: number;
  redactedPreview?: string;
}

function normalizeAimResponse(raw: any): NormalizedAimResponse {
  if (!raw || typeof raw !== "object") {
    return {
      actionType: "none",
      flagged: false,
      triggeredPolicyNames: [],
      detections: [],
      maxCertainty: undefined,
      analysisTimeMs: undefined,
      redactedPreview: undefined,
    };
  }

  const requiredAction = raw.required_action;
  let actionType: AimActionType = "none";
  if (requiredAction && requiredAction.action_type) {
    const at = requiredAction.action_type;
    if (at === "block_action" || at === "block") {
      actionType = "block_action";
    } else if (at === "monitor_action" || at === "monitor") {
      actionType = "monitor_action";
    } else if (at === "anonymize_action" || at === "anonymize") {
      actionType = "anonymize_action";
    }
  }

  const policyDrillDown = raw.analysis_result?.policy_drill_down;
  const policies: Array<{ policyId: string; policyName: string; detections: any[] }> = [];

  if (Array.isArray(policyDrillDown)) {
    for (const policy of policyDrillDown) {
      if (!policy || typeof policy !== "object") continue;
      const policyId = policy.policy_id || policy.policyId || "";
      const policyName = policy.policy_name || policy.policyName || policyId || "Unknown Policy";
      const rawDetections = policy.detections || policy.detection_list || [];
      const detectionsList = Array.isArray(rawDetections) ? rawDetections : [];
      policies.push({ policyId, policyName, detections: detectionsList });
    }
  } else if (policyDrillDown && typeof policyDrillDown === "object") {
    for (const [policyId, policyData] of Object.entries(policyDrillDown)) {
      if (!policyData || typeof policyData !== "object") continue;
      const pd = policyData as any;
      const policyName = pd.policy_name || pd.policyName || policyId || "Unknown Policy";
      const rawDetections = pd.detections || pd.detection_list || [];
      const detectionsList = Array.isArray(rawDetections) ? rawDetections : [];
      policies.push({ policyId, policyName, detections: detectionsList });
    }
  }

  const flatDetections: AimDetection[] = [];
  const triggeredPolicyNames: string[] = [];

  for (const policy of policies) {
    if (policy.detections.length > 0) {
      if (!triggeredPolicyNames.includes(policy.policyName)) {
        triggeredPolicyNames.push(policy.policyName);
      }
      for (const det of policy.detections) {
        if (!det || typeof det !== "object") continue;
        flatDetections.push({
          message: det.message || det.description || det.detection_message || "",
          certainty: det.certainty || det.confidence || null,
          policyId: policy.policyId,
          policyName: policy.policyName,
        });
      }
    }
  }

  const certaintyOrder: Record<string, number> = { LOW: 1, MODERATE: 2, HIGH: 3 };
  let maxCertainty: string | undefined;
  for (const det of flatDetections) {
    if (det.certainty) {
      const upper = det.certainty.toUpperCase();
      if (!maxCertainty || (certaintyOrder[upper] || 0) > (certaintyOrder[maxCertainty.toUpperCase()] || 0)) {
        maxCertainty = upper;
      }
    }
  }

  const analysisTimeMs = raw.analysis_result?.analysis_time_ms
    || raw.analysis_result?.analysisTimeMs
    || raw.analysisTimeMs
    || undefined;

  let redactedPreview: string | undefined;
  if (raw.redacted_chat?.all_redacted_messages) {
    const msgs = raw.redacted_chat.all_redacted_messages;
    if (Array.isArray(msgs) && msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      if (last && last.content) {
        redactedPreview = last.content;
      }
    }
  }

  const redactionTokenPattern = /\[[A-Z_]+_\d+\]/;
  let hasRedactionTokens = redactedPreview ? redactionTokenPattern.test(redactedPreview) : false;

  if (!hasRedactionTokens) {
    for (const det of flatDetections) {
      if (det.message && redactionTokenPattern.test(det.message)) {
        hasRedactionTokens = true;
        break;
      }
    }
  }

  if (!hasRedactionTokens && raw.redacted_text && typeof raw.redacted_text === "string") {
    if (redactionTokenPattern.test(raw.redacted_text)) {
      hasRedactionTokens = true;
      if (!redactedPreview) {
        redactedPreview = raw.redacted_text;
      }
    }
  }

  if (!hasRedactionTokens) {
    const rawStr = JSON.stringify(raw);
    if (redactionTokenPattern.test(rawStr)) {
      hasRedactionTokens = true;
    }
  }

  if (hasRedactionTokens && actionType === "none") {
    actionType = "anonymize_action";
  }

  if (hasRedactionTokens && !redactedPreview) {
    const allTokens: string[] = [];
    const globalPattern = /\[[A-Z_]+_\d+\]/g;
    for (const det of flatDetections) {
      if (det.message) {
        const matches = det.message.match(globalPattern);
        if (matches) allTokens.push(...matches);
      }
    }
    if (allTokens.length > 0) {
      redactedPreview = `Redacted tokens: ${Array.from(new Set(allTokens)).join(", ")}`;
    }
  }

  const flagged = actionType !== "none" || triggeredPolicyNames.length > 0 || hasRedactionTokens;

  return {
    actionType,
    flagged,
    triggeredPolicyNames,
    detections: flatDetections,
    maxCertainty,
    analysisTimeMs,
    redactedPreview,
  };
}

function classifyGroundTruth(
  expectedFlagged: boolean | null | undefined,
  observedFlagged: boolean
): GroundTruthClassification {
  if (expectedFlagged === null || expectedFlagged === undefined) return "UNK";
  if (expectedFlagged && observedFlagged) return "TP";
  if (expectedFlagged && !observedFlagged) return "FN";
  if (!expectedFlagged && observedFlagged) return "FP";
  return "TN";
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function promptSnippet(prompt: string, size = 120): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= size) return normalized;
  return normalized.slice(0, size) + "...";
}

async function callAimAnalyze(options: {
  prompt: string;
  apiKey: string;
  userEmail?: string;
  sessionId: string;
  aimApiUrl: string;
  silent?: boolean;
}): Promise<{ ok: boolean; status: number; rttMs: number; response?: any; error?: string; requestHeaders: Record<string, string> }> {
  const t0 = Date.now();
  const callId = uuidv4();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": "application/json",
    "x-aim-call-id": callId,
    "x-aim-session-id": options.sessionId,
  };
  if (options.userEmail) headers["x-aim-user-email"] = options.userEmail;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(options.aimApiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: options.prompt }] }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const rttMs = Date.now() - t0;
    const text = await response.text();
    let json: any;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }

    if (!response.ok) {
      if (!options.silent) {
        console.error(`[BulkAnalyze] API error ${response.status} for prompt "${options.prompt.slice(0, 60)}...": ${text.slice(0, 200)}`);
      }
      return { ok: false, status: response.status, rttMs, error: json?.message || json?.error || text || `HTTP ${response.status}`, requestHeaders: headers };
    }
    if (!options.silent) {
      console.log(`[BulkAnalyze] OK ${response.status} rtt=${rttMs}ms action=${json?.required_action?.action_type || 'none'} for prompt "${options.prompt.slice(0, 60)}..."`);
    }
    return { ok: true, status: response.status, rttMs, response: json, requestHeaders: headers };
  } catch (error) {
    return { ok: false, status: 0, rttMs: Date.now() - t0, error: String(error), requestHeaders: headers };
  }
}

class SlidingWindowLimiter {
  private secondWindow: number[] = [];
  private minuteWindow: number[] = [];
  constructor(private readonly rpsLimit: number, private readonly rpmLimit: number) {}
  async waitForSlot(): Promise<void> {
    while (true) {
      const now = Date.now();
      this.secondWindow = this.secondWindow.filter(ts => now - ts < 1000);
      this.minuteWindow = this.minuteWindow.filter(ts => now - ts < 60000);
      if (this.secondWindow.length < this.rpsLimit && this.minuteWindow.length < this.rpmLimit) {
        this.secondWindow.push(now);
        this.minuteWindow.push(now);
        return;
      }
      await new Promise(r => setTimeout(r, 200));
    }
  }
}


export async function processBulkAnalysis(options: {
  prompts: BulkPromptInput[];
  apiKey: string;
  userEmail?: string;
  aimApiEndpoint?: string;
  concurrency: number;
  rpsLimit: number;
  rpmLimit: number;
  onProgress: (update: BulkIncrementalUpdate) => void | Promise<void>;
  onSending?: (promptIndex: number, total: number) => void;
  shouldStop: () => boolean;
}): Promise<BulkRunProgress> {
  const runId = uuidv4();
  const sessionId = uuidv4();
  const aimApiUrl = getAimApiUrl(options.aimApiEndpoint);
  const limiter = new SlidingWindowLimiter(options.rpsLimit, options.rpmLimit);
  const runningState = makeRunningState();

  let status: BulkRunProgress["status"] = "running";

  const processOnePrompt = async (input: BulkPromptInput): Promise<BulkResultDetail | null> => {
    if (options.shouldStop()) return null;

    await limiter.waitForSlot();
    if (options.shouldStop()) return null;

    const callResult = await callAimAnalyze({
      prompt: input.prompt,
      apiKey: options.apiKey,
      userEmail: options.userEmail,
      sessionId,
      aimApiUrl,
    });

    let detail: BulkResultDetail;

    if (!callResult.ok) {
      detail = {
        id: uuidv4(),
        promptId: input.id,
        prompt: input.prompt,
        promptSnippet: promptSnippet(input.prompt),
        status: "error",
        errorMessage: callResult.error,
        flagged: false,
        actionType: "none",
        triggeredPolicyNames: [],
        detections: [],
        detectionsCount: 0,
        rttMs: callResult.rttMs,
        expectedFlagged: input.expectedFlagged,
        expectedPolicy: input.expectedPolicy,
        expectedAction: input.expectedAction,
        groundTruthClassification: "UNK",
      };
    } else {
      const normalized = normalizeAimResponse(callResult.response);
      const gt = classifyGroundTruth(input.expectedFlagged, normalized.flagged);

      detail = {
        id: uuidv4(),
        promptId: input.id,
        prompt: input.prompt,
        promptSnippet: promptSnippet(input.prompt),
        status: "ok",
        flagged: normalized.flagged,
        actionType: normalized.actionType,
        triggeredPolicyNames: normalized.triggeredPolicyNames,
        detections: normalized.detections,
        maxCertainty: normalized.maxCertainty,
        detectionsCount: normalized.detections.length,
        analysisTimeMs: normalized.analysisTimeMs,
        rttMs: callResult.rttMs,
        redactedPreview: normalized.redactedPreview,
        expectedFlagged: input.expectedFlagged,
        expectedPolicy: input.expectedPolicy,
        expectedAction: input.expectedAction,
        groundTruthClassification: gt,
      };
    }

    applyResultToRunningState(runningState, detail);

    const { rawResponse: _raw, ...leanDetail } = detail as any;
    options.onProgress({
      type: "incremental",
      runId,
      status: "running",
      kpis: buildKpisFromState(runningState, options.prompts.length),
      latestResult: leanDetail,
    });

    return detail;
  };

  const results: BulkResultDetail[] = [];

  try {
    let index = 0;
    const total = options.prompts.length;
    console.log(`[BulkAnalyze] Run ${runId}: ${total} prompts, concurrency=${options.concurrency}, url=${aimApiUrl}`);

    const worker = async (): Promise<void> => {
      while (index < total) {
        if (options.shouldStop()) return;
        const currentIndex = index++;
        if (options.onSending) {
          options.onSending(currentIndex + 1, total);
        }
        const result = await processOnePrompt(options.prompts[currentIndex]);
        if (result) results.push(result);
      }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < options.concurrency; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    status = options.shouldStop() ? "stopped" : "completed";
  } catch (error) {
    status = "failed";
    return {
      runId,
      status,
      kpis: buildKpisFromState(runningState, options.prompts.length),
      results,
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    runId,
    status,
    kpis: buildKpisFromState(runningState, options.prompts.length),
    results,
  };
}

export interface LoadTestKpis {
  total: number;
  completed: number;
  successCount: number;
  errorCount: number;
  rateLimitedCount: number;
  serverErrorCount: number;
  timeoutCount: number;
  otherErrorCount: number;
  flaggedCount: number;
  actionBreakdown: Record<AimActionType, number>;
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

export interface LoadTestProgress {
  status: "running" | "completed" | "stopped" | "failed";
  kpis: LoadTestKpis;
  error?: string;
}

export async function processLoadTest(options: {
  prompts: string[];
  targetCount: number;
  targetRps: number;
  concurrency: number;
  apiKey: string;
  userEmail?: string;
  aimApiEndpoint?: string;
  onProgress: (kpis: LoadTestKpis) => void;
  shouldStop: () => boolean;
}): Promise<LoadTestProgress> {
  const sessionId = uuidv4();
  const aimApiUrl = getAimApiUrl(options.aimApiEndpoint);

  const startedAt = Date.now();
  let completed = 0;
  let successCount = 0;
  let errorCount = 0;
  let rateLimitedCount = 0;
  let serverErrorCount = 0;
  let timeoutCount = 0;
  let otherErrorCount = 0;
  let flaggedCount = 0;
  const actionBreakdown: Record<AimActionType, number> = {
    block_action: 0, monitor_action: 0, anonymize_action: 0, none: 0,
  };
  const firewallLatencies: number[] = [];
  const totalRttLatencies: number[] = [];
  const secondBuckets = new Map<number, number>();
  const successSecondBuckets = new Map<number, number>();
  let peakRps = 0;
  let peakAcceptedRps = 0;
  let lastProgressUpdate = 0;

  const buildKpis = (): LoadTestKpis => {
    const now = Date.now();
    const elapsed = now - startedAt;
    const elapsedSec = elapsed / 1000;
    const maxSec = Math.floor(elapsed / 1000);
    const timeline: Array<{ second: number; count: number }> = [];
    const acceptedTimeline: Array<{ second: number; count: number }> = [];
    for (let s = 0; s <= maxSec; s++) {
      timeline.push({ second: s, count: secondBuckets.get(s) || 0 });
      acceptedTimeline.push({ second: s, count: successSecondBuckets.get(s) || 0 });
    }

    return {
      total: options.targetCount,
      completed,
      successCount,
      errorCount,
      rateLimitedCount,
      serverErrorCount,
      timeoutCount,
      otherErrorCount,
      flaggedCount,
      actionBreakdown: { ...actionBreakdown },
      firewallLatencyP50: percentile(firewallLatencies, 50),
      firewallLatencyP95: percentile(firewallLatencies, 95),
      firewallLatencyP99: percentile(firewallLatencies, 99),
      totalRttP50: percentile(totalRttLatencies, 50),
      totalRttP95: percentile(totalRttLatencies, 95),
      totalRttP99: percentile(totalRttLatencies, 99),
      achievedRps: (() => {
        const currentSec = Math.floor(elapsed / 1000);
        const windowStart = Math.max(0, currentSec - 4);
        let windowTotal = 0;
        for (let s = windowStart; s <= currentSec; s++) {
          windowTotal += secondBuckets.get(s) || 0;
        }
        const windowDuration = Math.min(currentSec - windowStart + 1, 5);
        return windowDuration > 0 ? Math.round((windowTotal / windowDuration) * 10) / 10 : 0;
      })(),
      achievedAcceptedRps: (() => {
        const currentSec = Math.floor(elapsed / 1000);
        const windowStart = Math.max(0, currentSec - 4);
        let windowTotal = 0;
        for (let s = windowStart; s <= currentSec; s++) {
          windowTotal += successSecondBuckets.get(s) || 0;
        }
        const windowDuration = Math.min(currentSec - windowStart + 1, 5);
        return windowDuration > 0 ? Math.round((windowTotal / windowDuration) * 10) / 10 : 0;
      })(),
      avgRps: elapsedSec > 0 ? Math.round((completed / elapsedSec) * 10) / 10 : 0,
      peakRps,
      peakAcceptedRps,
      startedAt,
      elapsedMs: elapsed,
      throughputTimeline: timeline,
      acceptedTimeline,
    };
  };

  let index = 0;
  let status: LoadTestProgress["status"] = "running";

  const processOne = async (promptText: string): Promise<void> => {
    if (options.shouldStop()) return;

    try {
      const result = await callAimAnalyze({
        prompt: promptText,
        apiKey: options.apiKey,
        userEmail: options.userEmail,
        sessionId,
        aimApiUrl,
        silent: true,
      });

      completed++;
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      const bucketCount = (secondBuckets.get(sec) || 0) + 1;
      secondBuckets.set(sec, bucketCount);
      if (bucketCount > peakRps) peakRps = bucketCount;

      if (!result.ok) {
        errorCount++;
        if (result.status === 429) {
          rateLimitedCount++;
        } else if (result.status >= 500 && result.status < 600) {
          serverErrorCount++;
        } else if (result.status === 0) {
          timeoutCount++;
        } else {
          otherErrorCount++;
        }
      } else {
        successCount++;
        const successBucketCount = (successSecondBuckets.get(sec) || 0) + 1;
        successSecondBuckets.set(sec, successBucketCount);
        if (successBucketCount > peakAcceptedRps) peakAcceptedRps = successBucketCount;
        const normalized = normalizeAimResponse(result.response);
        if (normalized.flagged) flaggedCount++;
        actionBreakdown[normalized.actionType] = (actionBreakdown[normalized.actionType] || 0) + 1;
        if (normalized.analysisTimeMs !== undefined) firewallLatencies.push(normalized.analysisTimeMs);
      }
      if (result.rttMs !== undefined) totalRttLatencies.push(result.rttMs);
    } catch {
      completed++;
      errorCount++;
      timeoutCount++;
    }

    const now = Date.now();
    if (now - lastProgressUpdate > 500 || completed === options.targetCount) {
      lastProgressUpdate = now;
      options.onProgress(buildKpis());
    }
  };

  try {
    console.log(`[LoadTest] Starting: ${options.targetCount} requests, concurrency=${options.concurrency}, targetRps=${options.targetRps}, url=${aimApiUrl}`);

    const worker = async (): Promise<void> => {
      while (true) {
        if (options.shouldStop()) return;
        const currentIndex = index++;
        if (currentIndex >= options.targetCount) return;
        const prompt = options.prompts[currentIndex % options.prompts.length];
        await processOne(prompt);
      }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < options.concurrency; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    status = options.shouldStop() ? "stopped" : "completed";
  } catch (error) {
    status = "failed";
    return { status, kpis: buildKpis(), error: error instanceof Error ? error.message : String(error) };
  }

  const finalKpis = buildKpis();
  options.onProgress(finalKpis);
  console.log(`[LoadTest] Finished: ${finalKpis.completed}/${options.targetCount}, peak=${finalKpis.peakRps} rps, avg=${finalKpis.achievedRps} rps, status=${status}`);

  return { status, kpis: finalKpis };
}
