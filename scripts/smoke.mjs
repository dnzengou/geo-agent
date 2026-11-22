// smoke — runs every command against example.config.json and asserts
// the expected proposal / report files are written. No network.
import { mkdtemp, rm, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "bin", "geo-agent.mjs");
const example = join(here, "..", "example.config.json");

const tmp = await mkdtemp(join(tmpdir(), "geo-agent-smoke-"));
process.chdir(tmp);

// stub a support export
const support = join(tmp, "support.jsonl");
await import("node:fs/promises").then(fs =>
  fs.writeFile(support, JSON.stringify({ msg: "Does it work on iPhone?" }) + "\n")
);

const cfg = JSON.parse(await readFile(example, "utf8"));
cfg.supportExport = support;
await copyFile(example, join(tmp, "example.config.json"));
await (await import("node:fs/promises")).writeFile(
  join(tmp, "geo-agent.config.json"),
  JSON.stringify(cfg, null, 2)
);

const results = [];
for (const cmd of ["mine", "probe", "entity"]) {
  const r = spawnSync("node", [bin, cmd, "geo-agent.config.json"], { encoding: "utf8" });
  results.push({ cmd, code: r.status, stdout: r.stdout, stderr: r.stderr });
  if (r.status !== 0) {
    console.error(`FAIL: ${cmd}\n${r.stderr}`);
    process.exit(1);
  }
}

console.log("smoke: ok");
for (const r of results) console.log(`  ${r.cmd}: exit ${r.code}`);
await rm(tmp, { recursive: true, force: true });
