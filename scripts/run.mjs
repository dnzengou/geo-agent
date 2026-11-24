// geo-agent entry. Dispatches to mine | probe | entity | diff | all.
// Every write-to-disk step produces a proposal or report for human review.
// Nothing ships without the human approving the proposal.
import { mine } from "./mine-prompts.mjs";
import { probe } from "./probe-citations.mjs";
import { completeEntityGraph } from "./complete-entity-graph.mjs";
import { diff } from "./diff-reports.mjs";
import { readFile } from "node:fs/promises";

const USAGE = `
geo-agent <command> [args...]

commands:
  mine   [config.json]                          propose prompt-voice FAQ entries from a support export (LLM-agnostic drafter)
  probe  [config.json]                          ask OpenAI / Claude / Perplexity / Gemini a fixed set of prompts and record citations
  entity [config.json]                          walk the sameAs graph and propose missing profile copy
  diff   <prevReport.json> <currReport.json>    print the week-over-week citation delta between two probe reports
  all    [config.json]                          run mine + probe + entity in order

drafter and probe providers come from env keys. Any one of these
enables the drafter (cheap first): DEEPSEEK_API_KEY, OPENAI_API_KEY,
ANTHROPIC_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY,
TOGETHER_API_KEY, FIREWORKS_API_KEY, OPENROUTER_API_KEY — or a
running Ollama (http://127.0.0.1:11434).

every command writes a proposal or report under ./proposals/ or ./reports/.
nothing ships until a human merges approved items into agent-seo.config.json.
`.trim();

export async function run(argv) {
  const [cmd = "", ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(USAGE);
    return;
  }
  if (cmd === "diff") {
    return diff(rest);
  }
  const configPath = rest[0] || "geo-agent.config.json";
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
