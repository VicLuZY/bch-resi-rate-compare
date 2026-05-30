# BC Hydro Residential Rate Comparator

Local-first browser app for comparing BC Hydro residential interval-consumption exports against configurable residential rate assumptions.

## Run locally

```bash
npm install
npm run dev
```

Open the printed local URL, upload one or more BC Hydro consumption CSV exports, review validation, then compare the available annual periods.

## Current scope

- Parses BC Hydro residential interval CSV exports through a centralized schema map.
- Groups and merges records by normalized meter number.
- Deduplicates exact overlapping intervals and blocks unresolved conflicting overlaps.
- Handles Pacific daylight-saving skipped and repeated local hours when reconstructing the canonical timeline.
- Requires at least one complete continuous local year before calculating.
- Calculates configured options for RS 1101, RS 1101 plus RS 2101, RS 1151, and RS 1151 plus RS 2101.
- Keeps rates, tier thresholds, time windows, riders, taxes, and source notes in `public/rates/bchydro-residential-2026-04-01.json`.
- Lets users edit rate assumptions through labelled controls and recalculate without code changes.
- Displays uploaded customer, account, meter, and service-address metadata locally in the browser.
- Shows visual cost comparisons, cost-stack percentages, clock-window shares, monthly usage, hourly usage, and day/hour intensity.
- Exports validation and comparison summaries as CSV.

The default rate assumption file was populated from the BC Hydro Electric Tariff PDF effective April 1, 2026. It remains an editable assumption source, not a claim that the app reproduces official bill-cycle rounding.

## Checks

```bash
npm test
npm run build
```

Synthetic fixtures are used for tests. Local BC Hydro exports may contain private identifiers and are ignored by `.gitignore`.
