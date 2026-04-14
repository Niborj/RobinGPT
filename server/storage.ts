import { type Message, type InsertMessage } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Message operations - all scoped by session
  getMessages(sessionId: string): Promise<Message[]>;
  addMessage(sessionId: string, message: InsertMessage): Promise<Message>;
  clearMessages(sessionId: string): Promise<void>;
}

export class MemStorage implements IStorage {
  // Messages stored per session: Map<sessionId, Map<messageId, Message>>
  private sessionMessages: Map<string, Map<string, Message>>;

  constructor() {
    this.sessionMessages = new Map();
  }

  private getSessionMap(sessionId: string): Map<string, Message> {
    if (!this.sessionMessages.has(sessionId)) {
      this.sessionMessages.set(sessionId, new Map());
    }
    return this.sessionMessages.get(sessionId)!;
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    const sessionMap = this.getSessionMap(sessionId);
    return Array.from(sessionMap.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  async addMessage(sessionId: string, insertMessage: InsertMessage): Promise<Message> {
    const id = randomUUID();
    const message: Message = {
      ...insertMessage,
      id,
      createdAt: new Date(),
      redactedContent: insertMessage.redactedContent ?? null,
      aimResponse: insertMessage.aimResponse ?? null,
    };
    const sessionMap = this.getSessionMap(sessionId);
    sessionMap.set(id, message);
    return message;
  }

  async clearMessages(sessionId: string): Promise<void> {
    const sessionMap = this.getSessionMap(sessionId);
    sessionMap.clear();
  }
}

export const storage = new MemStorage();
