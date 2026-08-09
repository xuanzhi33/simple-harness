---
name: exa-search
description: "Search the web and fetch webpage content using Exa's MCP server via mcporter, wrapped by a tsx script. Provides clean, ready-to-use markdown results from any topic or URL. No API key or configuration required. Includes search for general web search (with numResults control) and fetch for extracting content from specific URLs. Supports --json for machine-parsable output. Built for quick research, content gathering, and AI agent integration."
---

# Exa Search via mcporter (tsx wrapper)

This skill enables web search using Exa's MCP server through `mcporter`, wrapped
by a small tsx script for clean, ready-to-use output. No API key required.

## Usage

Run the script directly from this directory (or any cwd, using its path):

```bash
.agents/skills/exa-search/exa.ts search "your search terms"
```

### Web Search

```bash
.agents/skills/exa-search/exa.ts search "your search terms"
```

**Examples:**
```bash
# Basic search (default 10 results)
.agents/skills/exa-search/exa.ts search "latest AI research papers 2026"

# Limit result count
.agents/skills/exa-search/exa.ts search "machine learning" 5

# Search for code
.agents/skills/exa-search/exa.ts search "Python async function example" 3
```

### Fetch Webpage Content

```bash
.agents/skills/exa-search/exa.ts fetch "https://example.com"
```

**Example — multiple URLs** (fetched one-by-one; Exa rejects comma-joined URLs):
```bash
.agents/skills/exa-search/exa.ts fetch "https://news.ycombinator.com" "https://github.com"
```

### Machine-Readable Output

Append `--json` to print mcporter's raw JSON payload (single URL / search) or a
keyed `{ url: payload }` object (multiple URLs):

```bash
.agents/skills/exa-search/exa.ts search "Python 3.12 features" --json
.agents/skills/exa-search/exa.ts fetch "https://example.com" --json
```

## How It Works

`exa.ts` (in this directory) shells out to mcporter and formats the output:

| Command | mcporter call wrapped |
|---------|----------------------|
| `search` | `mcporter call https://mcp.exa.ai/mcp.web_search_exa query="..." numResults=N --output json` |
| `fetch` (1 URL) | `mcporter call https://mcp.exa.ai/mcp.web_fetch_exa urls="u" --output json` |
| `fetch` (N URLs) | one call per URL, results concatenated |

Default (non-`--json`) output prints only the markdown text blocks from the
response — clean, without shell quoting pitfalls. `--json` prints the full raw
payload for machine parsing. `mcporter` missing? The script reports a clear
install hint instead of a cryptic error.

## Working with Results

The output includes:
- **Markdown content**: Ready to use in documentation or conversations
- **Sources**: URLs and metadata for verification
- **Extracted text**: Clean, readable content without ads or clutter

## Helpful Tips

1. **Append the current year (2026) when searching for the latest content**: For queries about recent news, releases, papers, or trends, add `2026` to the query so results reflect the newest information (e.g. `"latest Python release 2026"`).
2. **Be specific**: More detailed queries yield better results
3. **Control volume**: Use `numResults` to manage output size (default: 10)
4. **Combine commands**: Chain searches with shell pipelines
5. **No rate limits**: Free tier works for basic research needs

## Quick Reference Card

| Command | Purpose | Example |
|---------|---------|---------|
| `search "topic"` | Search the web | `exa.ts search "rust async"` |
| `search "topic" N` | Search, limit results | `exa.ts search "rust async" 5` |
| `fetch "url"` | Read webpage content | `exa.ts fetch "https://rust-lang.org"` |
| `--json` | Raw machine-readable output | `exa.ts search "rust async" --json` |
