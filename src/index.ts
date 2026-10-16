#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHttpApp } from "./http.js";
import { createServer, VERSION } from "./server.js";
import { log } from "./log.js";

async function main(): Promise<void> {
  const mode = process.argv.includes("--http") ? "http" : (process.env.MCP_TRANSPORT ?? "stdio");

  if (mode === "stdio") {
    await createServer().connect(new StdioServerTransport());
    log("info", "listening", { transport: "stdio", version: VERSION });
    return;
  }
  if (mode !== "http") throw new Error(`Unknown MCP_TRANSPORT "${mode}" (use stdio or http).`);

  const apiKey = process.env.MCP_API_KEY;
  const allowNoAuth = process.env.MCP_AUTH === "none";
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 3000);
  const allowedHosts = process.env.ALLOWED_HOSTS?.split(",").map((h) => h.trim());
  const app = createHttpApp({ apiKey, allowNoAuth, host, allowedHosts });
  app.listen(port, host, () => {
    const auth = apiKey ? "api-key" : "none";
    log("info", "listening", { transport: "http", host, port, path: "/mcp", auth, version: VERSION });
    if (!apiKey) log("warn", "HTTP transport is running without authentication (MCP_AUTH=none)");
  });
}

main().catch((error: unknown) => {
  log("error", "fatal", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
