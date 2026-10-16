import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type Upstreams } from "../src/server.js";
import { entreprisesUpstream } from "../src/apis/entreprises.js";
import { RateLimiter } from "../src/upstream.js";
import { fakeFetch, fixtureUpstreams, json } from "./helpers.js";

async function connect(upstreams: Upstreams) {
  const server = createServer(upstreams);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, server };
}

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[])[0]!.text;

describe("MCP protocol (in-memory transport)", () => {
  let session: Awaited<ReturnType<typeof connect>>;
  let calls: URL[];

  beforeEach(async () => {
    const fixtures = fixtureUpstreams();
    calls = fixtures.calls;
    session = await connect(fixtures.upstreams);
  });
  afterEach(async () => {
    await session.client.close();
  });

  it("lists five read-only tools with input schemas", async () => {
    const { tools } = await session.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_company",
      "list_communes",
      "reverse_geocode",
      "search_address",
      "search_company",
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.description!.length).toBeGreaterThan(60);
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("calls search_address end to end with defaults applied", async () => {
    const result = await session.client.callTool({
      name: "search_address",
      arguments: { query: "8 bd du port cergy" },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))[0].label).toBe("8 Boulevard du Port 95000 Cergy");
    expect(calls[0]!.searchParams.get("limit")).toBe("5");
  });

  it("calls get_company end to end", async () => {
    const result = await session.client.callTool({
      name: "get_company",
      arguments: { siren: "356000000" },
    });
    expect(JSON.parse(text(result)).name).toBe("LA POSTE");
  });

  it("rejects invalid input before any upstream call", async () => {
    const result = await session.client.callTool({
      name: "get_company",
      arguments: { siren: "12" },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("9-digit SIREN");
    expect(calls).toHaveLength(0);
  });

  it("requires a filter for list_communes", async () => {
    const result = await session.client.callTool({ name: "list_communes", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("at least one of");
  });
});

it("surfaces upstream failures as tool errors, not protocol errors", async () => {
  const fixtures = fixtureUpstreams();
  const down = fakeFetch(() => json({ message: "maintenance" }, 503));
  const { client } = await connect({
    ...fixtures.upstreams,
    entreprises: entreprisesUpstream({ fetchImpl: down.fetch, limiter: new RateLimiter(0) }),
  });
  const result = await client.callTool({ name: "search_company", arguments: { query: "la poste" } });
  expect(result.isError).toBe(true);
  expect(text(result)).toBe("Recherche d'entreprises is unavailable right now (HTTP 503).");
  await client.close();
});
