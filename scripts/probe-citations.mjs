// probe-citations — ask the major assistants a fixed set of prompts
// and record citations. Uses the user's own API keys from env via
// native fetch. No spoofing, no SDKs, no third-party server.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PROVIDERS, callProvider, detectCitation } from "./providers.mjs";

export async function probe(config) {
  const prompts = config.probePrompts || [];
  if (!prompts.length) {
    throw new Error("config.probePrompts must be a non-empty array of strings");
  }
  const brand = config.name;
  if (!brand) throw new Error("config.name is required (the brand to detect)");

  const providers = resolveProviders(config);
  const enabled = providers.filter(p => p.enabled);
  const skipped = providers.filter(p => !p.enabled);

  if (!enabled.length) {
    console.warn("geo-agent probe: no provider keys in env — writing a skeleton report.");
    console.warn("  set any of: " + providers.map(p => p.envKey).join(", "));
  }

  const runs = [];
  for (const provider of providers) {
    for (const prompt of prompts) {
      if (!provider.enabled) {
        runs.push({
          provider: provider.id,
          prompt,
          askedAt: new Date().toISOString(),
          skipped: true,
          skipReason: provider.skipReason,
        });
        continue;
      }
      const askedAt = new Date().toISOString();
      try {
        const out = await callProvider(provider.def, prompt, { model: provider.model, apiKey: provider.apiKey });
        const detection = detectCitation(out.text, brand);
        runs.push({
          provider: provider.id,
          model: out.model,
          prompt,
          askedAt,
          latencyMs: out.latencyMs,
          response: out.text,
          cited: detection.cited,
          citationQuote: detection.quote,
        });
      } catch (err) {
        runs.push({
          provider: provider.id,
          prompt,
          askedAt,
          error: String(err?.message || err),
        });
      }
    }
  }

  const summary = summarize(runs);
  const report = {
    kind: "citation-report",
    brand,
    generatedAt: new Date().toISOString(),
    probePrompts: prompts,
    providers: providers.map(p => ({ id: p.id, model: p.model, enabled: p.enabled, skipReason: p.skipReason })),
    summary,
    runs,
    notes: "Compare this report against the previous week's. A citation count going up means the GEO signals are working. A citation quote identical to text in your llms-full.txt is the strongest confirmation.",
  };

  const out = join("reports", `citations-${isoDate()}.json`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(`geo-agent probe: wrote ${out}`);
  console.log(`  providers run: ${enabled.map(p => p.id).join(", ") || "(none)"}`);
  if (skipped.length) {
    console.log(`  providers skipped: ${skipped.map(p => `${p.id} (${p.skipReason})`).join(", ")}`);
  }
  if (enabled.length) {
    console.log(`  citations: ${summary.citedCount} / ${summary.totalAnswered} answered prompts`);
    for (const line of summary.perProvider) {
      console.log(`    ${line}`);
    }
  }
}

function resolveProviders(config) {
  const picked = config.providers;
  // Default probe set = the four mainstream assistants users ask questions of.
  // The other providers (deepseek, groq, mistral, together, fireworks, openrouter,
  // ollama) are configured to be drafters by default; add them to config.providers
  // if you want to probe them too.
  const ids = Array.isArray(picked) && picked.length
    ? picked
    : ["openai", "anthropic", "perplexity", "gemini"];
  return ids.map(id => {
    const def = PROVIDERS[id];
    if (!def) {
      return { id, enabled: false, skipReason: "unknown provider id", def: null, model: null, apiKey: null };
    }
    const apiKey = process.env[def.envKey];
    const model = (config.models && config.models[id]) || def.defaultModel;
    return apiKey
      ? { id, enabled: true, def, apiKey, model, skipReason: null }
      : { id, enabled: false, def, apiKey: null, model, skipReason: `${def.envKey} not set` };
  });
}

function summarize(runs) {
  const answered = runs.filter(r => !r.skipped && !r.error);
  const cited = answered.filter(r => r.cited);
  const byProv = {};
  for (const r of answered) {
    byProv[r.provider] = byProv[r.provider] || { total: 0, cited: 0 };
    byProv[r.provider].total += 1;
    if (r.cited) byProv[r.provider].cited += 1;
  }
  return {
    totalPrompts: new Set(runs.map(r => r.prompt)).size,
    totalAnswered: answered.length,
    citedCount: cited.length,
    perProvider: Object.entries(byProv).map(
      ([id, v]) => `${id}: ${v.cited}/${v.total} cited`
    ),
    errors: runs.filter(r => r.error).length,
  };
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}
