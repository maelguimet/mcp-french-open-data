# Demo

![Demo](demo.gif)

Everything below is real, unedited output, recorded on 2026-10-16 against the live
APIs with [`scripts/demo.ts`](../scripts/demo.ts), a small client built on the
official MCP SDK. The last call is an intentionally invalid SIREN to show input
validation.

## stdio

```console
$ npm run build && npm run demo
connected over stdio
tools: search_address, reverse_geocode, search_company, get_company, list_communes

> search_address {"query":"20 avenue de Ségur Paris","limit":1}
[
  {
    "label": "20 Avenue de Ségur 75007 Paris",
    "type": "housenumber",
    "score": 0.972,
    "housenumber": "20",
    "street": "Avenue de Ségur",
    "postcode": "75007",
    "city": "Paris",
    "citycode": "75107",
    "context": "75, Paris, Île-de-France",
    "lat": 48.850699,
    "lon": 2.308628
  }
]

> reverse_geocode {"lat":45.7578,"lon":4.832}
[
  {
    "label": "Place Bellecour 69002 Lyon,Lyon 2e Arrondissement",
    "type": "street",
    "score": 0.997,
    "postcode": "69002",
    "city": "Lyon",
    "citycode": "69382",
    "context": "69, Rhône, Auvergne-Rhône-Alpes",
    "lat": 45.757597,
    "lon": 4.831662,
    "distance_m": 35
  }
]

> search_company {"query":"airbus","departement":"31","per_page":2}
{
  "total": 93,
  "page": 1,
  "total_pages": 47,
  "results": [
    {
      "siren": "383474814",
      "name": "AIRBUS",
      "acronym": null,
      "status": "active",
      "naf": "30.30Z",
      "created": "1991-10-18",
      "category": "GE",
      "headcount_band": "53",
      "head_office": {
        "siret": "38347481400100",
        "address": "2 ROND-POINT DEWOITINE 31700 BLAGNAC",
        "postcode": "31700",
        "city": "BLAGNAC",
        "lat": 43.624640185,
        "lon": 1.3835065654
      },
      "establishments": {
        "total": 11,
  … (27 more lines)

> get_company {"siren":"356000000"}
{
  "siren": "356000000",
  "name": "LA POSTE",
  "acronym": null,
  "status": "active",
  "naf": "53.10Z",
  "created": "1991-01-01",
  "category": "GE",
  "headcount_band": "53",
  "head_office": {
    "siret": "35600000000048",
    "address": "DIRECTION GENERALE DE LA POSTE 9 RUE DU COLONEL PIERRE AVIA 75015 PARIS",
    "postcode": "75015",
    "city": "PARIS",
    "lat": 48.831515159,
    "lon": 2.2780898787
  },
  "establishments": {
    "total": 13131,
    "open": 8862
  },
  "legal_form_code": "5510",
  "vat_number": "FR39356000000",
  "closed": null,
  … (124 more lines)

> list_communes {"name":"Lyon","limit":2}
{
  "total": 7,
  "communes": [
    {
      "name": "Lyon",
      "insee_code": "69123",
      "postcodes": [
        "69001",
        "69002",
        "69003",
        "69004",
        "69005",
        "69006",
        "69007",
        "69008",
        "69009"
      ],
      "departement": "69",
      "region": "84",
      "population": 519127
    },
    {
      "name": "Cognat-Lyonne",
      "insee_code": "03080",
  … (9 more lines)

> get_company {"siren":"12"}
[isError] MCP error -32602: Input validation error: Invalid arguments for tool get_company: a 9-digit SIREN at siren
```

## Streamable HTTP

Server started with a random key (`MCP_API_KEY=$(openssl rand -hex 24) npm run start:http`).

A request without a key:

```console
$ curl -s -X POST http://127.0.0.1:3917/mcp -H 'content-type: application/json' -d '{}'
{"jsonrpc":"2.0","error":{"code":-32001,"message":"Unauthorized"},"id":null}
```

The same client over HTTP with `Authorization: Bearer $MCP_API_KEY` (results cut to 6 lines each):

```console
$ DEMO_LINES=6 npm run demo -- --http http://127.0.0.1:3917/mcp
connected over Streamable HTTP (http://127.0.0.1:3917/mcp)
tools: search_address, reverse_geocode, search_company, get_company, list_communes

> search_address {"query":"20 avenue de Ségur Paris","limit":1}
[
  {
    "label": "20 Avenue de Ségur 75007 Paris",
    "type": "housenumber",
    "score": 0.972,
    "housenumber": "20",
  … (9 more lines)

> reverse_geocode {"lat":45.7578,"lon":4.832}
[
  {
    "label": "Place Bellecour 69002 Lyon,Lyon 2e Arrondissement",
    "type": "street",
    "score": 0.997,
    "postcode": "69002",
  … (8 more lines)

> search_company {"query":"airbus","departement":"31","per_page":2}
{
  "total": 93,
  "page": 1,
  "total_pages": 47,
  "results": [
    {
  … (45 more lines)

> get_company {"siren":"356000000"}
{
  "siren": "356000000",
  "name": "LA POSTE",
  "acronym": null,
  "status": "active",
  "naf": "53.10Z",
  … (142 more lines)

> list_communes {"name":"Lyon","limit":2}
{
  "total": 7,
  "communes": [
    {
      "name": "Lyon",
      "insee_code": "69123",
  … (27 more lines)

> get_company {"siren":"12"}
[isError] MCP error -32602: Input validation error: Invalid arguments for tool get_company: a 9-digit SIREN at siren
```

Server log (stderr, one JSON object per line):

```json
{"time":"2026-10-16T20:20:39.876Z","level":"info","msg":"listening","transport":"http","host":"127.0.0.1","port":3917,"path":"/mcp","auth":"api-key","version":"0.1.0"}
{"time":"2026-10-16T20:20:40.563Z","level":"warn","msg":"rejected request","reason":"no key","ip":"127.0.0.1"}
{"time":"2026-10-16T20:20:42.045Z","level":"info","msg":"upstream request","api":"Géoplateforme geocoding","path":"search","status":200,"ms":651}
{"time":"2026-10-16T20:20:42.047Z","level":"info","msg":"tool call","tool":"search_address","ok":true,"ms":653}
{"time":"2026-10-16T20:20:42.157Z","level":"info","msg":"upstream request","api":"Géoplateforme geocoding","path":"reverse","status":200,"ms":99}
{"time":"2026-10-16T20:20:42.158Z","level":"info","msg":"tool call","tool":"reverse_geocode","ok":true,"ms":100}
{"time":"2026-10-16T20:20:42.970Z","level":"info","msg":"upstream request","api":"Recherche d'entreprises","path":"search","status":200,"ms":804}
{"time":"2026-10-16T20:20:42.971Z","level":"info","msg":"tool call","tool":"search_company","ok":true,"ms":805}
{"time":"2026-10-16T20:20:43.111Z","level":"info","msg":"upstream request","api":"Recherche d'entreprises","path":"search","status":200,"ms":132}
{"time":"2026-10-16T20:20:43.112Z","level":"info","msg":"tool call","tool":"get_company","ok":true,"ms":133}
{"time":"2026-10-16T20:20:43.656Z","level":"info","msg":"upstream request","api":"API Découpage administratif","path":"communes","status":200,"ms":536}
{"time":"2026-10-16T20:20:43.657Z","level":"info","msg":"tool call","tool":"list_communes","ok":true,"ms":537}
```
