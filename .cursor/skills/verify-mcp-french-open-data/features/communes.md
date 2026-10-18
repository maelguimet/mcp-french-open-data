# Communes

A user asks their assistant which commune a postcode belongs to, or for the INSEE code or population of a town. The assistant calls `list_communes`.

## Sub-features

- `communes-by-postcode`: a postcode gives the communes it covers.
- `communes-by-name`: a name gives communes boosted by population.
- `communes-by-departement`: a département code gives its communes, up to `limit`.
- `communes-no-filter`: a call with no filter is refused with a readable error.

## How to get to it (user POV)

- Ask "which commune is postcode 69001?" or "list the biggest communes called Saint-Denis".

## Driving it with verify.ts

Preconditions:

- `verify.ts doctor` reports geo.api.gouv.fr reachable.

Steps:

- **By postcode.** The step `list_communes {"postcode":"69001"}` passes when the results include Lyon with INSEE code `69123` and a population above 400,000.
- **Proof.** The PASS lines for `list_communes` over both transports, plus `"tool":"list_communes","ok":true` in both logs.

## Gotchas

- An INSEE code (`69123`) is not a postcode (`69001`). `search_address` takes `citycode`, which is the INSEE code.
- `total` counts all matches before `limit` is applied.
