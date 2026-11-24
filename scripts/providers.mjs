// providers — thin fetch wrappers around each assistant's public API.
// Zero deps. The user's own API keys come from env. No scraping.
// Each provider returns { text, model, latencyMs } or throws.
//
// Responses are TRUNCATED to 8 KB so a long reply doesn't bloat the
// weekly diff report. The citation detector only needs to see the
// brand name if it's there; it almost always lands in the first page.

const MAX_RESPONSE_BYTES = 8 * 1024;

export const PROVIDERS = {
  openai: {
    id: "openai",
    label: "ChatGPT",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    call: callOpenAI,
  },
  anthropic: {
    id: "anthropic",
    label: "Claude",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: "claude-opus-4-7",
    call: callAnthropic,
  },
  perplexity: {
    id: "perplexity",
    label: "Perplexity",
    envKey: "PERPLEXITY_API_KEY",
    defaultModel: "sonar",
    call: callPerplexity,
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    envKey: "GEMINI_API_KEY",
    defaultModel: "gemini-1.5-flash",
    call: callGemini,
  },
};

async function callOpenAI(prompt, { model, apiKey }) {
  const started = Date.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    text: truncate(data.choices?.[0]?.message?.content ?? ""),
    model: data.model ?? model,
    latencyMs: Date.now() - started,
  };
}

async function callAnthropic(prompt, { model, apiKey }) {
  const started = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || "").join("");
  return { text: truncate(text), model: data.model ?? model, latencyMs: Date.now() - started };
}

async function callPerplexity(prompt, { model, apiKey }) {
  const started = Date.now();
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`perplexity ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    text: truncate(data.choices?.[0]?.message?.content ?? ""),
    model: data.model ?? model,
    latencyMs: Date.now() - started,
  };
}

async function callGemini(prompt, { model, apiKey }) {
  const started = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || "")
    .join("");
  return { text: truncate(text), model, latencyMs: Date.now() - started };
}

function truncate(s) {
  const buf = Buffer.from(s ?? "", "utf8");
  if (buf.byteLength <= MAX_RESPONSE_BYTES) return s;
  return buf.slice(0, MAX_RESPONSE_BYTES).toString("utf8") + "\n…[truncated]";
}

// cited: substring match on the brand name, case-insensitive, word-boundary
// aware enough to avoid "Pulsecraft" matching inside "Pulsecraftsmen".
// Also captures a short quote around the hit for the report.
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
