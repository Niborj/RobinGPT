import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { chatRequestSchema } from "@shared/schema";
import { streamChatResponse, streamChatResponseWithTools, streamChatResponseWithToolsUnprotected, streamToolTypeDemoWithFirewall, streamToolTypeDemoUnprotected, executeChatReplay, getOpenAIClient, getLLMModel, type LLMConfig } from "./openai";
import { z } from "zod";
import { processBulkAnalysis, processLoadTest } from "./bulkAnalyze";


// ── In-memory job store for bulk-analyze and load-test background jobs ──
interface JobState {
  status: "running" | "completed" | "stopped" | "failed";
  results: any[];
  kpis: any;
  error?: string;
  stopRequested: boolean;
  createdAt: number;
  type?: "bulk" | "loadtest";
}

const jobs = new Map<string, JobState>();

// Clean up jobs older than 120 minutes every 15 minutes
setInterval(() => {
  const cutoff = Date.now() - 120 * 60 * 1000;
  for (const [id, job] of Array.from(jobs)) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}, 15 * 60 * 1000).unref();

function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Get all messages for a session
  app.get("/api/messages", async (req, res) => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID is required" });
      }
      const messages = await storage.getMessages(sessionId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // Send a chat message and get AI response with streaming
  app.post("/api/chat", async (req, res) => {
    try {
      const validation = chatRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.message });
      }

      const { message, useFirewall, demoMode, useToolCalls, toolTypeScenario, aimApiKey, aimUserEmail, aimApiEndpoint, llmProvider, llmBaseUrl, llmModel, openaiApiKey, sessionId } = validation.data;

      const llmConfig: LLMConfig | undefined = llmProvider === "local" && llmBaseUrl
        ? { provider: "local", baseUrl: llmBaseUrl, model: llmModel }
        : openaiApiKey
        ? { provider: "openai", apiKey: openaiApiKey }
        : undefined;

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Get conversation history for context (last 10 messages) - scoped to session
      // Note: We don't include the current message yet since we haven't analyzed it
      // Use redacted content if available to ensure PII doesn't leak in multi-turn conversations
      const allMessages = await storage.getMessages(sessionId);
      const recentMessages = allMessages.slice(-10).map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.role === "user" && msg.redactedContent ? msg.redactedContent : msg.content,
      }));

      // Use tool-enabled chat if requested, otherwise use standard chat
      let aiResponse;
      if (toolTypeScenario) {
        // Tool Type Demo with scenario-specific 5-stage inspection
        if (useFirewall) {
          aiResponse = await streamToolTypeDemoWithFirewall(
            message,
            toolTypeScenario,
            recentMessages, 
            res,
            aimApiKey,
            aimUserEmail,
            aimApiEndpoint,
            llmConfig
          );
        } else {
          aiResponse = await streamToolTypeDemoUnprotected(
            message,
            toolTypeScenario,
            recentMessages, 
            res,
            llmConfig
          );
        }
      } else if (useToolCalls) {
        if (useFirewall) {
          aiResponse = await streamChatResponseWithTools(
            message, 
            recentMessages, 
            res,
            aimApiKey,
            aimUserEmail,
            aimApiEndpoint,
            llmConfig
          );
        } else {
          aiResponse = await streamChatResponseWithToolsUnprotected(
            message, 
            recentMessages, 
            res,
            llmConfig
          );
        }
      } else {
        aiResponse = await streamChatResponse(
          message, 
          recentMessages, 
          res, 
          useFirewall,
          aimApiKey,
          aimUserEmail,
          aimApiEndpoint,
          llmConfig
        );
      }

      // Only store messages if:
      // 1. The message wasn't blocked
      // 2. Not in demo mode with firewall disabled (unprotected stream is just for UI comparison)
      const shouldStore = !aiResponse.wasBlocked && !(demoMode && !useFirewall);
      
      if (shouldStore) {
        // Store user message with redacted content if applicable - scoped to session
        const wasRedacted = "redactedUserMessage" in aiResponse && aiResponse.redactedUserMessage;
        await storage.addMessage(sessionId, {
          role: "user",
          content: message, // Keep original message
          redactedContent: wasRedacted ? aiResponse.redactedUserMessage : undefined,
        });

        // Save AI response with AIM data if available - scoped to session
        await storage.addMessage(sessionId, {
          role: "assistant",
          content: aiResponse.content,
          aimResponse: aiResponse.aimResponse ? JSON.stringify(aiResponse.aimResponse) : undefined,
        });
      }
    } catch (error) {
      console.error("Error in chat endpoint:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error instanceof Error ? error.message : "Failed to process chat message" });
      }
    }
  });

  // Clear all messages for a session
  app.delete("/api/messages", async (req, res) => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID is required" });
      }
      await storage.clearMessages(sessionId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error clearing messages:", error);
      res.status(500).json({ error: "Failed to clear messages" });
    }
  });

  // POST /api/bulk-analyze — start background job, return jobId immediately
  app.post("/api/bulk-analyze", async (req, res) => {
    try {
      const { prompts, aimApiKey, aimUserEmail, aimApiEndpoint, concurrency = 3, rpsLimit = 2, rpmLimit = 100 } = req.body;

      if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
        return res.status(400).json({ error: "Prompts array is required" });
      }
      if (!aimApiKey) {
        return res.status(400).json({ error: "API key is required" });
      }

      const jobId = generateJobId();
      const job: JobState = {
        status: "running",
        results: [],
        kpis: null,
        stopRequested: false,
        createdAt: Date.now(),
      };
      jobs.set(jobId, job);

      console.log(`[BulkAnalyze] Starting job ${jobId}: ${prompts.length} prompts, endpoint=${aimApiEndpoint || 'aim'}, concurrency=${concurrency}, rps=${rpsLimit}`);

      // Fire-and-forget: run in background without awaiting
      processBulkAnalysis({
        prompts,
        apiKey: aimApiKey,
        userEmail: aimUserEmail,
        aimApiEndpoint,
        concurrency: Math.min(Math.max(1, concurrency), 10),
        rpsLimit: Math.min(Math.max(1, rpsLimit), 20),
        rpmLimit: Math.min(Math.max(1, rpmLimit), 1200),
        onProgress: (update) => {
          job.kpis = update.kpis;
          if (update.latestResult) {
            const { rawResponse: _raw, ...lean } = update.latestResult as any;
            job.results.push(lean);
          }
        },
        onSending: () => {},
        shouldStop: () => job.stopRequested,
      }).then((result) => {
        job.status = result.status as "completed" | "stopped" | "failed";
        if (result.kpis) job.kpis = result.kpis;
        console.log(`[BulkAnalyze] Job ${jobId} finished with status=${result.status}`);
      }).catch((err) => {
        job.status = "failed";
        job.error = err instanceof Error ? err.message : String(err);
        console.error(`[BulkAnalyze] Job ${jobId} failed:`, err);
      });

      res.status(202).json({ jobId });
    } catch (error) {
      console.error("Bulk analyze start error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to start bulk analysis" });
    }
  });

  // GET /api/bulk-analyze/progress — poll for incremental results
  app.get("/api/bulk-analyze/progress", (req, res) => {
    const jobId = req.query.jobId as string;
    const offset = parseInt((req.query.offset as string) || "0", 10);

    if (!jobId) {
      return res.status(400).json({ error: "jobId is required" });
    }

    const job = jobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({
      status: job.status,
      kpis: job.kpis,
      results: job.results.slice(offset),
      totalResults: job.results.length,
      error: job.error,
    });
  });

  // POST /api/bulk-analyze/stop — signal job to stop
  app.post("/api/bulk-analyze/stop", (req, res) => {
    const { jobId } = req.body;
    if (!jobId) {
      return res.status(400).json({ error: "jobId is required" });
    }
    const job = jobs.get(jobId);
    if (job) {
      job.stopRequested = true;
    }
    res.json({ ok: true });
  });

  // ── Load Test endpoints ──

  // POST /api/load-test — start a load test job
  app.post("/api/load-test", async (req, res) => {
    try {
      const { prompts, targetCount, targetRps, concurrency, aimApiKey, aimUserEmail, aimApiEndpoint } = req.body;

      if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
        return res.status(400).json({ error: "At least one prompt is required" });
      }
      if (!aimApiKey) {
        return res.status(400).json({ error: "API key is required" });
      }
      if (!targetCount || targetCount < 1) {
        return res.status(400).json({ error: "targetCount must be at least 1" });
      }

      const jobId = generateJobId();
      const job: JobState = {
        status: "running",
        results: [],
        kpis: null,
        stopRequested: false,
        createdAt: Date.now(),
        type: "loadtest",
      };
      jobs.set(jobId, job);

      const effectiveCount = Math.min(Math.max(1, targetCount), 100000);
      const effectiveRps = Math.min(Math.max(1, targetRps || 50), 2000);
      const effectiveConcurrency = Math.min(Math.max(1, concurrency || 50), 2000);

      const normalizedPrompts: string[] = Array.isArray(prompts)
        ? prompts.map((p: unknown) => typeof p === "string" ? p : String(p)).filter((s: string) => s.length > 0)
        : [];
      if (normalizedPrompts.length === 0) {
        return res.status(400).json({ error: "At least one prompt is required" });
      }

      console.log(`[LoadTest] Starting job ${jobId}: ${effectiveCount} requests, ${effectiveRps} target rps, concurrency=${effectiveConcurrency}, endpoint=${aimApiEndpoint || 'aim'}`);

      processLoadTest({
        prompts: normalizedPrompts,
        targetCount: effectiveCount,
        targetRps: effectiveRps,
        concurrency: effectiveConcurrency,
        apiKey: aimApiKey,
        userEmail: aimUserEmail,
        aimApiEndpoint,
        onProgress: (kpis) => {
          job.kpis = kpis;
        },
        shouldStop: () => job.stopRequested,
      }).then((result) => {
        job.status = result.status;
        if (result.kpis) job.kpis = result.kpis;
        if (result.error) job.error = result.error;
        console.log(`[LoadTest] Job ${jobId} finished with status=${result.status}`);
      }).catch((err) => {
        job.status = "failed";
        job.error = err instanceof Error ? err.message : String(err);
        console.error(`[LoadTest] Job ${jobId} failed:`, err);
      });

      res.status(202).json({ jobId });
    } catch (error) {
      console.error("Load test start error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to start load test" });
    }
  });

  // GET /api/load-test/progress — poll for load test progress
  app.get("/api/load-test/progress", (req, res) => {
    const jobId = req.query.jobId as string;

    if (!jobId) {
      return res.status(400).json({ error: "jobId is required" });
    }

    const job = jobs.get(jobId);
    if (!job || job.type !== "loadtest") {
      return res.status(404).json({ error: "Load test job not found" });
    }

    res.json({
      status: job.status,
      kpis: job.kpis,
      error: job.error,
    });
  });

  // POST /api/load-test/stop — signal load test to stop
  app.post("/api/load-test/stop", (req, res) => {
    const { jobId } = req.body;
    if (!jobId) {
      return res.status(400).json({ error: "jobId is required" });
    }
    const job = jobs.get(jobId);
    if (!job || job.type !== "loadtest") {
      return res.status(404).json({ error: "Load test job not found" });
    }
    job.stopRequested = true;
    res.json({ ok: true });
  });

  // POST /api/replay — re-run a prompt through the AI Firewall + OpenAI pipeline and return JSON stages.
  // Uses the shared `inspectWithFirewall` helper from openai.ts — the same AI Firewall inspection
  // logic that powers the /api/chat streaming pipeline — ensuring behavioral parity with production.
  // A separate endpoint (rather than reusing /api/chat directly) is necessary because /api/chat
  // uses SSE streaming and cannot return structured JSON needed for stage-by-stage comparison.
  // Fail-closed: if the AI Firewall check fails during a firewall-enabled replay, the request is
  // blocked (not passed through), matching the fail-closed semantics of the main /api/chat pipeline.
  app.post("/api/replay", async (req, res) => {
    const { message, aimApiKey, aimUserEmail, aimApiEndpoint, useFirewall, llmProvider, llmBaseUrl, llmModel, openaiApiKey } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    if (useFirewall && (!aimApiKey || !aimUserEmail)) {
      return res.status(400).json({ error: "AI Firewall credentials are required when firewall is enabled. Please configure your API key and email." });
    }

    const replayLlmConfig: LLMConfig | undefined = llmProvider === "local" && llmBaseUrl
      ? { provider: "local", baseUrl: llmBaseUrl, model: llmModel }
      : openaiApiKey
      ? { provider: "openai", apiKey: openaiApiKey }
      : undefined;

    try {
      const result = await executeChatReplay(message, !!useFirewall, aimApiKey, aimUserEmail, aimApiEndpoint, replayLlmConfig);
      return res.json(result);
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : "Replay failed";
      console.error("[Replay] error:", err);
      return res.status(500).json({ error: errMessage });
    }
  });

  // Diagnostics: AI Firewall connectivity check
  app.post("/api/diagnostics/firewall", async (req, res) => {
    const { aimApiKey, aimUserEmail, aimApiEndpoint } = req.body || {};
    if (!aimApiKey || !aimUserEmail) {
      return res.status(400).json({ ok: false, error: "Missing credentials" });
    }
    let baseUrl = "https://api.aim.security/fw/v1/analyze";
    if (aimApiEndpoint === "cato") baseUrl = "https://api.aisec.catonetworks.com/fw/v1/analyze";
    else if (aimApiEndpoint === "cato-us1") baseUrl = "https://api.aisec.us1.catonetworks.com/fw/v1/analyze";
    else if (aimApiEndpoint === "cato-in1") baseUrl = "https://api.aisec.in1.catonetworks.com/fw/v1/analyze";
    else if (aimApiEndpoint === "cato-jp1") baseUrl = "https://api.aisec.jp1.catonetworks.com/fw/v1/analyze";
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-aim-user-email": aimUserEmail,
          "x-aim-api-key": aimApiKey,
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "connectivity test" }] }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;
      if (response.status >= 200 && response.status < 500) {
        return res.json({ ok: true, latencyMs, endpoint: baseUrl, statusCode: response.status });
      }
      const text = await response.text().catch(() => "");
      return res.json({ ok: false, latencyMs, endpoint: baseUrl, statusCode: response.status, error: text.slice(0, 200) });
    } catch (err: any) {
      return res.json({ ok: false, latencyMs: Date.now() - start, endpoint: baseUrl, error: err.name === "AbortError" ? "Request timed out after 10s" : (err.message || "Connection failed") });
    }
  });

  // Diagnostics: OpenAI connectivity check
  app.post("/api/diagnostics/openai", async (req, res) => {
    const { openaiApiKey } = req.body || {};
    const apiKey = openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.json({ ok: false, error: "No OpenAI API key configured. Enter one in the LLM settings." });
    }
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;
      if (response.ok) {
        return res.json({ ok: true, latencyMs });
      }
      return res.json({ ok: false, latencyMs, statusCode: response.status, error: response.statusText });
    } catch (err: any) {
      return res.json({ ok: false, latencyMs: Date.now() - start, error: err.name === "AbortError" ? "Request timed out after 10s" : (err.message || "Connection failed") });
    }
  });

  // POST /api/traceroute — sequential HTTP HEAD probes to the firewall endpoint
  app.post("/api/traceroute", async (req, res) => {
    const { aimApiEndpoint } = req.body || {};
    let baseUrl = "https://api.aim.security";
    if (aimApiEndpoint === "cato") baseUrl = "https://api.aisec.catonetworks.com";
    else if (aimApiEndpoint === "cato-us1") baseUrl = "https://api.aisec.us1.catonetworks.com";
    else if (aimApiEndpoint === "cato-in1") baseUrl = "https://api.aisec.in1.catonetworks.com";
    else if (aimApiEndpoint === "cato-jp1") baseUrl = "https://api.aisec.jp1.catonetworks.com";

    const hops = [
      { url: baseUrl },
      { url: `${baseUrl}/fw` },
      { url: `${baseUrl}/fw/v1` },
      { url: `${baseUrl}/fw/v1/analyze` },
    ];

    const results: Array<{ url: string; latencyMs: number | null; error?: string }> = [];

    for (const hop of hops) {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 5000);
        const r = await fetch(hop.url, { method: "HEAD", signal: controller.signal });
        clearTimeout(tid);
        results.push({ url: hop.url, latencyMs: Date.now() - start });
        void r;
      } catch (err: any) {
        results.push({
          url: hop.url,
          latencyMs: Date.now() - start,
          error: err.name === "AbortError" ? "timeout" : "unreachable",
        });
      }
    }

    return res.json({ hops: results });
  });

  // POST /api/live-test — run a message through both direct OpenAI and through the AI Firewall concurrently
  app.post("/api/live-test", async (req, res) => {
    const { message, aimApiKey, aimUserEmail, aimApiEndpoint, llmProvider, llmBaseUrl, llmModel, openaiApiKey } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    const testLlmConfig: LLMConfig | undefined = llmProvider === "local" && llmBaseUrl
      ? { provider: "local", baseUrl: llmBaseUrl, model: llmModel }
      : openaiApiKey
      ? { provider: "openai", apiKey: openaiApiKey }
      : undefined;

    const llmClient = getOpenAIClient(testLlmConfig);
    const llmModelName = getLLMModel(testLlmConfig);

    const SYSTEM_PROMPT = "You are a helpful, friendly, and knowledgeable AI assistant. Provide clear, accurate, and helpful responses to user questions.";
    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: message },
    ];

    const directPromise = (async () => {
      const start = Date.now();
      try {
        const completion = await llmClient.chat.completions.create({
          model: llmModelName,
          messages,
          max_completion_tokens: 2048,
        });
        return {
          response: completion.choices[0]?.message?.content || "",
          latencyMs: Date.now() - start,
          outcome: "allowed" as const,
          error: null,
        };
      } catch (err: unknown) {
        return {
          response: null,
          latencyMs: Date.now() - start,
          outcome: "error" as const,
          error: err instanceof Error ? err.message : "Direct call failed",
        };
      }
    })();

    const firewallPromise = (async () => {
      const start = Date.now();
      if (!aimApiKey || !aimUserEmail) {
        return {
          response: null,
          latencyMs: 0,
          outcome: "error" as const,
          actionTaken: "No credentials",
          stages: [],
          sessionId: null,
          error: "AI Firewall credentials not configured",
        };
      }
      try {
        const result = await executeChatReplay(message, true, aimApiKey, aimUserEmail, aimApiEndpoint, testLlmConfig);
        return {
          response: result.aiResponse,
          latencyMs: Date.now() - start,
          outcome: result.outcome,
          actionTaken: result.stages.find(s => s.status !== "allowed")?.actionTaken || "Allowed",
          stages: result.stages,
          sessionId: result.sessionId,
          error: null,
        };
      } catch (err: unknown) {
        return {
          response: null,
          latencyMs: Date.now() - start,
          outcome: "error" as const,
          actionTaken: "Error",
          stages: [],
          sessionId: null,
          error: err instanceof Error ? err.message : "Firewall call failed",
        };
      }
    })();

    const [directResult, firewallResult] = await Promise.all([directPromise, firewallPromise]);

    return res.json({
      direct: directResult,
      firewall: firewallResult,
    });
  });

  const httpServer = createServer(app);

  return httpServer;
}
