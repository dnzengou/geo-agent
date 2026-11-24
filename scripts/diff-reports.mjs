// diff-reports — print the week-over-week citation delta between
// two citation reports written by `geo-agent probe`. No LLM. No
// network. Just a stable, plain-text diff humans can read on a
// Monday morning.
import { readFile } from "node:fs/promises";

export async function diff([a, b]) {
  if (!a || !b) {
    throw new Error("usage: geo-agent diff <reportA.json> <reportB.json>");
  }
  const [prev, curr] = await Promise.all([loadReport(a), loadReport(b)]);
  const summary = compare(prev, curr);
  printDiff(summary, a, b);
  return summary;
}

async function loadReport(path) {
  const data = JSON.parse(await readFile(path, "utf8"));
  if (data.kind !== "citation-report") {
    throw new Error(`${path} is not a citation-report (kind=${data.kind})`);
  }
  return data;
}

function compare(prev, curr) {
  const byKey = (r) => {
    const m = new Map();
    for (const run of r.runs || []) {
      if (run.skipped || run.error) continue;
      m.set(`${run.provider}|${run.prompt}`, run);
    }
    return m;
  };
  const prevMap = byKey(prev);
  const currMap = byKey(curr);
  const keys = new Set([...prevMap.keys(), ...currMap.keys()]);

  const changes = [];
  let newlyCited = 0, lost = 0, stillCited = 0, stillMissing = 0;
  for (const k of keys) {
    const p = prevMap.get(k);
    const c = currMap.get(k);
    const [provider, prompt] = k.split("|");
    const prevCited = !!p?.cited;
    const currCited = !!c?.cited;
    if (prevCited && !currCited) {
      lost += 1;
      changes.push({ provider, prompt, change: "lost", prevQuote: p.citationQuote, currQuote: null });
    } else if (!prevCited && currCited) {
      newlyCited += 1;
      changes.push({ provider, prompt, change: "newly-cited", prevQuote: null, currQuote: c.citationQuote });
    } else if (prevCited && currCited) {
      stillCited += 1;
      if (p.citationQuote !== c.citationQuote) {
        changes.push({ provider, prompt, change: "quote-changed", prevQuote: p.citationQuote, currQuote: c.citationQuote });
      }
    } else {
      stillMissing += 1;
    }
  }

  const prevTotal = [...prevMap.values()].filter(r => r.cited).length;
  const currTotal = [...currMap.values()].filter(r => r.cited).length;
  const prevAnswered = prevMap.size;
  const currAnswered = currMap.size;

  return {
    brand: curr.brand,
    prevAsOf: prev.generatedAt,
    currAsOf: curr.generatedAt,
    prevCited: prevTotal, prevAnswered,
    currCited: currTotal, currAnswered,
    delta: currTotal - prevTotal,
    newlyCited, lost, stillCited, stillMissing,
    changes,
  };
}

function printDiff(s, aPath, bPath) {
  const arrow = s.delta > 0 ? "↑" : s.delta < 0 ? "↓" : "·";
  console.log(`geo-agent diff — ${s.brand}`);
  console.log(`  prev: ${aPath}  (${s.prevAsOf})  ${s.prevCited}/${s.prevAnswered} cited`);
  console.log(`  curr: ${bPath}  (${s.currAsOf})  ${s.currCited}/${s.currAnswered} cited  [${arrow} ${s.delta >= 0 ? "+" : ""}${s.delta}]`);
  console.log("");
  console.log(`  newly cited:   ${s.newlyCited}`);
  console.log(`  lost:          ${s.lost}`);
  console.log(`  still cited:   ${s.stillCited}`);
  console.log(`  still missing: ${s.stillMissing}`);
  if (!s.changes.length) {
    console.log("\n  no changes to report.");
    return;
  }
  console.log("\n  changes:");
  for (const c of s.changes) {
    const marker = c.change === "newly-cited" ? "+" : c.change === "lost" ? "-" : "~";
    console.log(`    ${marker} [${c.provider}] "${c.prompt}"`);
    if (c.currQuote) console.log(`        now:  ${c.currQuote}`);
    if (c.prevQuote) console.log(`        was:  ${c.prevQuote}`);
  }
}
