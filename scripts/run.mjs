// geo-agent entry. Dispatches to mine | probe | entity | all.
// Every write-to-disk step produces a proposal JSON for human review.
// Nothing ships without the human approving the proposal.
import { mine } from "./mine-prompts.mjs";
import { probe } from "./probe-citations.mjs";
import { completeEntityGraph } from "./complete-entity-graph.mjs";
import { readFile } from "node:fs/promises";

const USAGE = `
geo-agent <command> [config.json]

commands:
  mine    read a support channel export and propose prompt-voice FAQ entries
  probe   ask the major assistants a fixed set of prompts and record citations
  entity  walk the sameAs graph and propose missing profile copy
  all     run mine, probe, entity in order

every command writes a proposal file under ./proposals/. Nothing ships
until a human merges the proposal into agent-seo.config.json by hand
or with:   geo-agent sign <proposal.json>
`.trim();

export async function run(argv) {
  const [cmd = "", configPath = "geo-agent.config.json"] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(USAGE);
    return;
  }
  const config = await loadConfig(configPath);
  switch (cmd) {
    case "mine":   return mine(config);
    case "probe":  return probe(config);
    case "entity": return completeEntityGraph(config);
    case "all":
      await mine(config);
      await probe(config);
      await completeEntityGraph(config);
      return;
    default:
      console.error(`unknown command: ${cmd}\n\n${USAGE}`);
      process.exit(2);
  }
}

async function loadConfig(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    console.error(`could not read config at ${path}: ${err.message}`);
    console.error(`copy example.config.json and edit, or see README.md`);
    process.exit(2);
  }
}
