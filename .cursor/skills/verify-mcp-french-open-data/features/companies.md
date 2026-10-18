# Companies

A user asks their assistant to find a French company or to give details about one. The assistant calls `search_company`, then `get_company` with a 9-digit SIREN, and gets status, activity code, head office, VAT number, leaders and published finances.

## Sub-features

- `company-search`: name, address, leader or SIREN/SIRET to paged summaries, with `total`, `page` and `total_pages`.
- `company-filters`: `postcode`, `departement`, `naf`, and `active_only` (on by default).
- `company-lookup`: SIREN to details. Leaders' birth dates are never returned.
- `company-invalid`: a malformed SIREN is refused before any upstream call.

## How to get to it (user POV)

- Ask "find La Poste in the company register", then "give me the details for SIREN 356000000".

## Driving it with verify.ts

Preconditions:

- `verify.ts doctor` reports recherche-entreprises.api.gouv.fr reachable.

Steps:

- **Search.** The step `search_company {"query":"la poste","per_page":3}` passes when the total is above 0, every SIREN has 9 digits, and `356000000` is in the results with status `active`.
- **Lookup.** The step `get_company {"siren":"356000000"}` passes when the name is `LA POSTE`, the VAT number is `FR39356000000`, the head-office SIRET starts with the SIREN, and the text has no `date_de_naissance`.
- **Invalid.** The step `get_company {"siren":"12"}` passes when `isError` is set and the message says "9-digit SIREN".
- **Proof.** The PASS lines for `search_company`, `get_company` and `invalid SIREN is refused`, over both transports.

## Gotchas

- The API allows 7 requests/s per IP. The server spaces its calls 200 ms apart, so parallel verification runs slow each other down.
- Non-public ("non-diffusible") companies are absent by design. A miss is not always a bug.
- Leaders and finances change over time, so the checks assert only stable identifiers (SIREN, VAT number, name).
