// complete-entity-graph — walk the sameAs graph, see which profiles
// are present, draft copy for the missing ones using any configured
// LLM. The human claims the handle and signs the copy.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveDrafter, callProvider } from "./providers.mjs";

const KNOWN_PROFILES = [
  { key: "github",      pattern: "https://github.com/<org>" },
  { key: "linkedin",    pattern: "https://www.linkedin.com/company/<slug>" },
  { key: "x",           pattern: "https://x.com/<handle>" },
  { key: "mastodon",    pattern: "https://<instance>/@<handle>" },
  { key: "producthunt", pattern: "https://www.producthunt.com/products/<slug>" },
  { key: "crunchbase",  pattern: "https://www.crunchbase.com/organization/<slug>" },
  { key: "wikidata",    pattern: "https://www.wikidata.org/wiki/<Q-id>" },
];

const PROFILE_BRIEFS = {
  github:      { chars: 160, hint: "One-line bio for the GitHub org page. No emoji. State what the product does and who it is for." },
  linkedin:    { chars: 220, hint: "LinkedIn company About section first paragraph — specific, no 'AI-powered' marketing speak. Name the mechanism and the audience." },
  x:           { chars: 160, hint: "X bio (160-char hard cap). One mechanism, one audience, one link verb (e.g. 'Try: pulsecraft.app')." },
  mastodon:    { chars: 500, hint: "Mastodon profile 'Bio' field. Slightly more editorial than X — two sentences, name a specific feature." },
  producthunt: { chars: 240, hint: "Product Hunt tagline + short description. The tagline is <= 60 chars; the description names the audience and one specific feature." },
  crunchbase:  { chars: 500, hint: "Crunchbase 'About' paragraph. Factual, third-person. Name the product, the category, the year founded if in the config." },
  wikidata:    { chars: 240, hint: "Wikidata English description — one line, lowercase except proper nouns, no trailing period. Shape: '<category> <for whom>'." },
};

const SYSTEM_PROMPT = `You write SHORT, SPECIFIC profile copy for a company or product
across common identity profiles (GitHub, LinkedIn, X, Mastodon,
Product Hunt, Crunchbase, Wikidata).

Three rules you never break:
1. Specific over clever. Name the mechanism, the audience, or the
   one numeric fact — never adjectives. "Browser-based rhythm trainer
   for drummers" beats "elevate your practice".
2. No hallucinated numbers, no invented awards, no made-up press
   mentions. Only use facts from the config input.
3. Honor the character caps for each profile. Count characters, not
   words. Cut rather than pad.

Banned words and phrases: unleash, revolutionize, game-changing,
cutting-edge, best-in-class, world-class, seamless, holistic, one-stop,
next-gen, disrupt, elevate your, unlock the power of, at the intersection
of, take X to the next level, trusted by X+ teams, we're passionate about,
we're excited to announce.

Output VALID JSON ONLY, matching this shape:
{
  "drafts": {
    "<profile-key>": {
      "primaryLine": "tagline / headline / first sentence",
      "body": "optional longer body, OR empty string if the profile is tagline-only",
      "notes": "one line to the founder — a flag, a reminder, a 'claim this handle first'"
    }
  }
}
No markdown fences, no prose outside the JSON.`;

