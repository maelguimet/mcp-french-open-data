import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpApp, keyMatches } from "../src/http.js";
import { fixtureUpstreams } from "./helpers.js";

const KEY = "test-key-0123456789abcdef";
let server: Server;
let base: string;

beforeAll(async () => {
  const app = createHttpApp({ apiKey: KEY, upstreams: fixtureUpstreams().upstreams });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const initialize = (headers: Record<string, string>) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    }),
  });

describe("Streamable HTTP transport", () => {
  it("rejects requests without a key or with a wrong key", async () => {
    const missing = await initialize({});
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("Bearer");
    expect((await initialize({ authorization: "Bearer nope" })).status).toBe(401);
    expect((await initialize({ "x-api-key": `${KEY}x` })).status).toBe(401);
  });

  it("accepts the key as x-api-key", async () => {
    expect((await initialize({ "x-api-key": KEY })).status).toBe(200);
  });

  it("serves tools to the SDK client with a bearer token", async () => {
    const client = new Client({ name: "http-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${KEY}` } },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    const result = await client.callTool({ name: "list_communes", arguments: { name: "Lyon", limit: 1 } });
    const body = JSON.parse((result.content as { text: string }[])[0]!.text);
    expect(body.communes[0].insee_code).toBe("69123");
    await client.close();
  });

  it("answers GET /mcp with 405 and exposes an unauthenticated health check", async () => {
    const get = await fetch(`${base}/mcp`, { headers: { "x-api-key": KEY } });
    expect(get.status).toBe(405);
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ ok: true });
  });

  it("refuses short or missing API keys at startup", () => {
    expect(() => createHttpApp({ apiKey: "short" })).toThrow(/at least 16/);
    expect(() => createHttpApp({})).toThrow(/MCP_AUTH=none/);
  });
});

describe("keyMatches", () => {
  it("compares keys of any length without throwing", () => {
    expect(keyMatches(KEY, KEY)).toBe(true);
    expect(keyMatches("a", KEY)).toBe(false);
    expect(keyMatches("", KEY)).toBe(false);
  });
});

describe("explicit no-auth mode", () => {
  it("serves without a key only when allowNoAuth is set", async () => {
    const app = createHttpApp({ allowNoAuth: true, upstreams: fixtureUpstreams().upstreams });
    const open = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const url = `http://127.0.0.1:${(open.address() as AddressInfo).port}/mcp`;
    const client = new Client({ name: "noauth", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    expect((await client.listTools()).tools).toHaveLength(5);
    await client.close();
    await new Promise<void>((resolve) => open.close(() => resolve()));
  });
});
