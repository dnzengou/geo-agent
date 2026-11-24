# geo-agent

> **White-hat GEO (Generative Engine Optimization) agent.** Sibling to [`agent-seo`](https://github.com/dnzengou/agent-seo). Agents draft. Humans sign.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](#requirements)
[![Zero deps](https://img.shields.io/badge/deps-0-blue)](./package.json)

Zero runtime dependencies. One Node CLI. One config file. Three agents.

| Command | Purpose |
|---|---|
| `geo-agent mine <config>` | Read a support-channel export; propose prompt-voice FAQ entries using any configured LLM. |
| `geo-agent probe <config>` | Ask the major assistants a fixed set of prompts on a cadence; record citations. |
| `geo-agent entity <config>` | Walk the `sameAs` graph; propose missing profile copy. |
| `geo-agent diff <prev.json> <curr.json> [--markdown [--out=diff.md]]` | Print or render-to-markdown the week-over-week citation delta between two probe reports. |
| `geo-agent all <config>` | Run mine + probe + entity in order. |

Every command writes a **proposal** or **report** under `./proposals/` or `./reports/`. Nothing ships to your live site. The human reads the proposal, approves the entries worth shipping, and merges them into the [`agent-seo.config.json`](https://github.com/dnzengou/agent-seo) their site is actually generated from.

---

## Why it exists

`agent-seo` positions a site to be cited by AI assistants. `geo-agent` does the compounding work after that: it finds the prompts your users actually type, measures whether you got cited, and fills the holes in your entity graph. It is the difference between *shipping once* and *shipping once a quarter*.

Three constraints hold throughout:

◆ **Human signs everything.** Every write is a proposal to review, never a live mutation of your site.
◆ **No spoofing.** The citation probe uses the official provider APIs with your own keys. No scraping. No rotating identities. No inflated prompts.
◆ **You keep the keys, the config, the repo.** This is a repo you run, not a SaaS you subscribe to.

---

## Quick start

From any repo:

```bash
npx github:dnzengou/geo-agent mine ./geo-agent.config.json
npx github:dnzengou/geo-agent probe ./geo-agent.config.json
npx github:dnzengou/geo-agent entity ./geo-agent.config.json
```

Or install locally and wire into `package.json`:

```bash
npm install --save-dev github:dnzengou/geo-agent
```

```jsonc
{
  "scripts": {
    "geo:mine":   "geo-agent mine geo-agent.config.json",
    "geo:probe":  "geo-agent probe geo-agent.config.json",
    "geo:entity": "geo-agent entity geo-agent.config.json"
  }
}
```

---

## Config shape

Minimum:

```json
{
  "name": "Your Product",
  "url": "https://your-product.example/",
  "publisher": {
    "name": "Your Company",
    "url": "https://your-company.example",
    "sameAs": [
      "https://github.com/you/yours",
      "https://www.linkedin.com/company/yours"
    ]
  },
  "supportExport": "./data/support.jsonl",
  "probePrompts": [
    "A free X for Y?",
    "Where do I get Z that supports W?"
  ]
}
```

| Field | Shape | Notes |
|---|---|---|
| `name` / `url` | string | Required. The product being probed. |
| `publisher.sameAs` | string[] | Seeds the entity-graph walk. |
| `supportExport` | string path | JSONL or CSV of user messages — Intercom export, Discord dump, email archive. Private, local file. |
| `probePrompts` | string[] | The fixed set of user-shaped prompts the probe runs. Keep stable so week-over-week diffs are meaningful. |

---

## Provider keys — LLM-agnostic

`geo-agent` is deliberately LLM-agnostic. Set the keys you have; the agent picks what to use.

**Probe providers** (what the probe asks on your behalf — defaults to the four mainstream assistants):

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export PERPLEXITY_API_KEY=pplx-...
export GEMINI_API_KEY=...
```

**Drafter providers** (what `mine` uses to draft prompt-voice FAQs — resolved cheapest-first, so DeepSeek wins if you have the key):

```bash
export DEEPSEEK_API_KEY=...        # recommended — cheap, strong on English drafting
export GROQ_API_KEY=...             # free tier available
export MISTRAL_API_KEY=...
export OPENROUTER_API_KEY=...       # single key, hundreds of models
export TOGETHER_API_KEY=...
export FIREWORKS_API_KEY=...
export OLLAMA_HOST=http://127.0.0.1:11434   # local, zero-cost
```

Any provider that implements the OpenAI chat-completion shape works. Override the auto-pick in config:

```json
{ "drafter": "deepseek", "models": { "deepseek": "deepseek-chat" } }
```

No key for a given probe provider → that provider is skipped with a note in the report. Expected.

---

## Outputs

Everything goes under two gitignored directories:

- `proposals/faq-YYYY-MM-DD.json` — from `mine`. Read, edit, merge into your `agent-seo.config.json` by hand.
- `proposals/entity-YYYY-MM-DD.json` — from `entity`. Same flow.
- `reports/citations-YYYY-MM-DD.json` — from `probe`. Keep a running series so you can diff week over week.

---

## Status

**v0.0.4 — v1.0 agent surface complete.** All three agents and the diff command are live:

- `probe` calls OpenAI, Anthropic, Perplexity and Gemini via native `fetch` (zero deps, Node 18+).
- `mine` reads a support-channel export (CSV or JSONL) and drafts prompt-voice FAQ entries using any configured LLM — DeepSeek, Groq, Mistral, OpenAI, Anthropic, Gemini, OpenRouter, Together, Fireworks or a local Ollama. Cheapest available wins by default; override with `config.drafter`.
- `entity` walks the `sameAs` graph and drafts copy for every missing profile (GitHub, LinkedIn, X, Mastodon, Product Hunt, Crunchbase, Wikidata) with per-profile character caps, briefs, and a banned-marketing-language guardrail. Uses the same drafter resolver as `mine`.
- `diff` prints the week-over-week citation delta — or renders to Markdown (`--markdown --out=diff.md`) for the weekly email.

Smoke tests cover all four commands end-to-end with every provider key scrubbed. Ship cadence: weekly `probe` → weekly `diff --markdown` → human reads, approves what's worth shipping, merges into `agent-seo.config.json`.

See the walkthrough article: [*Agent SEO: the week a 400-user indie tool muscled its way into ChatGPT, Claude and Perplexity answers*](https://desiredsolutions.me/notes/agent-seo-the-week-an-indie-saas-got-cited).

---

## Requirements

Node ≥ 18. No other runtime dependencies.

---

## License

MIT. A venture of **Desired Solutions** (https://desiredsolutions.me) — the agentic AI, deep-tech and ownership studio. Sibling to [`agent-seo`](https://github.com/dnzengou/agent-seo).

*Build leverage. Keep the upside.*
