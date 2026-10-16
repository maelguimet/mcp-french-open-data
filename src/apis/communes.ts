import { RateLimiter, Upstream, type UpstreamOptions } from "../upstream.js";

/** API Découpage administratif (geo.api.gouv.fr). Open, keyless. */
export function communesUpstream(overrides: Partial<UpstreamOptions> = {}): Upstream {
  return new Upstream({
    name: "API Découpage administratif",
    baseUrl: process.env.GEO_BASE_URL ?? "https://geo.api.gouv.fr/",
    limiter: new RateLimiter(50), // ≤ 20 req/s; polite default (no published limit found)
    ...overrides,
  });
}

interface RawCommune {
  nom: string;
  code: string;
  codesPostaux?: string[];
  codeDepartement?: string;
  codeRegion?: string;
  population?: number;
}

export interface Commune {
  name: string;
  insee_code: string;
  postcodes: string[];
  departement: string | null;
  region: string | null;
  population: number | null;
}

export async function listCommunes(
  api: Upstream,
  input: { name?: string; postcode?: string; departement?: string; limit: number },
): Promise<{ total: number; communes: Commune[] }> {
  const raw = await api.getJson<RawCommune[]>("communes", {
    nom: input.name,
    codePostal: input.postcode,
    codeDepartement: input.departement,
    fields: "nom,code,codesPostaux,codeDepartement,codeRegion,population",
    boost: input.name ? "population" : undefined,
  });
  return {
    total: raw.length,
    communes: raw.slice(0, input.limit).map((c) => ({
      name: c.nom,
      insee_code: c.code,
      postcodes: c.codesPostaux ?? [],
      departement: c.codeDepartement ?? null,
      region: c.codeRegion ?? null,
      population: c.population ?? null,
    })),
  };
}
