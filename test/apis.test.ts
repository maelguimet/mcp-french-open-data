import { describe, expect, it } from "vitest";
import { reverseGeocode, searchAddress } from "../src/apis/geocoding.js";
import { getCompany, searchCompany } from "../src/apis/entreprises.js";
import { listCommunes } from "../src/apis/communes.js";
import { UpstreamError } from "../src/upstream.js";
import { fixtureUpstreams } from "./helpers.js";

describe("geocoding", () => {
  it("maps search features and sends the address index", async () => {
    const { upstreams, calls } = fixtureUpstreams();
    const [first] = await searchAddress(upstreams.geocoding, {
      query: "8 bd du port cergy",
      limit: 2,
      postcode: "95000",
    });
    expect(first).toMatchObject({
      label: "8 Boulevard du Port 95000 Cergy",
      postcode: "95000",
      citycode: "95127",
      lat: 49.031624,
      lon: 2.062821,
    });
    expect(calls[0]!.searchParams.get("index")).toBe("address");
    expect(calls[0]!.searchParams.get("postcode")).toBe("95000");
  });

  it("maps reverse geocoding with distance", async () => {
    const { upstreams, calls } = fixtureUpstreams();
    const [first] = await reverseGeocode(upstreams.geocoding, { lat: 48.8566, lon: 2.3522, limit: 1 });
    expect(first!.city).toBe("Paris");
    expect(first).toHaveProperty("distance_m");
    expect(calls[0]!.pathname).toBe("/geocodage/reverse");
  });
});

describe("entreprises", () => {
  it("summarises search results and passes filters", async () => {
    const { upstreams, calls } = fixtureUpstreams();
    const result = await searchCompany(upstreams.entreprises, {
      query: "la poste",
      departement: "75",
      active_only: true,
      page: 1,
      per_page: 1,
    });
    expect(result.results[0]).toMatchObject({ siren: "356000000", name: "LA POSTE", status: "active" });
    expect(calls[0]!.searchParams.get("etat_administratif")).toBe("A");
    expect(calls[0]!.searchParams.get("departement")).toBe("75");
  });

  it("returns details without leaders' birth dates", async () => {
    const { upstreams } = fixtureUpstreams();
    const company = await getCompany(upstreams.entreprises, "356000000");
    expect(company.vat_number).toBe("FR39356000000");
    expect(company.finances?.["2025"]).toEqual({ revenue: 26700000000, net_income: 1474000000 });
    expect(company.leaders.length).toBeGreaterThan(0);
    expect(JSON.stringify(company)).not.toContain("date_de_naissance");
  });

  it("refuses a SIREN that the search did not return exactly", async () => {
    const { upstreams } = fixtureUpstreams();
    await expect(getCompany(upstreams.entreprises, "123456789")).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("communes", () => {
  it("maps and limits communes", async () => {
    const { upstreams, calls } = fixtureUpstreams();
    const result = await listCommunes(upstreams.communes, { name: "Lyon", limit: 1 });
    expect(result.communes).toHaveLength(1);
    expect(result.communes[0]).toMatchObject({ name: "Lyon", insee_code: "69123", departement: "69" });
    expect(calls[0]!.searchParams.get("boost")).toBe("population");
  });
});
