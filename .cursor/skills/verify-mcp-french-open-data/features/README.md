# mcp-french-open-data verification map

This directory is the maintained source for verifying the user-facing behaviour of the MCP server. Read this index before driving the server, then use the matching feature file as the recipe.

## Baseline preconditions

- Install dependencies with `npm ci`. `npx tsx .cursor/skills/verify-mcp-french-open-data/verify.ts doctor` passes.
- The network reaches data.geopf.fr, recherche-entreprises.api.gouv.fr and geo.api.gouv.fr.
- Drive only servers started by `verify.ts run` (or by your own `npm run demo` / `npm run start:http`), never someone else's deployment.

## Driving conventions

- Every feature is reached through an MCP client calling a tool over stdio and over Streamable HTTP. `verify.ts run` does both.
- Tool names and argument keys are literal. Outputs are JSON text in `content[0].text`.
- Over HTTP, the client sends `Authorization: Bearer <MCP_API_KEY>`.

## Proof and skip reporting

- Proof is the transcript line for the call, the PASS line for its check, and the matching `tool call` entry in the server log.
- Report an upstream outage as a failure with the doctor output. Don't report it as verified through another path.

## Feature entry contract

Each feature file has an H1, one paragraph, then `Sub-features`, `How to get to it (user POV)`, `Driving it with verify.ts`, and `Gotchas`.

## Features

- [Addresses](./addresses.md): `search_address` and `reverse_geocode`.
- [Companies](./companies.md): `search_company` and `get_company`.
- [Communes](./communes.md): `list_communes`.
- [HTTP access](./http-access.md): API-key auth, health check and logs.
