# Documented Test Set

The automated tests cover the calculation and validation mechanics.

## Validation coverage

- `complete leap-year dataset with daylight-saving transitions`: one full local year across the spring skipped hour and autumn repeated hour in `Canada/Pacific`; expects one valid annual period and no false DST gap.
- `segmented files for the same meter`: two CSV segments for one meter reconstruct one continuous annual period.
- `exact overlap rows`: overlapping segmented exports with identical interval values are deduplicated.
- `conflicting overlap rows`: duplicated timestamps with different kWh values are reported as unresolved conflicts.
- `missing intervals`: a removed hourly interval creates a gap and prevents a valid one-year comparison.
- `malformed export`: missing required columns is rejected with a clear parser error.
- `generation-like outflow`: positive outflow creates an out-of-scope warning.
- `estimated intervals`: estimated-usage flags are counted and disclosed.
- `configured timezone`: validation uses the timezone supplied by the active rate configuration.

## Calculation coverage

- `benchmark`: high annual consumption is calculated independently for all four comparison options, including tier allocation, base charges, clock-window allocation, and riders.
- `editable assumptions`: changing a rate value in the config changes calculated results without code changes.
- `CSV export`: exported summary totals match the calculated result totals.

## Manual browser smoke

Run `npm run dev`, open the local URL, upload a CSV, and confirm:

- customer, account, meter, address, and city metadata are visible after upload because the app runs locally;
- the meter validation panel shows cadence, complete annual periods, errors, and warnings;
- the annual comparison ranks all four configured options and shows insights, savings percentages, cost stacks, and usage charts;
- result details itemize base charges, energy charges, riders, clock-window adjustments, and trace row counts;
- validation and comparison CSV export buttons are available.
