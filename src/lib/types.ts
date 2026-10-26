export type ProviderKind = "anthropic" | "openai-compatible";

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Enabled models that show up in the model picker */
  models: string[];
  /** Full list fetched from the provider (may be large) */
  available?: string[];
  enabled: boolean;
  /** AES-GCM versleuteld met een sleutel die in IndexedDB van deze browser staat */
  apiKeyEnc?: string;
}

export interface Attachment {
  name: string;
  type: string;
  text?: string;
  dataUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  createdAt: number;
  /** Bronnen die het model gebruikte via webzoeken of het ophalen van pagina's */
  sources?: { title: string; url: string }[];
}

export interface Conversation {
  id: string;
  title: string;
  projectId?: string;
  providerId: string;
  model: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  instructions: string;
  files: Attachment[];
}

/** Webzoeken: Brave Search API-key (versleuteld opgeslagen zoals de LLM-keys) */
export interface ToolSettings {
  webSearchEnabled: boolean;
  braveKeyEnc?: string;
}
