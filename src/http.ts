import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type Upstreams } from "./server.js";
import { log } from "./log.js";

/** Constant-time comparison: hashing first makes both buffers equal length. */
export function keyMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function presentedKey(req: Request): string | undefined {
  const header = req.headers["x-api-key"];
  if (typeof header === "string" && header) return header;
  const auth = req.headers.authorization;
  const match = auth?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export interface HttpOptions {
  /** Required unless `allowNoAuth` is set. */
  apiKey?: string;
  /**
   * Explicit opt-in to serve without a key, for clients that only speak
   * OAuth or no-auth (e.g. ChatGPT). Tools are read-only over public data.
   */
  allowNoAuth?: boolean;
  host?: string;
  allowedHosts?: string[];
  upstreams?: Upstreams;
}

/**
 * Stateless Streamable HTTP endpoint at POST /mcp: a fresh server and
 * transport per request, so nothing is shared between clients.
 */
export function createHttpApp(options: HttpOptions) {
  const apiKey = options.apiKey;
  if (apiKey === undefined || apiKey === "") {
    if (!options.allowNoAuth) {
      throw new Error("MCP_API_KEY is required (or set MCP_AUTH=none to opt out explicitly).");
    }
  } else if (apiKey.length < 16) {
    throw new Error("MCP_API_KEY must be at least 16 characters.");
  }
  const app = createMcpExpressApp({ host: options.host, allowedHosts: options.allowedHosts });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  const requireKey = (req: Request, res: Response, next: NextFunction) => {
    if (!apiKey) return next();
    const key = presentedKey(req);
    if (key && keyMatches(key, apiKey)) return next();
    log("warn", "rejected request", { reason: key ? "bad key" : "no key", ip: req.ip });
    res
      .status(401)
      .set("WWW-Authenticate", 'Bearer realm="mcp"')
      .json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
  };

  app.post("/mcp", requireKey, async (req, res) => {
    const server = createServer(options.upstreams);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      log("error", "mcp request failed", { error: String(error) });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless server)." },
      id: null,
    });
  };
  app.get("/mcp", requireKey, notAllowed);
  app.delete("/mcp", requireKey, notAllowed);

  return app;
}
