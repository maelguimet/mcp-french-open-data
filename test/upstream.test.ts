import { describe, expect, it } from "vitest";
import { RateLimiter, Upstream, UpstreamError } from "../src/upstream.js";
import { fakeFetch, json } from "./helpers.js";

const upstream = (respond: Parameters<typeof fakeFetch>[0], timeoutMs?: number) => {
  const fake = fakeFetch(respond);
  return {
    calls: fake.calls,
    api: new Upstream({
      name: "Test API",
      baseUrl: "https://example.test/base/",
      limiter: new RateLimiter(0),
      fetchImpl: fake.fetch,
      timeoutMs,
    }),
  };
};

const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(UpstreamError);
  return error as UpstreamError;
};

describe("Upstream", () => {
  it("encodes parameters and drops empty ones", async () => {
    const { api, calls } = upstream(() => json({ ok: true }));
    await api.getJson("search", { q: "8 bd du port", limit: 3, postcode: undefined, type: "" });
    expect(calls[0]!.toString()).toBe("https://example.test/base/search?q=8+bd+du+port&limit=3");
  });

  it.each([
    [429, { "retry-after": "5" }, "Test API rate limit reached; retry after 5 s."],
    [400, {}, "Test API rejected the request parameters (HTTP 400)."],
    [404, {}, "Test API: not found."],
    [503, {}, "Test API is unavailable right now (HTTP 503)."],
    [418, {}, "Test API returned HTTP 418."],
  ])("maps HTTP %i to a readable error", async (status, headers, message) => {
    const { api } = upstream(() => json({ detail: "x" }, status, headers));
    const error = await failure(api.getJson("x", {}));
    expect(error.message).toBe(message);
    expect(error.status).toBe(status);
  });

  it("reports a timeout", async () => {
    const { api } = upstream(
      () =>
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new DOMException("timed out", "TimeoutError")), 5),
        ),
      1,
    );
    expect((await failure(api.getJson("x", {}))).message).toBe(
      "Test API did not answer in time. Try again shortly.",
    );
  });

  it("aborts a hanging request after the timeout", async () => {
    const hanging = new Upstream({
      name: "Test API",
      baseUrl: "https://example.test/",
      limiter: new RateLimiter(0),
      timeoutMs: 20,
      fetchImpl: ((_: unknown, init?: RequestInit) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
        )) as typeof fetch,
    });
    expect((await failure(hanging.getJson("x", {}))).message).toContain("did not answer in time");
  });

  it("reports network failures and invalid JSON", async () => {
    const down = upstream(() => Promise.reject(new TypeError("fetch failed")));
    expect((await failure(down.api.getJson("x", {}))).message).toBe("Could not reach Test API.");
    const garbled = upstream(() => new Response("<html>", { status: 200 }));
    expect((await failure(garbled.api.getJson("x", {}))).message).toContain("not valid JSON");
  });
});

describe("RateLimiter", () => {
  it("spaces consecutive calls by the minimum interval", async () => {
    const limiter = new RateLimiter(40);
    const started = Date.now();
    await Promise.all([limiter.wait(), limiter.wait(), limiter.wait()]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(75);
  });
});
