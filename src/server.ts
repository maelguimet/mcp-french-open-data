import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { entreprisesUpstream, getCompany, searchCompany } from "./apis/entreprises.js";
import { geocodingUpstream, reverseGeocode, searchAddress } from "./apis/geocoding.js";
import { communesUpstream, listCommunes } from "./apis/communes.js";
import { log } from "./log.js";
import { UpstreamError, type Upstream } from "./upstream.js";

export const VERSION = "0.1.0";

export interface Upstreams {
  geocoding: Upstream;
  entreprises: Upstream;
  communes: Upstream;
}

export function defaultUpstreams(): Upstreams {
  return {
    geocoding: geocodingUpstream(),
    entreprises: entreprisesUpstream(),
    communes: communesUpstream(),
  };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(tool: string, work: () => Promise<unknown>): Promise<ToolResult> {
  const started = Date.now();
  try {
    const result = await work();
    log("info", "tool call", { tool, ok: true, ms: Date.now() - started });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const message =
      error instanceof UpstreamError ? error.message : "Unexpected error while calling the API.";
    log(error instanceof UpstreamError ? "warn" : "error", "tool call", {
      tool,
      ok: false,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

const postcode = z
  .string()
  .regex(/^\d{5}$/, "a 5-digit French postcode")
  .describe("5-digit French postcode, e.g. 75011");
const inseeCode = z
  .string()
  .regex(/^(\d{5}|2[AB]\d{3})$/, "a 5-character INSEE commune code")
  .describe("INSEE commune code (not the postcode), e.g. 75111");
const departement = z
  .string()
  .regex(/^(\d{2,3}|2[AB])$/, "a département code")
  .describe("Département code, e.g. 69, 2A or 974");

/** Builds a server with the five read-only tools. One instance per session. */
export function createServer(upstreams: Upstreams = defaultUpstreams()): McpServer {
  const server = new McpServer({ name: "mcp-french-open-data", version: VERSION });

  server.registerTool(
    "search_address",
    {
      title: "Search French addresses",
      description:
        "Geocode a free-text French address with the national address base (BAN, via the IGN " +
        "Géoplateforme). Returns ranked matches with label, postcode, city, INSEE code, " +
        "relevance score (0-1) and WGS84 coordinates. Use this to normalise or locate an address.",
      inputSchema: {
        query: z.string().trim().min(3).max(200).describe("Address text, e.g. '8 bd du port cergy'"),
        limit: z.number().int().min(1).max(20).default(5).describe("Maximum results (1-20)"),
        postcode: postcode.optional(),
        citycode: inseeCode.optional(),
        type: z
          .enum(["housenumber", "street", "locality", "municipality"])
          .optional()
          .describe("Restrict to one result type"),
      },
      annotations: READ_ONLY,
    },
    (input) => run("search_address", () => searchAddress(upstreams.geocoding, input)),
  );

  server.registerTool(
    "reverse_geocode",
    {
      title: "Reverse geocode a point",
      description:
        "Find the nearest French addresses to a latitude/longitude (WGS84). Returns addresses " +
        "with their distance in metres. Coverage: France including overseas départements.",
      inputSchema: {
        lat: z.number().min(-90).max(90).describe("Latitude, e.g. 48.8566"),
        lon: z.number().min(-180).max(180).describe("Longitude, e.g. 2.3522"),
        limit: z.number().int().min(1).max(10).default(1).describe("Maximum results (1-10)"),
      },
      annotations: READ_ONLY,
    },
    (input) => run("reverse_geocode", () => reverseGeocode(upstreams.geocoding, input)),
  );

  server.registerTool(
    "search_company",
    {
      title: "Search French companies",
      description:
        "Search the French company register (SIRENE/RNE via API Recherche d'entreprises) by " +
        "name, address, leader name or SIREN/SIRET. Returns SIREN, name, status, NAF activity " +
        "code, head office and establishment counts. Follow up with get_company for details.",
      inputSchema: {
        query: z.string().trim().min(3).max(200).describe("Name, address, leader, SIREN or SIRET"),
        postcode: postcode.optional(),
        departement: departement.optional(),
        naf: z
          .string()
          .regex(/^\d{2}\.\d{2}[A-Z]$/, "a NAF code like 62.01Z")
          .optional()
          .describe("NAF/APE activity code, e.g. 62.01Z"),
        active_only: z.boolean().default(true).describe("Exclude closed companies"),
        page: z.number().int().min(1).max(100).default(1),
        per_page: z.number().int().min(1).max(25).default(10),
      },
      annotations: READ_ONLY,
    },
    (input) => run("search_company", () => searchCompany(upstreams.entreprises, input)),
  );

  server.registerTool(
    "get_company",
    {
      title: "Get a company by SIREN",
      description:
        "Fetch one French company by its 9-digit SIREN: legal form, VAT number, creation and " +
        "closure dates, head office, leaders and published yearly revenue/net income.",
      inputSchema: {
        siren: z
          .string()
          .regex(/^\d{9}$/, "a 9-digit SIREN")
          .describe("9-digit SIREN, e.g. 356000000"),
      },
      annotations: READ_ONLY,
    },
    ({ siren }) => run("get_company", () => getCompany(upstreams.entreprises, siren)),
  );

  server.registerTool(
    "list_communes",
    {
      title: "List French communes",
      description:
        "Look up French communes by name, postcode or département (geo.api.gouv.fr). Returns " +
        "INSEE code, postcodes, département, région and population. Give at least one filter.",
      inputSchema: {
        name: z.string().trim().min(2).max(100).optional().describe("Commune name, e.g. 'Lyon'"),
        postcode: postcode.optional(),
        departement: departement.optional(),
        limit: z.number().int().min(1).max(50).default(10).describe("Maximum results (1-50)"),
      },
      annotations: READ_ONLY,
    },
    (input) =>
      run("list_communes", async () => {
        if (!input.name && !input.postcode && !input.departement) {
          throw new UpstreamError("Give at least one of name, postcode or departement.");
        }
        return listCommunes(upstreams.communes, input);
      }),
  );

  return server;
}
