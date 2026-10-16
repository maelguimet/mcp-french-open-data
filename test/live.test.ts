import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

/** Hits the real APIs. Skipped unless LIVE=1 (npm run test:live). */
describe.skipIf(!process.env.LIVE)("live smoke test", () => {
  it("calls every tool against the real APIs", async () => {
    const server = createServer();
    const client = new Client({ name: "live", version: "0.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    const calls: [string, Record<string, unknown>][] = [
      ["search_address", { query: "20 avenue de Ségur Paris", limit: 1 }],
      ["reverse_geocode", { lat: 48.8566, lon: 2.3522 }],
      ["search_company", { query: "la poste", per_page: 1 }],
      ["get_company", { siren: "356000000" }],
      ["list_communes", { postcode: "69001" }],
    ];
    for (const [name, args] of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).toBeFalsy();
    }
    await client.close();
  }, 30_000);
});
