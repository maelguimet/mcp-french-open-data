import { log } from "./log.js";

/** An upstream failure, already phrased for the model/user. */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/**
 * Spaces requests to one host at least `minIntervalMs` apart, staying
 * politely under each API's published per-IP limit.
 */
export class RateLimiter {
  private next = 0;
  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.minIntervalMs;
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
  }
}

export interface UpstreamOptions {
  name: string;
  baseUrl: string;
  limiter: RateLimiter;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const USER_AGENT = "mcp-french-open-data (+https://github.com/maelguimet/mcp-french-open-data)";

export class Upstream {
  constructor(private readonly opts: UpstreamOptions) {}

  async getJson<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(path, this.opts.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    await this.opts.limiter.wait();
    const started = Date.now();
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      log("warn", "upstream request failed", { api: this.opts.name, path, timedOut });
      throw new UpstreamError(
        timedOut
          ? `${this.opts.name} did not answer in time. Try again shortly.`
          : `Could not reach ${this.opts.name}.`,
      );
    }
    log("info", "upstream request", {
      api: this.opts.name,
      path,
      status: response.status,
      ms: Date.now() - started,
    });
    if (!response.ok) throw mapStatus(this.opts.name, response);
    try {
      return (await response.json()) as T;
    } catch {
      throw new UpstreamError(`${this.opts.name} returned a response that is not valid JSON.`);
    }
  }
}

function mapStatus(name: string, response: Response): UpstreamError {
  const status = response.status;
  if (status === 429) {
    const retry = response.headers.get("retry-after");
    return new UpstreamError(
      `${name} rate limit reached${retry ? `; retry after ${retry} s` : ""}.`,
      status,
    );
  }
  if (status === 400 || status === 422) {
    return new UpstreamError(`${name} rejected the request parameters (HTTP ${status}).`, status);
  }
  if (status === 404) return new UpstreamError(`${name}: not found.`, status);
  if (status >= 500) {
    return new UpstreamError(`${name} is unavailable right now (HTTP ${status}).`, status);
  }
  return new UpstreamError(`${name} returned HTTP ${status}.`, status);
}
