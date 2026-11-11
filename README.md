# Lean Connector Results

A Claude Code mod by [Creator Scripts](https://creatorscripts.com) that trims the noise out of large connector (MCP) results before Claude reads them, so long Zoho, Make and other connector sessions stay fast and use fewer tokens.

When a connector returns a big list of records, most of it is often empty fields and system metadata. This mod removes that, and leaves everything you are actually working on alone.

## What it strips

Only results from read tools (get, list, search, query) that are 6,000+ characters of JSON and hold a list of two or more records.

- **Empty fields:** `null`, `""`, whitespace-only strings, `[]` and `{}`. `0` and `false` are kept.
- **System metadata:** keys starting with `$` or `@`, plus `_links`, `links`, `meta`, `metadata`, `etag`, `kind`, `self`, `href`, request and trace ids, and `api_version`. Paging values inside them (cursor, token, page, count) are kept.

Each trimmed result tells Claude how much was removed, and that a missing field means "empty", not "absent from the schema".

## What it never touches

- **Deluge code.** Any result that contains Deluge, or comes from a tool that deals in scripts, functions, workflows or custom APIs, is passed through whole.
- **Make blueprints.** Any blueprint or scenario tool, and any payload holding a `blueprint`, `flow` or `mapper`, is passed through whole.
- **Records being edited.** Single-record fetches are left whole, results of write tools are never trimmed, and any record a write call named earlier in the session comes back whole in later lists.

The protection is deliberately broad: one Deluge-looking string anywhere leaves the whole result untrimmed.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install lean-connector-results --marketplace creatorscripts/lean-connector-results
```

From a shell:

```
claude plugin install lean-connector-results --marketplace creatorscripts/lean-connector-results
```

In the Claude desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `creatorscripts/lean-connector-results`, then **Add plugin**.

## Tuning

The size threshold and the key lists are constants at the top of `hooks/lean.ts`. Run the tests with `claude plugin test .` after a change.

## About Creator Scripts

[Creator Scripts](https://creatorscripts.com) builds and maintains Zoho systems: Zoho Creator apps, CRM customisation, Deluge scripting, and integrations between Zoho, Make and AI tools like Claude. If your team is wiring Claude into Zoho and wants it done properly, [get in touch](https://creatorscripts.com).

## License

MIT
