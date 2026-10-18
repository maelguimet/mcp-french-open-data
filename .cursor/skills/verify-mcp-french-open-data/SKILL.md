---
name: verify-mcp-french-open-data
description: "Verify mcp-french-open-data end to end: build it, start the MCP server over stdio and Streamable HTTP, call every tool against the live French open-data APIs (address search, reverse geocoding, SIRENE company search and lookup, communes), and check the outputs, the 401 without an API key, and the JSON logs. Use after changing tools, transports, auth, logging or upstream handling, or before a release."
---

# Verify mcp-french-open-data

The product surface is an MCP server. Users reach it through an MCP client (Claude Desktop, Cursor, ChatGPT), either by launching it over **stdio** or by connecting to its **Streamable HTTP** endpoint `POST /mcp`, which needs an API key. This skill drives both the way a client does: it uses the official SDK client, real child processes and the live upstream APIs. It doesn't import server internals and doesn't mock anything.

Everything runs from the repository root. The helper is `.cursor/skills/verify-mcp-french-open-data/verify.ts`, and it runs with `npx tsx`.

## Launch

1. Install dependencies once: `npm ci`.
2. Run `npx tsx .cursor/skills/verify-mcp-french-open-data/verify.ts run`.
   - It runs `npm run build`. Add `--skip-build` to reuse `dist/`; the run then stops if any file in `src/`, `tsconfig.json` or `package.json` is newer than `dist/index.js`.
   - **stdio:** it spawns `node dist/index.js` through `StdioClientTransport`. The server is ready when `initialize` returns the package name and version from `package.json`.
   - **HTTP:** it spawns `node dist/index.js --http` on a free port on 127.0.0.1, with a fresh random `MCP_API_KEY`. The server is ready when its stderr has a `listening` line reporting transport `http`, host `127.0.0.1`, the chosen port, path `/mcp`, auth `api-key` and the package version; `GET /healthz` must then return 200.
3. Teardown is automatic: the stdio client closes its child, and the script sends SIGTERM to the HTTP server it spawned and waits for it to exit.

Each run has its own port, key and evidence directory, so several runs can go side by side. The only shared resource is the upstream APIs' per-IP rate limits (Recherche d'entreprises allows 7 req/s), so don't run many at once.

## Doctor

Run `npx tsx .cursor/skills/verify-mcp-french-open-data/verify.ts doctor`. It is read-only and checks:
- Node ≥ 20;
- the dependencies are installed;
- `dist/index.js` exists and is newer than every file in `src/`, `tsconfig.json` and `package.json`;
- the version in `package.json` matches `package-lock.json` and `VERSION` in `src/server.ts`;
- each upstream API answers (data.geopf.fr, recherche-entreprises.api.gouv.fr, geo.api.gouv.fr).

Run it first whenever a `run` fails. If an upstream check fails, the problem is the network or the API, not the server.

## Drive

`run` performs these journeys over each transport. `features/` describes each one from the user's side.

| Journey | Tool call | Sanity check |
|---|---|---|
| Address search | `search_address {"query":"20 avenue de Ségur Paris","limit":1}` | postcode `75007`, label contains `Ségur`, lat 48.8–48.9, lon 2.25–2.4 |
| Reverse geocode | `reverse_geocode {"lat":45.7578,"lon":4.832}` | city `Lyon`, `distance_m` < 1000 |
| Company search | `search_company {"query":"la poste","per_page":5}` | total > 0, 1 to 5 results, every SIREN has 9 digits, every result has exactly the summary fields, at least one name contains "poste" |
| Company lookup | `get_company {"siren":"356000000"}` | exactly the documented fields, at least one leader, each with a non-empty `name` and only `name`, `role`, `kind` (so no birth dates), name contains "poste", VAT `FR39356000000` computed from the SIREN, head-office SIRET starts with the SIREN |
| Communes | `list_communes {"postcode":"69001"}` | Lyon `69123`, population > 400,000 |
| Invalid input | `get_company {"siren":"12"}` | `isError` with "9-digit SIREN" |

HTTP only:
- `POST /mcp` without a key → 401 `Unauthorized`;
- a wrong bearer key → 401;
- `x-api-key` → 200;
- the journeys above, over a bearer-token client.

Logs, for both transports:
- stderr is pure JSON lines;
- there is one successful `tool call` entry for each of the 5 tools;
- there are `upstream request` entries with status 200.

HTTP logs only:
- `rejected request` entries with reasons `no key` and `bad key`;
- the API key never appears.

To drive a single tool by hand, run `npm run demo` (stdio) or `MCP_API_KEY=… npm run demo -- --http http://127.0.0.1:3000/mcp`.

## Evidence

The default evidence directory is `artifacts/verify/<UTC timestamp>/`, which is gitignored. Override it with `--out DIR`; `--out` without a directory, or any unknown argument, exits with code 2. It holds:
- `transcript.txt`: every tool call, its first 12 output lines, and PASS/FAIL per check;
- `results.json`: `{ ok, checks: [{ name, ok, detail }] }`;
- `stdio.stderr.log` and `http.stderr.log`: the servers' own logs.

Exit code 0 means every check passed. Proof standard:
- quote the `N/N checks passed` line, plus the PASS lines for the feature you changed;
- for a new tool, add a journey here and a file under `features/`;
- a run that fails on upstream data drift is a real failure. Update the expectation only after checking the live API by hand, and never loosen the check just to get a pass.

## Cleanup

The script tears down only the processes it started. It never kills by name. The evidence directory stays. To remove old evidence, run `rm -rf artifacts/verify/<run>`. If a run is interrupted (Ctrl-C), the HTTP child can outlive it. Find it with `pgrep -af "dist/index.js --http"` and kill only the PID that `http: ready` printed.

## Helpers

- `verify.ts run [--skip-build] [--out DIR]`: the full journey across both transports.
- `verify.ts doctor`: the read-only health check.

Keep `features/` up to date as tools change; `/maintain-verification-skill` describes that loop.
