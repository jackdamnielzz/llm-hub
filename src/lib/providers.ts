import type { ProviderConfig } from "./types";

// Model-id's kun je in Instellingen altijd aanpassen. Controleer ze bij je provider.
export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
    enabled: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o"],
    enabled: true,
  },
  {
    id: "google",
    name: "Google Gemini",
    kind: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.0-flash"],
    enabled: true,
  },
  {
    id: "mistral",
    name: "Mistral",
    kind: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-small-latest"],
    enabled: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      "openrouter/auto",
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o-mini",
      "google/gemini-2.0-flash-001",
      "meta-llama/llama-3.3-70b-instruct",
    ],
    enabled: true,
  },
  {
    id: "venice",
    name: "Venice",
    kind: "openai-compatible",
    baseUrl: "https://api.venice.ai/api/v1",
    models: [],
    enabled: true,
  },
  {
    id: "ollama",
    name: "Ollama (lokaal)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3.2"],
    enabled: false,
  },
];
