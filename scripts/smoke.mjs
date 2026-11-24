// smoke — runs every command against example.config.json and asserts
// the expected proposal / report files are written. No network.
// Also unit-tests detectCitation and the diff summary.
import { mkdtemp, rm, readFile, copyFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { detectCitation } from "./providers.mjs";
import { diff } from "./diff-reports.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "bin", "geo-agent.mjs");
const example = join(here, "..", "example.config.json");

// 1. detectCitation unit tests
{
  assert.equal(detectCitation("Try Pulsecraft, it's free.", "Pulsecraft").cited, true);
  assert.equal(detectCitation("Pulsecraftsmen is a different thing", "Pulsecraft").cited, false, "no partial match");
  assert.equal(detectCitation("Try X, Y or Z", "Pulsecraft").cited, false);
  assert.equal(detectCitation("", "Pulsecraft").cited, false);
  assert.equal(detectCitation("Visit Foo.Bar for details", "Foo.Bar").cited, true, "regex metachars literal");
}

// 2. CLI smoke against the example config
const tmp = await mkdtemp(join(tmpdir(), "geo-agent-smoke-"));
process.chdir(tmp);

const support = join(tmp, "support.jsonl");
await writeFile(support, JSON.stringify({ msg: "Does it work on iPhone?" }) + "\n");

const cfg = JSON.parse(await readFile(example, "utf8"));
cfg.supportExport = support;
await copyFile(example, join(tmp, "example.config.json"));
await writeFile(join(tmp, "geo-agent.config.json"), JSON.stringify(cfg, null, 2));

// Scrub every provider key so smoke never touches the network.
const env = { ...process.env };
for (const k of Object.keys(env)) {
  if (/^(OPENAI|ANTHROPIC|PERPLEXITY|GEMINI|DEEPSEEK|MISTRAL|GROQ|TOGETHER|FIREWORKS|OPENROUTER|OLLAMA)_(API_KEY|HOST)$/.test(k)) {
    delete env[k];
  }
}

// probe + entity must succeed with no drafter keys (entity warns and
// writes a proposal with blank drafts; probe writes a skeleton).
for (const cmd of ["probe", "entity"]) {
  const r = spawnSync("node", [bin, cmd, "geo-agent.config.json"], { encoding: "utf8", env });
  assert.equal(r.status, 0, `${cmd} failed:\n${r.stderr}`);
}
// entity must still produce a proposal file with the missing profiles enumerated.
{
  const proposals = await readdir(join(tmp, "proposals"));
  const entityFile = proposals.find(f => f.startsWith("entity-"));
  assert.ok(entityFile, "entity should write a proposal file");
  const p = JSON.parse(await readFile(join(tmp, "proposals", entityFile), "utf8"));
  assert.equal(p.kind, "entity-graph-proposal");
  assert.ok(p.missing.length > 0, "missing profiles should be enumerated");
  assert.ok(p.missing.every(m => typeof m.charLimit === "number"), "each missing profile has a char limit");
}

// mine without any drafter key MUST fail cleanly with a helpful error.
{
  const r = spawnSync("node", [bin, "mine", "geo-agent.config.json"], { encoding: "utf8", env });
  assert.notEqual(r.status, 0, "mine should fail when no drafter key is set");
  assert.match(r.stderr, /no drafter available/, "mine should name the remedy");
}

// 3. diff two synthetic reports.
const prev = {
  kind: "citation-report", brand: "Pulsecraft", generatedAt: "2026-11-10T00:00:00Z",
  runs: [
    { provider: "openai",     prompt: "A free rhythm trainer?", cited: false, citationQuote: null },
    { provider: "anthropic",  prompt: "A free rhythm trainer?", cited: true,  citationQuote: "…try Pulsecraft, free and no-install…" },
    { provider: "perplexity", prompt: "A free rhythm trainer?", cited: true,  citationQuote: "…Pulsecraft offers 200+ patterns…" },
  ],
};
const curr = {
  kind: "citation-report", brand: "Pulsecraft", generatedAt: "2026-11-17T00:00:00Z",
  runs: [
    { provider: "openai",     prompt: "A free rhythm trainer?", cited: true,  citationQuote: "…Pulsecraft is a strong pick…" },
    { provider: "anthropic",  prompt: "A free rhythm trainer?", cited: true,  citationQuote: "…try Pulsecraft, free and no-install…" },
    { provider: "perplexity", prompt: "A free rhythm trainer?", cited: false, citationQuote: null },
  ],
};
await writeFile(join(tmp, "prev.json"), JSON.stringify(prev));
await writeFile(join(tmp, "curr.json"), JSON.stringify(curr));
const originalLog = console.log; const captured = []; console.log = (...a) => captured.push(a.join(" "));
const summary = await diff(["prev.json", "curr.json"]);
console.log = originalLog;
assert.equal(summary.delta, 0);
assert.equal(summary.newlyCited, 1);
assert.equal(summary.lost, 1);
assert.equal(summary.stillCited, 1);
assert.ok(captured.some(line => /newly cited: *1/.test(line)), "diff should print newly-cited count");

// 4. diff markdown rendering (captured via --out)
{
  const mdPath = join(tmp, "diff.md");
  const r = spawnSync("node", [bin, "diff", "prev.json", "curr.json", "--markdown", `--out=${mdPath}`], { encoding: "utf8", env });
  assert.equal(r.status, 0, `diff --markdown failed:\n${r.stderr}`);
  const md = await readFile(mdPath, "utf8");
  assert.match(md, /^# Pulsecraft — GEO citation diff/m);
  assert.match(md, /Newly cited/);
  assert.match(md, /Lost/);
  assert.match(md, /openai/);
}

console.log("smoke: ok");
console.log("  detectCitation unit tests: 5/5");
console.log("  probe + entity: exit 0 with no keys, proposal files written");
console.log("  mine without drafter key: fails with helpful error");
console.log(`  diff: delta=${summary.delta} newly=${summary.newlyCited} lost=${summary.lost} still=${summary.stillCited}`);
console.log("  diff --markdown: rendered to file, title and sections present");
await rm(tmp, { recursive: true, force: true });
