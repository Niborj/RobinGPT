/**
 * Credentials management utilities
 * Handles storing and retrieving Aim API credentials from localStorage
 */

export interface AimCredentials {
  apiKey: string;
  email: string;
  apiEndpoint?: string;
  llmProvider?: "openai" | "local";
  llmBaseUrl?: string;
  llmModel?: string;
  openaiApiKey?: string;
}

const CREDENTIALS_KEY = "robingpt_aim_credentials";

export function getStoredCredentials(): AimCredentials | null {
  try {
    const stored = localStorage.getItem(CREDENTIALS_KEY);
    if (!stored) return null;
    
    const parsed = JSON.parse(stored);
    if (parsed.apiKey && parsed.email) {
      return parsed;
    }
    return null;
  } catch (error) {
    console.error("Failed to parse stored credentials:", error);
    return null;
  }
}

export function storeCredentials(credentials: AimCredentials): void {
  try {
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
  } catch (error) {
    console.error("Failed to store credentials:", error);
    throw new Error("Failed to save credentials");
  }
}

export function clearCredentials(): void {
  try {
    localStorage.removeItem(CREDENTIALS_KEY);
  } catch (error) {
    console.error("Failed to clear credentials:", error);
  }
}
