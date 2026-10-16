import { RateLimiter, Upstream, UpstreamError, type UpstreamOptions } from "../upstream.js";

/**
 * API Recherche d'entreprises (SIRENE + RNE). Open, keyless,
 * at most 7 requests/s per IP.
 */
export function entreprisesUpstream(overrides: Partial<UpstreamOptions> = {}): Upstream {
  return new Upstream({
    name: "Recherche d'entreprises",
    baseUrl: process.env.ENTREPRISES_BASE_URL ?? "https://recherche-entreprises.api.gouv.fr/",
    limiter: new RateLimiter(200), // 5 req/s, under the 7 req/s limit
    ...overrides,
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any -- upstream JSON */
interface SearchResponse {
  results: any[];
  total_results: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface CompanySummary {
  siren: string;
  name: string;
  acronym: string | null;
  status: "active" | "closed";
  naf: string | null;
  created: string | null;
  category: string | null;
  headcount_band: string | null;
  head_office: {
    siret: string | null;
    address: string | null;
    postcode: string | null;
    city: string | null;
    lat: number | null;
    lon: number | null;
  };
  establishments: { total: number; open: number };
}

export interface CompanyDetails extends CompanySummary {
  legal_form_code: string | null;
  vat_number: string | null;
  closed: string | null;
  leaders: { name: string; role: string | null; kind: string }[];
  finances: Record<string, { revenue: number | null; net_income: number | null }> | null;
}

const num = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};

function summary(r: any): CompanySummary {
  const siege = r.siege ?? {};
  return {
    siren: r.siren,
    name: r.nom_complet ?? r.nom_raison_sociale,
    acronym: r.sigle ?? null,
    status: r.etat_administratif === "A" ? "active" : "closed",
    naf: r.activite_principale ?? null,
    created: r.date_creation ?? null,
    category: r.categorie_entreprise ?? null,
    headcount_band: r.tranche_effectif_salarie ?? null,
    head_office: {
      siret: siege.siret ?? null,
      address: siege.adresse ?? siege.geo_adresse ?? null,
      postcode: siege.code_postal ?? null,
      city: siege.libelle_commune ?? null,
      lat: num(siege.latitude),
      lon: num(siege.longitude),
    },
    establishments: {
      total: r.nombre_etablissements ?? 0,
      open: r.nombre_etablissements_ouverts ?? 0,
    },
  };
}

function details(r: any): CompanyDetails {
  const leaders = (r.dirigeants ?? []).map((d: any) =>
    d.type_dirigeant === "personne morale"
      ? { name: d.denomination ?? "", role: d.qualite ?? null, kind: "company" }
      : {
          name: [d.prenoms, d.nom].filter(Boolean).join(" "),
          role: d.qualite ?? null,
          kind: "person",
        },
  );
  const finances = r.finances
    ? Object.fromEntries(
        Object.entries(r.finances as Record<string, any>).map(([year, f]) => [
          year,
          { revenue: num(f?.ca), net_income: num(f?.resultat_net) },
        ]),
      )
    : null;
  return {
    ...summary(r),
    legal_form_code: r.nature_juridique ?? null,
    vat_number: (Array.isArray(r.tva) ? r.tva[0] : r.tva) ?? null,
    closed: r.date_fermeture ?? null,
    leaders,
    finances,
  };
}

export async function searchCompany(
  api: Upstream,
  input: {
    query: string;
    postcode?: string;
    departement?: string;
    naf?: string;
    active_only: boolean;
    page: number;
    per_page: number;
  },
): Promise<{ total: number; page: number; total_pages: number; results: CompanySummary[] }> {
  const data = await api.getJson<SearchResponse>("search", {
    q: input.query,
    code_postal: input.postcode,
    departement: input.departement,
    activite_principale: input.naf,
    etat_administratif: input.active_only ? "A" : undefined,
    page: input.page,
    per_page: input.per_page,
  });
  return {
    total: data.total_results,
    page: data.page,
    total_pages: data.total_pages,
    results: data.results.map(summary),
  };
}

export async function getCompany(api: Upstream, siren: string): Promise<CompanyDetails> {
  const data = await api.getJson<SearchResponse>("search", { q: siren, per_page: 1 });
  const match = data.results.find((r) => r.siren === siren);
  if (!match) throw new UpstreamError(`No company with SIREN ${siren} (or it is not public).`, 404);
  return details(match);
}
