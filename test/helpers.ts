import { readFileSync } from "node:fs";
import { RateLimiter } from "../src/upstream.js";
import { communesUpstream } from "../src/apis/communes.js";
import { entreprisesUpstream } from "../src/apis/entreprises.js";
import { geocodingUpstream } from "../src/apis/geocoding.js";
import type { Upstreams } from "../src/server.js";

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
}

export interface FakeFetch {
  fetch: typeof fetch;
  calls: URL[];
}

/** A fetch that records URLs and answers with `respond`. No network. */
export function fakeFetch(respond: (url: URL) => Response | Promise<Response>): FakeFetch {
  const calls: URL[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push(url);
    return respond(url);
  }) as typeof fetch;
  return { fetch: impl, calls };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/** Routes each upstream host to a fixture; unknown paths 404. */
export function fixtureUpstreams(): { upstreams: Upstreams; calls: URL[] } {
  const fake = fakeFetch((url) => {
    if (url.hostname === "data.geopf.fr") {
      return json(fixture(url.pathname.endsWith("/reverse") ? "reverse" : "search"));
    }
    if (url.hostname === "recherche-entreprises.api.gouv.fr") return json(fixture("company"));
    if (url.hostname === "geo.api.gouv.fr") return json(fixture("communes"));
    return json({}, 404);
  });
  const common = { fetchImpl: fake.fetch, limiter: new RateLimiter(0) };
  return {
    calls: fake.calls,
    upstreams: {
      geocoding: geocodingUpstream(common),
      entreprises: entreprisesUpstream(common),
      communes: communesUpstream(common),
    },
  };
}
