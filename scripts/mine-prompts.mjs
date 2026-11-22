// mine-prompts — read a support-channel export (CSV / JSONL) and propose
// prompt-voice FAQ entries. STUB: writes a proposal with the shape it
// will produce once wired to an LLM. The author signs each entry.
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function mine(config) {
  const sourcePath = config.supportExport;
  if (!sourcePath) {
    throw new Error("config.supportExport is required (path to a CSV or JSONL of user messages)");
  }
  const raw = await readFile(sourcePath, "utf8").catch(() => "");
  const lines = raw.split(/\r?\n/).filter(Boolean);

  const proposal = {
    kind: "faq-proposal",
    source: sourcePath,
    scannedMessages: lines.length,
    generatedAt: new Date().toISOString(),
    note: "Stub implementation. Wire this to the LLM of your choice to turn the top user-phrased questions into FAQ entries. Each entry is a DRAFT; a human approves before it lands in agent-seo.config.json.",
    proposedFaq: [
      {
        q: "Example: a question in the user's own words",
        a: "Example: a specific, verifiable answer. Replace with real entries once wired.",
        confidence: 0.0,
        supportingMessages: []
      }
    ]
  };

  const out = join("proposals", `faq-${isoDate()}.json`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(proposal, null, 2));
  console.log(`geo-agent mine: wrote ${out}`);
  console.log(`  ${lines.length} messages scanned (stub).`);
  console.log(`  next: review, edit, merge into your agent-seo.config.json by hand.`);
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}
