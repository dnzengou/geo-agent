// complete-entity-graph — walk the sameAs graph from the product's
// Organization block, check which profiles resolve and which are
// missing, and propose draft copy for the missing ones. Human signs.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const KNOWN_PROFILES = [
  { key: "github",      pattern: "https://github.com/<org>" },
  { key: "linkedin",    pattern: "https://www.linkedin.com/company/<slug>" },
  { key: "x",           pattern: "https://x.com/<handle>" },
  { key: "mastodon",    pattern: "https://<instance>/@<handle>" },
  { key: "producthunt", pattern: "https://www.producthunt.com/products/<slug>" },
  { key: "crunchbase",  pattern: "https://www.crunchbase.com/organization/<slug>" },
  { key: "wikidata",    pattern: "https://www.wikidata.org/wiki/<Q-id>" }
];

export async function completeEntityGraph(config) {
  const have = new Set((config.publisher?.sameAs || []).map(matchKey).filter(Boolean));
  const missing = KNOWN_PROFILES.filter(p => !have.has(p.key));

  const proposal = {
    kind: "entity-graph-proposal",
    brand: config.name,
    url: config.url,
    generatedAt: new Date().toISOString(),
    present: [...have],
    missing: missing.map(m => ({
      profile: m.key,
      urlPattern: m.pattern,
      draftCopy: `(stub) wire an LLM to draft ${m.key} profile copy in the DS voice using tagline + description from the config.`
    })),
    note: "Open each proposed URL pattern, decide whether to claim the profile, fill in the handle, paste draft copy, add the live URL to publisher.sameAs."
  };

  const out = join("proposals", `entity-${isoDate()}.json`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(proposal, null, 2));
  console.log(`geo-agent entity: wrote ${out}`);
  console.log(`  present: ${[...have].join(", ") || "(none)"}`);
  console.log(`  missing: ${missing.map(m => m.key).join(", ") || "(none)"}`);
}

function matchKey(url) {
  const u = String(url).toLowerCase();
  if (u.includes("github.com"))               return "github";
  if (u.includes("linkedin.com"))             return "linkedin";
  if (u.includes("x.com") || u.includes("twitter.com")) return "x";
  if (u.includes("mastodon") || u.includes("@"))        return "mastodon";
  if (u.includes("producthunt.com"))          return "producthunt";
  if (u.includes("crunchbase.com"))           return "crunchbase";
  if (u.includes("wikidata.org"))             return "wikidata";
  return null;
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}
