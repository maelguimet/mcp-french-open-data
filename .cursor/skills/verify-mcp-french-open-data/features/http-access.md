# HTTP access

An operator runs the server with `npm run start:http`, or with Docker, and connects clients over Streamable HTTP. Requests need the API key unless `MCP_AUTH=none` is set explicitly. Every request and tool call is logged as JSON on stderr.

## Sub-features

- `http-auth-missing`: no key gives 401 with `WWW-Authenticate: Bearer`.
- `http-auth-wrong`: a wrong key gives 401.
- `http-auth-headers`: both `Authorization: Bearer <key>` and `x-api-key: <key>` are accepted.
- `http-health`: `GET /healthz` returns `{"ok":true}` without a key.
- `http-logs`: the logs record a `listening` line, `upstream request` lines with status and latency, `tool call` lines, and `rejected request` lines. They never contain the key.

## How to get to it (user POV)

- `MCP_API_KEY=$(openssl rand -hex 32) npm run start:http`, then add `http://127.0.0.1:3000/mcp` with the header to a client (see the README).

## Driving it with verify.ts

Preconditions:

- `dist/` is built, or let `verify.ts run` build it.

Steps:

- **Missing key.** `verify.ts run` posts `initialize` with no key. The step passes on a 401 whose body says `Unauthorized`.
- **Wrong key, then x-api-key.** The run expects 401 with `Bearer wrong-key-0123456789`, and 200 with `x-api-key: <key>`.
- **Logs.** The checks named `http: log …` pass on `http.stderr.log`.
- **Proof.** `http.stderr.log` and the PASS lines for `http: 401 without a key` and `http: log never contains the API key`.

## Gotchas

- The endpoint is stateless. `GET /mcp` returns 405, which is not an outage.
- The server refuses to start with a key under 16 characters, or with no key unless `MCP_AUTH=none` is set.
- When binding to `0.0.0.0`, set `ALLOWED_HOSTS`, or Host-header protection is off.
