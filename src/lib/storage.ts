import type { Agent, Conversation, Project, ProviderConfig, ToolSettings } from "./types";
import { DEFAULT_PROVIDERS } from "./providers";

const KEYS = {
  providers: "llmhub.providers",
  conversations: "llmhub.conversations",
  projects: "llmhub.projects",
  tools: "llmhub.tools",
  agents: "llmhub.agents",
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota vol: gebeurt bij veel of grote bestanden in localStorage.
    alert("Opslag is vol. Verwijder oude chats of bijlagen.");
  }
}

export const loadProviders = () => read<ProviderConfig[]>(KEYS.providers, DEFAULT_PROVIDERS);
export const saveProviders = (p: ProviderConfig[]) => write(KEYS.providers, p);
export const loadConversations = () => read<Conversation[]>(KEYS.conversations, []);
export const saveConversations = (c: Conversation[]) => write(KEYS.conversations, c);
export const loadProjects = () => read<Project[]>(KEYS.projects, []);
export const saveProjects = (p: Project[]) => write(KEYS.projects, p);
export const loadAgents = () => read<Agent[]>(KEYS.agents, []);
export const saveAgents = (a: Agent[]) => write(KEYS.agents, a);
export const loadTools = () => read<ToolSettings>(KEYS.tools, { webSearchEnabled: false });
export const saveTools = (t: ToolSettings) => write(KEYS.tools, t);
