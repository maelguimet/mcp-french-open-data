/**
 * Demo client: connects to the built server over stdio (default) or
 * Streamable HTTP (`--http <url>`, key from MCP_API_KEY), lists the tools and
 * calls each one against the live APIs. Output is printed as-is.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const httpIndex = process.argv.indexOf("--http");
const httpUrl = httpIndex >= 0 ? process.argv[httpIndex + 1] : undefined;

const transport = httpUrl
  ? new StreamableHTTPClientTransport(new URL(httpUrl), {
      requestInit: { headers: { authorization: `Bearer ${process.env.MCP_API_KEY ?? ""}` } },
    })
  : new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: { ...process.env, LOG_LEVEL: "warn" } as Record<string, string>,
    });

const client = new Client({ name: "demo", version: "0.1.0" });
await client.connect(transport);
console.log(`connected over ${httpUrl ? `Streamable HTTP (${httpUrl})` : "stdio"}`);

const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(", ")}\n`);

const calls: [string, Record<string, unknown>][] = [
  ["search_address", { query: "20 avenue de Ségur Paris", limit: 1 }],
  ["reverse_geocode", { lat: 45.7578, lon: 4.832 }],
  ["search_company", { query: "airbus", departement: "31", per_page: 2 }],
  ["get_company", { siren: "356000000" }],
  ["list_communes", { name: "Lyon", limit: 2 }],
  ["get_company", { siren: "12" }],
];
for (const [name, args] of calls) {
  console.log(`> ${name} ${JSON.stringify(args)}`);
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
  const lines = text.split("\n");
  const max = Number(process.env.DEMO_LINES ?? 24);
  console.log((result.isError ? "[isError] " : "") + lines.slice(0, max).join("\n"));
  if (lines.length > max) console.log(`  … (${lines.length - max} more lines)`);
  console.log();
  // Optional pause so a terminal recording stays readable.
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.DEMO_PAUSE_MS ?? 0)));
}
await client.close();
