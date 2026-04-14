import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  role: text("role").notNull(), // 'user' or 'assistant'
  content: text("content").notNull(),
  redactedContent: text("redacted_content"), // For user messages that were anonymized - shows what was actually sent to AI
  aimResponse: text("aim_response"), // JSON string of AIM API response
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// Chat request/response types for API
export const chatRequestSchema = z.object({
  message: z.string().min(1, "Message cannot be empty"),
  useFirewall: z.boolean().optional().default(true),
  demoMode: z.boolean().optional().default(false),
  useToolCalls: z.boolean().optional().default(false),
  toolTypeScenario: z.enum(["database", "file_access", "code_execution", "web_search"]).optional(),
  aimApiKey: z.string().optional(),
  aimUserEmail: z.string().optional(),
  aimApiEndpoint: z.string().optional(),
  llmProvider: z.enum(["openai", "local"]).optional().default("openai"),
  llmBaseUrl: z.string().optional(),
  llmModel: z.string().optional(),
  openaiApiKey: z.string().optional(),
  sessionId: z.string().min(1, "Session ID is required"),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
