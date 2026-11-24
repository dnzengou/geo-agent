// providers — thin fetch wrappers around each assistant's public API.
// Zero deps. The user's own API keys come from env. No scraping.
//
// Three provider shapes cover every mainstream and most niche LLMs:
//   * "openai-compatible" — OpenAI, DeepSeek, Mistral, Groq, Together,
//     Fireworks, Perplexity, OpenRouter, Ollama, LM Studio, vLLM, …
//   * "anthropic"         — Claude (its own message shape)
//   * "gemini"            — Google (its own content shape)
//
// Add a new OpenAI-compatible provider by appending one entry to
// PROVIDERS. Add a different family by writing one callX function.
//
// All responses are truncated to 8 KB so weekly diff reports stay small.

const MAX_RESPONSE_BYTES = 8 * 1024;

/**
 * Canonical provider catalog. Each entry declares:
 *   id        — short slug, used in config + reports
 *   label     — display name
 *   kind      — "openai-compatible" | "anthropic" | "gemini"
 *   baseUrl   — API root (openai-compatible only; the rest are fixed)
 *   envKey    — environment variable holding the API key
 *   defaultModel — fallback when config.models[id] isn't set
 *   extraHeaders — optional, merged into every request (openai-compatible)
 *   purpose   — "probe" | "draft" | "both" (purely informational)
 */
export const PROVIDERS = {
  openai: {
    id: "openai", label: "ChatGPT", kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY", defaultModel: "gpt-4o-mini", purpose: "both",
  },
  anthropic: {
    id: "anthropic", label: "Claude", kind: "anthropic",
    envKey: "ANTHROPIC_API_KEY", defaultModel: "claude-opus-4-7", purpose: "both",
  },
  perplexity: {
    id: "perplexity", label: "Perplexity", kind: "openai-compatible",
    baseUrl: "https://api.perplexity.ai",
    envKey: "PERPLEXITY_API_KEY", defaultModel: "sonar", purpose: "probe",
  },
  gemini: {
    id: "gemini", label: "Gemini", kind: "gemini",
    envKey: "GEMINI_API_KEY", defaultModel: "gemini-1.5-flash", purpose: "both",
  },
  // Cost-efficient drafter workhorses — probes too, if you want
  deepseek: {
    id: "deepseek", label: "DeepSeek", kind: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    envKey: "DEEPSEEK_API_KEY", defaultModel: "deepseek-chat", purpose: "both",
  },
  mistral: {
    id: "mistral", label: "Mistral", kind: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY", defaultModel: "mistral-small-latest", purpose: "both",
  },
  groq: {
    id: "groq", label: "Groq", kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY", defaultModel: "llama-3.1-8b-instant", purpose: "draft",
  },
  together: {
    id: "together", label: "Together", kind: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    envKey: "TOGETHER_API_KEY", defaultModel: "meta-llama/Llama-3.1-8B-Instruct-Turbo", purpose: "draft",
  },
  fireworks: {
    id: "fireworks", label: "Fireworks", kind: "openai-compatible",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    envKey: "FIREWORKS_API_KEY", defaultModel: "accounts/fireworks/models/llama-v3p1-8b-instruct", purpose: "draft",
  },
  openrouter: {
    id: "openrouter", label: "OpenRouter", kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY", defaultModel: "openrouter/auto", purpose: "both",
    extraHeaders: { "HTTP-Referer": "https://github.com/dnzengou/geo-agent", "X-Title": "geo-agent" },
  },
  // Local — zero-cost, if the user is running it. Opt-in via OLLAMA_HOST
  // so geo-agent never silently tries to reach localhost from a server
  // or CI runner that happens not to have Ollama.
  ollama: {
    id: "ollama", label: "Ollama (local)", kind: "openai-compatible",
    baseUrl: process.env.OLLAMA_HOST
      ? `${process.env.OLLAMA_HOST.replace(/\/$/, "")}/v1`
      : "http://127.0.0.1:11434/v1",
    envKey: "OLLAMA_HOST",      // presence of OLLAMA_HOST = enabled
    noAuth: true,               // Ollama's OpenAI-compat endpoint has no auth
    defaultModel: "llama3.1:8b", purpose: "draft",
  },
};

