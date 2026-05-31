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
- Includes EV-charging and electric-baseboard-heating example exports.
- Shows visual cost comparisons, cost-stack percentages, clock-window shares, monthly usage, hourly usage, and day/hour intensity.
- Exports validation and comparison summaries as CSV.

The default rate assumption file covers BC Hydro Electric Tariff values effective April 1, 2026. It remains an editable assumption source, not a claim that the app reproduces official bill-cycle rounding.

## Calculator disclaimer

Calculator results are estimates for comparison only. They are not a BC Hydro bill, an official tariff interpretation, financial advice, or a warranty of billing accuracy. Verify uploaded data, effective rates, riders, taxes, credits, charges, and bill-cycle rounding before using results for decisions.

## License and source

Copyright (C) 2026 Victor Lü.

This project is licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the license and copyright notices.

Source repository: <https://github.com/VicLuZY/bch-resi-rate-compare>

Hosted app: <https://vicluzy.github.io/bch-resi-rate-compare/>

The hosted web app displays source and license links so network users can access the Corresponding Source.

## Checks

```bash
npm test
npm run build
```

UI evidence checks:

```bash
npm run build
npm run preview -- --port 4173
npm run verify:ui
```

To simulate the GitHub Pages build path locally:

```bash
GITHUB_ACTIONS=true npm run build
GITHUB_ACTIONS=true npm run preview -- --port 4173
UI_CHECK_URL=http://127.0.0.1:4173/bch-resi-rate-compare/ npm run verify:ui
```

Local BC Hydro exports may contain private identifiers and are ignored by `.gitignore`.
