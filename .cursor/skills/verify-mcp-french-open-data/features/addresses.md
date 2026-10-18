# Addresses

A user asks their assistant to locate or normalise a French address, or to name the address at a point. The assistant calls `search_address` or `reverse_geocode` and gets ranked addresses with postcode, INSEE code and coordinates.

## Sub-features

- `address-search`: free text to ranked matches with a score from 0 to 1 and WGS84 coordinates.
- `address-filters`: `postcode`, `citycode` and `type` narrow the matches.
- `address-reverse`: a lat/lon gives the nearest addresses, with `distance_m`.

## How to get to it (user POV)

- Ask the assistant something like "where is 20 avenue de Ségur in Paris?" (Claude Desktop or Cursor over stdio, or any client over HTTP).
- Ask "what address is at 45.7578, 4.832?"

## Driving it with verify.ts

Preconditions:

- `verify.ts doctor` reports data.geopf.fr reachable.

Steps:

- **Search.** Run `verify.ts run`. The step `search_address {"query":"20 avenue de Ségur Paris","limit":1}` passes when the first result has postcode `75007`, its label contains `Ségur`, and its coordinates fall in Paris.
- **Reverse.** The step `reverse_geocode {"lat":45.7578,"lon":4.832}` passes when the first result's city is `Lyon` and `distance_m` is under 300.
- **Proof.** The `PASS stdio: search_address` and `PASS http: search_address` lines in `transcript.txt`, plus `"tool":"search_address","ok":true` in both stderr logs.

## Gotchas

- The geocoder autocompletes. Short queries match broadly, so the `limit` default of 5 is useful for ambiguous input.
- `api-adresse.data.gouv.fr` is retired. The server uses `data.geopf.fr/geocodage`. Point `GEOCODING_BASE_URL` elsewhere only on purpose.
- Scores drift slightly as the BAN updates, so the checks assert place, not exact score.
