import { RateLimiter, Upstream, type UpstreamOptions } from "../upstream.js";

/**
 * IGN Géoplateforme geocoding service, the successor of the BAN
 * api-adresse.data.gouv.fr API. Open, keyless, 50 requests/s per IP.
 */
export function geocodingUpstream(overrides: Partial<UpstreamOptions> = {}): Upstream {
  return new Upstream({
    name: "Géoplateforme geocoding",
    baseUrl: process.env.GEOCODING_BASE_URL ?? "https://data.geopf.fr/geocodage/",
    limiter: new RateLimiter(25), // ≤ 40 req/s, under the 50 req/s limit
    ...overrides,
  });
}

interface Feature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, unknown>;
}
interface FeatureCollection {
  features: Feature[];
}

export interface Address {
  label: string;
  type: unknown;
  score: number | undefined;
  housenumber: unknown;
  street: unknown;
  postcode: unknown;
  city: unknown;
  citycode: unknown;
  context: unknown;
  lat: number;
  lon: number;
  distance_m?: unknown;
}

function toAddress(feature: Feature): Address {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;
  const address: Address = {
    label: String(p.label ?? ""),
    type: p.type,
    score: typeof p.score === "number" ? Math.round(p.score * 1000) / 1000 : undefined,
    housenumber: p.housenumber,
    street: p.street,
    postcode: p.postcode,
    city: p.city,
    citycode: p.citycode,
    context: p.context,
    lat,
    lon,
  };
  if (p.distance !== undefined) address.distance_m = p.distance;
  return address;
}

export async function searchAddress(
  api: Upstream,
  input: { query: string; limit: number; postcode?: string; citycode?: string; type?: string },
): Promise<Address[]> {
  const data = await api.getJson<FeatureCollection>("search", {
    q: input.query,
    index: "address",
    limit: input.limit,
    postcode: input.postcode,
    citycode: input.citycode,
    type: input.type,
  });
  return data.features.map(toAddress);
}

export async function reverseGeocode(
  api: Upstream,
  input: { lat: number; lon: number; limit: number },
): Promise<Address[]> {
  const data = await api.getJson<FeatureCollection>("reverse", {
    lat: input.lat,
    lon: input.lon,
    index: "address",
    limit: input.limit,
  });
  return data.features.map(toAddress);
}
