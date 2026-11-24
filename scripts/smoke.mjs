// smoke — runs every command against example.config.json and asserts
// the expected proposal / report files are written. No network.
// Also unit-tests detectCitation against a few canonical strings.
import { mkdtemp, rm, readFile, copyFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { detectCitation } from "./providers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "bin", "geo-agent.mjs");
const example = join(here, "..", "example.config.json");

// 1. detectCitation unit tests
{
  const hit = detectCitation("Try Pulsecraft, it's free.", "Pulsecraft");
  assert.equal(hit.cited, true);
  assert.ok(hit.quote?.toLowerCase().includes("pulsecraft"));

  const partial = detectCitation("Pulsecraftsmen is a different thing", "Pulsecraft");
  assert.equal(partial.cited, false, "must not partial-match a longer word");

  const miss = detectCitation("Try X, Y or Z", "Pulsecraft");
  assert.equal(miss.cited, false);

  const empty = detectCitation("", "Pulsecraft");
  assert.equal(empty.cited, false);

  const special = detectCitation("Visit Foo.Bar for details", "Foo.Bar");
  assert.equal(special.cited, true, "brand with regex metachars must match literally");
}

// 2. CLI commands end-to-end against the example config
const tmp = await mkdtemp(join(tmpdir(), "geo-agent-smoke-"));
process.chdir(tmp);

const support = join(tmp, "support.jsonl");
await writeFile(support, JSON.stringify({ msg: "Does it work on iPhone?" }) + "\n");

const cfg = JSON.parse(await readFile(example, "utf8"));
cfg.supportExport = support;
await copyFile(example, join(tmp, "example.config.json"));
await writeFile(join(tmp, "geo-agent.config.json"), JSON.stringify(cfg, null, 2));

// probe runs with no keys in env — it should write a skeleton report
// (all runs marked skipped) and exit 0.
const env = { ...process.env };
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "PERPLEXITY_API_KEY", "GEMINI_API_KEY"]) {
  delete env[k];
}

const results = [];
for (const cmd of ["mine", "probe", "entity"]) {
  const r = spawnSync("node", [bin, cmd, "geo-agent.config.json"], { encoding: "utf8", env });
  results.push({ cmd, code: r.status, stdout: r.stdout, stderr: r.stderr });
  if (r.status !== 0) {
    console.error(`FAIL: ${cmd}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
    process.exit(1);
  }
}

// 3. probe must have written a report with every run skipped
const reportDir = join(tmp, "reports");
const reportFiles = (await (await import("node:fs/promises")).readdir(reportDir)).filter(f => f.startsWith("citations-"));
assert.equal(reportFiles.length, 1, "exactly one citation report expected");
const report = JSON.parse(await readFile(join(reportDir, reportFiles[0]), "utf8"));
assert.equal(report.kind, "citation-report");
assert.ok(report.runs.length > 0, "runs should be enumerated even when skipped");
assert.ok(report.runs.every(r => r.skipped), "all runs skipped when no keys set");

console.log("smoke: ok");
for (const r of results) console.log(`  ${r.cmd}: exit ${r.code}`);
console.log("  detectCitation unit tests: 5/5");
console.log(`  probe report: ${report.runs.length} runs (all skipped — expected)`);
await rm(tmp, { recursive: true, force: true });