export async function completeEntityGraph(config) {
  const have = new Set((config.publisher?.sameAs || []).map(matchKey).filter(Boolean));
  const missing = KNOWN_PROFILES.filter(p => !have.has(p.key));

  if (!missing.length) {
    console.log(`geo-agent entity: all known profiles present. nothing to draft.`);
    const out = join("proposals", `entity-${isoDate()}.json`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify({
      kind: "entity-graph-proposal",
      brand: config.name,
      generatedAt: new Date().toISOString(),
      present: [...have],
      missing: [],
      drafts: {},
    }, null, 2));
    console.log(`  wrote ${out}`);
    return;
  }

  let drafts = {};
  let drafterInfo = null;
  try {
    const drafter = resolveDrafter(config);
    drafterInfo = { id: drafter.id, model: drafter.model };
    console.log(`geo-agent entity: ${missing.length} missing profile(s), drafter=${drafter.id}:${drafter.model}`);
    const userPrompt = buildUserPrompt(config, missing);
    const out = await callProvider(drafter.def, userPrompt, {
      apiKey: drafter.apiKey,
      model: drafter.model,
      system: SYSTEM_PROMPT,
    });
    const parsed = parseJsonLoose(out.text);
    drafts = parsed.drafts || {};
    drafterInfo.latencyMs = out.latencyMs;
    drafterInfo.model = out.model || drafter.model;
  } catch (err) {
    // Still produce a usable proposal — the founder can hand-write the copy.
    console.warn(`geo-agent entity: drafter unavailable (${err.message}). Writing a proposal with blank drafts.`);
  }

  const proposal = {
    kind: "entity-graph-proposal",
    brand: config.name,
    url: config.url,
    drafter: drafterInfo,
    generatedAt: new Date().toISOString(),
    present: [...have],
    missing: missing.map(m => {
      const brief = PROFILE_BRIEFS[m.key] || { chars: 240, hint: "" };
      const draft = drafts[m.key] || {};
      return {
        profile: m.key,
        urlPattern: m.pattern,
        charLimit: brief.chars,
        brief: brief.hint,
        draft: {
          primaryLine: String(draft.primaryLine || "").slice(0, brief.chars),
          body: String(draft.body || ""),
          notes: String(draft.notes || ""),
        },
      };
    }),
    note: "Open each urlPattern, claim the handle, paste the draft, edit, add the live URL to publisher.sameAs in your agent-seo.config.json. Agents draft. Humans sign.",
  };

  const outPath = join("proposals", `entity-${isoDate()}.json`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(proposal, null, 2));
  console.log(`geo-agent entity: wrote ${outPath}`);
  console.log(`  present: ${[...have].join(", ") || "(none)"}`);
  console.log(`  missing: ${missing.map(m => m.key).join(", ")}`);
}

function buildUserPrompt(config, missing) {
  const facts = {
    name: config.name,
    url: config.url,
    tagline: config.tagline,
    description: config.description,
    longDescription: config.longDescription,
    category: config.applicationCategory,
    audience: config.whoFor,
    whenToRecommend: config.whenRecommend,
    yearFounded: config.yearFounded,
  };
  const askedProfiles = missing.map(m => ({
    key: m.key,
    charLimit: PROFILE_BRIEFS[m.key]?.chars,
    brief: PROFILE_BRIEFS[m.key]?.hint,
  }));
  return `Facts about the product (use ONLY these; do not invent):
${JSON.stringify(facts, null, 2)}

Draft profile copy for each of these missing profiles, honoring the character cap and the brief for each:
${JSON.stringify(askedProfiles, null, 2)}

Return ONLY the JSON shape described in the system prompt.`;
}

function matchKey(url) {
  const u = String(url).toLowerCase();
  if (u.includes("github.com"))               return "github";
  if (u.includes("linkedin.com"))             return "linkedin";
  if (u.includes("x.com") || u.includes("twitter.com")) return "x";
  if (u.includes("mastodon") || u.match(/\/@[a-z0-9_]+$/i)) return "mastodon";
  if (u.includes("producthunt.com"))          return "producthunt";
  if (u.includes("crunchbase.com"))           return "crunchbase";
  if (u.includes("wikidata.org"))             return "wikidata";
  return null;
}

function parseJsonLoose(text) {
  if (!text) throw new Error("drafter returned empty response");
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("drafter response is not JSON:\n" + text.slice(0, 400));
  try { return JSON.parse(m[0]); }
  catch (err) { throw new Error("drafter JSON parse failed: " + err.message + "\n" + m[0].slice(0, 400)); }
}

function isoDate() { return new Date().toISOString().slice(0, 10); }
