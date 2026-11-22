#!/usr/bin/env node
// geo-agent — white-hat GEO (Generative Engine Optimization) agent.
// Agents draft. Humans sign.
import { run } from "../scripts/run.mjs";
run(process.argv.slice(2)).catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