/** Set of provider ids whose shape is usable for FAQ drafting. */
export const DRAFT_CAPABLE = new Set(
  Object.values(PROVIDERS).filter(p => p.purpose !== "probe").map(p => p.id)
);

/** Pick a drafter: explicit config, first drafter with a key, or throw. */
export function resolveDrafter(config) {
  const picked = config.drafter;
  const order = picked ? [picked] : [
    // cheap-first: local → DeepSeek → Groq → Mistral → OpenAI → Anthropic → Gemini
    "ollama", "deepseek", "groq", "mistral", "openrouter", "together", "fireworks",
    "openai", "anthropic", "gemini",
  ];
  for (const id of order) {
    const def = PROVIDERS[id];
    if (!def) continue;
    const apiKey = process.env[def.envKey];
    if (!apiKey) continue;
    if (!DRAFT_CAPABLE.has(id)) continue;
    const model = config.models?.[id] || def.defaultModel;
    return { id, def, apiKey: apiKey ?? "", model };
  }
  throw new Error(
    "no drafter available. set one of DEEPSEEK_API_KEY, OPENAI_API_KEY, " +
    "ANTHROPIC_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY, " +
    "TOGETHER_API_KEY, FIREWORKS_API_KEY, OPENROUTER_API_KEY, or run " +
    "Ollama locally."
  );
}

/** Generic call: dispatches by kind. All callers go through this. */
export async function callProvider(provider, prompt, { apiKey, model, system }) {
  const def = typeof provider === "string" ? PROVIDERS[provider] : provider;
  if (!def) throw new Error(`unknown provider: ${provider}`);
  switch (def.kind) {
    case "openai-compatible": return callOpenAICompatible(def, prompt, { apiKey, model, system });
    case "anthropic":         return callAnthropic(prompt, { apiKey, model, system });
    case "gemini":            return callGemini(prompt, { apiKey, model, system });
    default: throw new Error(`unsupported provider kind: ${def.kind}`);
  }
}

async function callOpenAICompatible(def, prompt, { apiKey, model, system }) {
  const started = Date.now();
  const headers = {
    "content-type": "application/json",
    ...(def.noAuth ? {} : (apiKey ? { "authorization": `Bearer ${apiKey}` } : {})),
    ...(def.extraHeaders || {}),
  };
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const res = await fetch(`${def.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) throw new Error(`${def.id} ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    text: truncate(data.choices?.[0]?.message?.content ?? ""),
    model: data.model ?? model,
    latencyMs: Date.now() - started,
  };
}

async function callAnthropic(prompt, { apiKey, model, system }) {
  const started = Date.now();
  const body = { model, max_tokens: 1024, messages: [{ role: "user", content: prompt }] };
  if (system) body.system = system;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || "").join("");
  return { text: truncate(text), model: data.model ?? model, latencyMs: Date.now() - started };
}

async function callGemini(prompt, { apiKey, model, system }) {
  const started = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = { contents: [{ parts: [{ text: prompt }] }] };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
  return { text: truncate(text), model, latencyMs: Date.now() - started };
}

function truncate(s) {
  const buf = Buffer.from(s ?? "", "utf8");
  if (buf.byteLength <= MAX_RESPONSE_BYTES) return s;
  return buf.slice(0, MAX_RESPONSE_BYTES).toString("utf8") + "\n…[truncated]";
}

/** Word-boundary citation detection with regex-metachar-safe brand name. */
export function detectCitation(text, brand) {
  if (!text || !brand) return { cited: false, quote: null };
  const re = new RegExp(`(?:^|[^A-Za-z0-9_])(${escapeRegex(brand)})(?:[^A-Za-z0-9_]|$)`, "i");
  const m = text.match(re);
  if (!m) return { cited: false, quote: null };
  const idx = m.index + (m[0].length - m[1].length);
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + m[1].length + 120);
  return {
    cited: true,
    quote: (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : ""),
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
