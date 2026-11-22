// probe-citations — ask the major assistants a fixed set of prompts
// on a cadence, record whether the product is named and with what
// wording. Uses the user's own API keys from env. No spoofing,
// no inflated prompts. Writes a report under ./reports/.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function probe(config) {
  const prompts = config.probePrompts || [];
  if (!prompts.length) {
    throw new Error("config.probePrompts must be a non-empty array of strings");
  }
  const brand = config.name || "<your product>";
  const providers = resolveProviders(config);

  const runs = [];
  for (const provider of providers) {
    for (const prompt of prompts) {
      runs.push({
        provider: provider.id,
        prompt,
        askedAt: new Date().toISOString(),
        response: provider.enabled
          ? "(stub) wire the provider SDK here to record the live response"
          : `skipped: ${provider.skipReason}`,
        cited: null,
        citationQuote: null
      });
    }
  }

  const report = {
    kind: "citation-report",
    brand,
    generatedAt: new Date().toISOString(),
    providers: providers.map(p => ({ id: p.id, enabled: p.enabled, skipReason: p.skipReason })),
    runs,
    howToScore: "After filling 'response', set cited=true/false and citationQuote to the exact text containing the brand. Diff week over week to track the mechanism."
  };

  const out = join("reports", `citations-${isoDate()}.json`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(`geo-agent probe: wrote ${out}`);
  console.log(`  ${providers.length} providers x ${prompts.length} prompts = ${runs.length} runs (stubs).`);
  console.log(`  providers enabled:`, providers.filter(p => p.enabled).map(p => p.id).join(", ") || "(none — set the API keys in env)");
}

function resolveProviders(_config) {
  return [
    { id: "openai",     enabled: !!process.env.OPENAI_API_KEY,     skipReason: "OPENAI_API_KEY not set" },
    { id: "anthropic",  enabled: !!process.env.ANTHROPIC_API_KEY,  skipReason: "ANTHROPIC_API_KEY not set" },
    { id: "perplexity", enabled: !!process.env.PERPLEXITY_API_KEY, skipReason: "PERPLEXITY_API_KEY not set" },
    { id: "gemini",     enabled: !!process.env.GEMINI_API_KEY,     skipReason: "GEMINI_API_KEY not set" }
  ];
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}
