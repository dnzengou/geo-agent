// diff-reports — print the week-over-week citation delta between
// two citation reports written by `geo-agent probe`. No LLM. No
// network. Just a stable, plain-text diff humans can read on a
// Monday morning.
import { readFile } from "node:fs/promises";

export async function diff(args) {
  const flags = parseFlags(args);
  if (!flags.prev || !flags.curr) {
    throw new Error("usage: geo-agent diff <prevReport.json> <currReport.json> [--markdown [--out=diff.md]]");
  }
  const [prev, curr] = await Promise.all([loadReport(flags.prev), loadReport(flags.curr)]);
  const summary = compare(prev, curr);

  if (flags.markdown) {
    const md = renderMarkdown(summary, flags.prev, flags.curr);
    if (flags.out) {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(flags.out), { recursive: true });
      await writeFile(flags.out, md);
      console.log(`geo-agent diff: wrote ${flags.out}`);
    } else {
      process.stdout.write(md);
    }
  } else {
    printDiff(summary, flags.prev, flags.curr);
  }
  return summary;
}

function parseFlags(args) {
  const out = { prev: null, curr: null, markdown: false, out: null };
  const positional = [];
  for (const a of args || []) {
    if (a === "--markdown" || a === "--md") out.markdown = true;
    else if (a.startsWith("--out=")) out.out = a.slice(6);
    else positional.push(a);
  }
  out.prev = positional[0];
  out.curr = positional[1];
  return out;
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

function renderMarkdown(s, aPath, bPath) {
  const arrow = s.delta > 0 ? "↑" : s.delta < 0 ? "↓" : "·";
  const sign = s.delta > 0 ? "+" : "";
  const lines = [];
  lines.push(`# ${s.brand} — GEO citation diff`);
  lines.push("");
  lines.push(`**${arrow} ${sign}${s.delta}** this week.`);
  lines.push(`Prev: ${s.prevCited}/${s.prevAnswered} cited (as of ${s.prevAsOf}). Curr: ${s.currCited}/${s.currAnswered} cited (as of ${s.currAsOf}).`);
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("|---|---|");
  lines.push(`| Newly cited | ${s.newlyCited} |`);
  lines.push(`| Lost | ${s.lost} |`);
  lines.push(`| Still cited | ${s.stillCited} |`);
  lines.push(`| Still missing | ${s.stillMissing} |`);
  lines.push("");

  const news  = s.changes.filter(c => c.change === "newly-cited");
  const losts = s.changes.filter(c => c.change === "lost");
  const quotes = s.changes.filter(c => c.change === "quote-changed");

  if (news.length) {
    lines.push("## Newly cited");
    lines.push("");
    for (const c of news) {
      lines.push(`- **[${c.provider}]** "${c.prompt}"`);
      if (c.currQuote) lines.push(`  > ${c.currQuote}`);
    }
    lines.push("");
  }
  if (losts.length) {
    lines.push("## Lost");
    lines.push("");
    for (const c of losts) {
      lines.push(`- **[${c.provider}]** "${c.prompt}"`);
      if (c.prevQuote) lines.push(`  > was: ${c.prevQuote}`);
    }
    lines.push("");
  }
  if (quotes.length) {
    lines.push("## Citation quote shifted");
    lines.push("");
    for (const c of quotes) {
      lines.push(`- **[${c.provider}]** "${c.prompt}"`);
      if (c.currQuote) lines.push(`  > now: ${c.currQuote}`);
      if (c.prevQuote) lines.push(`  > was: ${c.prevQuote}`);
    }
    lines.push("");
  }
  if (!news.length && !losts.length && !quotes.length) {
    lines.push("No citations changed between the two reports.");
    lines.push("");
  }
  lines.push("---");
  lines.push(`_Generated by [geo-agent](https://github.com/dnzengou/geo-agent) · prev: \`${aPath}\` · curr: \`${bPath}\`_`);
  lines.push("");
  return lines.join("\n");
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
