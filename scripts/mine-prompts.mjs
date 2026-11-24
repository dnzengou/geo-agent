// mine-prompts — read a support-channel export (CSV or JSONL),
// ask a drafter LLM to surface the top user-phrased questions in
// prompt-voice, and write a FAQ proposal for human review.
//
// The drafter is LLM-agnostic. Set any ONE of:
//   DEEPSEEK_API_KEY   (recommended — cheap, strong)
//   OPENAI_API_KEY
//   ANTHROPIC_API_KEY
//   GEMINI_API_KEY
//   MISTRAL_API_KEY
//   GROQ_API_KEY
//   TOGETHER_API_KEY
//   FIREWORKS_API_KEY
//   OPENROUTER_API_KEY
// Or run Ollama locally (http://127.0.0.1:11434).
//
// Pick explicitly with config.drafter = "deepseek" (etc.), or
// let the resolver pick the first drafter with a key (cheapest first).
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveDrafter, callProvider } from "./providers.mjs";

const SYSTEM_PROMPT = `You are a GEO (Generative Engine Optimization) FAQ miner.
You read a stream of real user messages from a product's support channel
and produce DRAFT FAQ entries for a human founder to sign off on.

Three rules you never break:
1. Prompt-voice. Every question MUST be in the user's own words, not the
   marketing team's. "Does it work on iPhone?" is a question. "Mobile
   compatibility" is not.
2. Specific answers. Every answer MUST contain a concrete, verifiable
   detail (a number, a platform name, a URL shape, a minimum version).
3. No hallucination. If the support messages don't contain enough info
   to answer a question factually, DRAFT the question with answer:
   "<<needs founder input>>" and leave it for the human to fill in.

Output VALID JSON ONLY, exactly matching this shape:
{
  "proposedFaq": [
    { "q": "...", "a": "...", "confidence": 0.0-1.0, "supportingMessages": ["short quote", "..."] }
  ]
}
No markdown fences, no prose outside the JSON.`;

export async function mine(config) {
  const sourcePath = config.supportExport;
  if (!sourcePath) {
    throw new Error("config.supportExport is required (path to a CSV or JSONL of user messages)");
  }
  const raw = await readFile(sourcePath, "utf8");
  const messages = parseMessages(raw, sourcePath);
  if (!messages.length) {
    throw new Error(`no messages parsed from ${sourcePath}`);
  }

  const drafter = resolveDrafter(config);
  console.log(`geo-agent mine: ${messages.length} messages, drafter=${drafter.id}:${drafter.model}`);

  const sample = messages.slice(0, config.sampleSize || 200);
  const userPrompt =
    `Brand: ${config.name}\nURL: ${config.url || "(none)"}\n` +
    `Draw the top ${config.topN || 10} FAQ entries from these ${sample.length} user messages:\n\n` +
    sample.map((m, i) => `${i + 1}. ${truncate(m, 240)}`).join("\n");

  const started = Date.now();
  let draft;
  try {
    const out = await callProvider(drafter.def, userPrompt, {
      apiKey: drafter.apiKey,
      model: drafter.model,
      system: SYSTEM_PROMPT,
    });
    draft = parseJsonLoose(out.text);
    draft._drafterLatencyMs = out.latencyMs;
    draft._drafterModel = out.model;
  } catch (err) {
    throw new Error(`drafter ${drafter.id} failed: ${err.message}`);
  }

  const proposal = {
    kind: "faq-proposal",
    brand: config.name,
    source: sourcePath,
    scannedMessages: messages.length,
    sampledMessages: sample.length,
    drafter: { id: drafter.id, model: draft._drafterModel, latencyMs: draft._drafterLatencyMs },
    generatedAt: new Date().toISOString(),
    note: "Every entry is a DRAFT. A human founder must read, edit and approve before anything lands in agent-seo.config.json. Entries with answer '<<needs founder input>>' are deliberate hand-offs.",
    proposedFaq: Array.isArray(draft.proposedFaq) ? draft.proposedFaq : [],
  };

  const out = join("proposals", `faq-${isoDate()}.json`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(proposal, null, 2));
  const needsInput = proposal.proposedFaq.filter(
    f => /^<<\s*needs founder input/i.test(String(f.a || ""))
  ).length;
  console.log(`geo-agent mine: wrote ${out}`);
  console.log(`  ${proposal.proposedFaq.length} FAQ entries drafted in ${Date.now() - started} ms`);
  if (needsInput) console.log(`  ${needsInput} entries marked <<needs founder input>>`);
  console.log(`  next: open ${out}, review, merge into your agent-seo.config.json.faq[]`);
}

/** CSV or JSONL → string[]. Generous about shape: picks the first
 *  string-typed field in each JSONL row (msg, text, body, content, message). */
function parseMessages(raw, path) {
  const isJsonl = /\.jsonl$/i.test(path) || /^\s*\{/.test(raw);
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (isJsonl) {
    const out = [];
    for (const line of lines) {
      try {
        const o = JSON.parse(line);
        const v = o.msg ?? o.text ?? o.body ?? o.content ?? o.message ?? "";
        if (typeof v === "string" && v.trim()) out.push(v.trim());
      } catch { /* skip bad line */ }
    }
    return out;
  }
  // CSV: take the last column, strip quotes. Simple parser; fine for exports.
  return lines.slice(1).map(l => {
    const cols = l.split(",");
    const last = cols[cols.length - 1] || "";
    return last.replace(/^"(.*)"$/, "$1").replace(/""/g, '"').trim();
  }).filter(Boolean);
}

/** LLMs sometimes wrap JSON in ```json fences or add a trailing period.
 *  Try strict JSON.parse first; fall back to extracting the first {...} block. */
function parseJsonLoose(text) {
  if (!text) throw new Error("drafter returned empty response");
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("drafter response is not JSON:\n" + text.slice(0, 400));
  try { return JSON.parse(m[0]); }
  catch (err) { throw new Error("drafter JSON parse failed: " + err.message + "\n" + m[0].slice(0, 400)); }
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + "…" : s; }
function isoDate() { return new Date().toISOString().slice(0, 10); }
