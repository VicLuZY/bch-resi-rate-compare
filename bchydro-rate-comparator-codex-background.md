# BC Hydro Residential Rate Comparator: Codex Background Brief

## Goal

Build a browser-only interactive website that lets a residential BC Hydro customer upload one or more BC Hydro interval-consumption CSV exports, reconstruct a complete continuous annual usage record for each meter, validate data continuity and quality, and compare the annual cost of the eligible residential base-rate and time-band combinations in a transparent, editable, and auditable way without embedding rate constants, customer identifiers, filenames, sample data, or tariff assumptions directly in the application logic.

## Context

This project is a customer-facing residential electricity-rate comparison tool for BC Hydro interval data. The website should help a user understand whether their actual historical load profile would have cost more or less under each supported residential rate option. The comparison must be based on uploaded interval consumption data, not on generic household profiles or estimated load shapes.

The tool should run entirely in the browser. Uploaded CSV data may contain customer names, account numbers, meter numbers, service addresses, and energy usage data. The application must not upload files to any server, call external APIs with user data, or persist private data outside the user's local browser session unless the user explicitly exports a result.

The immediate comparison scope is limited to the following residential options:

- Residential tiered base rate, BC Hydro Rate Schedule 1101.
- Residential tiered base rate with the optional residential time-band schedule, Rate Schedule 1101 plus Rate Schedule 2101.
- Residential flat base rate, BC Hydro Rate Schedule 1151.
- Residential flat base rate with the optional residential time-band schedule, Rate Schedule 1151 plus Rate Schedule 2101.

Exclude net metering, self-generation, community generation, and customer-generation purchase rates from the comparison. Do not model Rate Schedule 1289, Rate Schedule 2289, Rate Schedule 2290, or any equivalent customer-generation arrangement. If an uploaded dataset contains export, generation, or negative-consumption behaviour, the application should warn that the dataset may be outside the intended scope rather than silently modelling it as a generation customer.

Rate Schedule 1105, the legacy E-Plus or dual-fuel residential heating rate, is not part of the comparison scope. It may be mentioned only as a known excluded legacy schedule, not as a selectable option.

## Official source hierarchy

BC Hydro's official Electric Tariff is the source of truth for rates, rate-rider applicability, availability, special conditions, and definitions. BC Hydro's public residential rate pages and explanatory articles are helpful user-facing references, but the tariff should prevail when there is a conflict.

Primary source references for Codex to consult when implementing or updating the rate configuration:

- BC Hydro Electric Tariff landing page: https://www.bchydro.com/toolbar/about/strategies-plans-regulatory/tariffs-terms-conditions/electric-tariff.html
- Current BC Hydro Electric Tariff PDF: https://www.bchydro.com/content/dam/BCHydro/customer-portal/documents/corporate/tariff-filings/electric-tariff/bchydro-electric-tariff.pdf
- BC Hydro residential rates page: https://www.bchydro.com/accounts-billing/rates-energy-use/electricity-rates/residential-rates.html
- BC Hydro residential tiered rate page: https://app.bchydro.com/accounts-billing/rates-energy-use/electricity-rates/residential-rates/tiered.html
- BC Hydro residential flat rate page: https://www.bchydro.com/accounts-billing/rates-energy-use/electricity-rates/residential-rates/flat.html
- BC Hydro residential time-band page: https://www.bchydro.com/accounts-billing/rates-energy-use/electricity-rates/residential-rates/time-band.html

Do not encode rate values directly in component code, parser code, calculator code, tests, or UI strings. Use a versioned, replaceable rate configuration file or user-editable rate table. The application may ship with a blank, placeholder, or separately generated configuration file, but the calculation engine must treat rates, thresholds, time windows, riders, taxes, levies, effective dates, and rounding rules as data.

## Supported rate concepts

Rate Schedule 1101 is the residential tiered base rate. It has a daily basic charge, an energy charge with a first-tier allowance and a second-tier charge for consumption above the allowance, and a tariff note that the first-tier allowance is prorated on a daily basis for billing purposes. For annual comparison, derive the tier allowance from the configured daily prorating basis and the actual selected period length, not from a fixed monthly or fixed row-count assumption.

Rate Schedule 1151 is the residential flat base rate. It has a daily basic charge and a uniform energy charge. Treat any transformer-ownership discount or special multi-unit discount as out of scope unless a future configuration explicitly enables it.

Rate Schedule 2101 is an optional residential time-band schedule that is used together with either Rate Schedule 1101 or Rate Schedule 1151. It defines named local-clock time periods and applies an energy credit, no adjustment, or an energy charge depending on the period. Treat the period definitions and the adjustments as configuration data. The calculation should apply the time-band adjustment to each interval's delivered consumption after classifying the interval into the configured period using local time.

The base-rate calculation and the time-band adjustment should remain separate in the internal model so that the UI can explain the cost stack. A recommended breakdown is: basic charge, base energy charge, tier-one energy, tier-two energy, time-band credit, time-band charge, riders, taxes, levies, and final total. Only display rows that are relevant to the selected option and the enabled configuration.

Rate riders are schedule-specific. The tariff indicates that certain riders apply to charges under the base residential schedules before taxes and levies, while the time-band schedule has its own rider applicability. Do not assume that a rider applies universally. Store rider rules in the rate configuration and apply them only to the charge components specified by the configuration.

Taxes and levies should be explicit assumptions. The tool should clearly distinguish between pre-tax tariff comparison and estimated bill comparison. If taxes or levies are included, they must be user-visible, configurable, and separately itemized.

## No-hard-codes policy

The application must avoid hard-coded values in business logic. This includes rate amounts, tier thresholds, time-band start and end times, rider percentages, tax percentages, billing-period assumptions, currency symbols, utility source labels, sample account numbers, meter numbers, addresses, filenames, and personal names.

Use centralized configuration for all utility-specific parameters. Use schema maps or parser adapters for source-file column names. Use synthetic fixtures for tests. Do not commit real customer data or screenshots containing real customer identifiers.

Acceptable constants are structural concepts that define the app domain, such as the supported comparison option identifiers, the idea that intervals are measured in energy units, and the requirement to validate a complete annual period. Even these should be represented cleanly through named configuration or domain types rather than scattered literals.

## Input data background

BC Hydro's interval-consumption CSV export is a row-based file where each row represents an interval for a specific account and meter. Sample exports show a header row followed by interval records. The application should support the canonical BC Hydro export fields through a central schema map and should fail gracefully when required fields are missing.

Canonical fields observed in the export format include:

| Field role | Observed export label | How to use it |
|---|---|---|
| Customer display name | Account Holder | Private metadata. Do not display by default. Never use for grouping. |
| Account identifier | Account Number | Private metadata. May assist grouping when combined with meter number, but should be redacted in UI. |
| Meter identifier | Meter Number | Primary grouping field for meter-level analysis, subject to normalization. |
| Interval timestamp | Interval Start Date/Time | Required. Parse as local service-area time unless the export explicitly includes a timezone. |
| Exported period label | Time of Day Period | Optional cross-check. Do not rely on it as the only classification source, because non-TOU exports may show non-applicable values. |
| Delivered energy | Inflow (kWh) | Candidate consumption input. For non-generation customers this should normally match net consumption. |
| Exported energy | Outflow (kWh) | Use for scope detection and warnings. Customer generation is out of scope. |
| Net energy | Net Consumption (kWh) | Candidate consumption input. Validate against inflow and outflow. |
| Demand | Demand (kW) | Not required for the target residential comparison. Preserve only for diagnostics if useful. |
| Power factor | Power Factor (%) | Not required for the target residential comparison. Preserve only for diagnostics if useful. |
| Estimate flag | Estimated Usage | Use as a data-quality flag. Estimated intervals should be counted and disclosed. |
| Service address | Service Address | Private metadata. May assist grouping or display after redaction. |
| City | City | Private metadata. May assist timezone or service-area assumptions, but do not rely on it alone. |

The CSV parser should tolerate quoted fields, blank fields, leading apostrophes in account numbers, non-applicable text in numeric fields, currency- or unit-free numeric strings, and files exported over different date ranges. It should normalize whitespace, trim field names, and produce clear validation messages when a required field cannot be found.

## Meter grouping and segmented uploads

Users may upload multiple files for the same meter when BC Hydro exports are segmented by date range. The app must merge segments for the same meter, sort records chronologically, and rebuild the complete timeline before calculating rates.

The grouping strategy should be conservative. Prefer meter number as the primary meter key, augmented by account number and service-address metadata when available. If files appear to contain the same meter but conflicting account or address metadata, warn the user and ask them to confirm grouping before combining the records. If files contain different meters, show separate analyses by default and allow the user to choose whether to view a combined total.

Exact duplicate records from overlapping exports should be deduplicated. Conflicting duplicates, meaning the same meter and interval timestamp with different consumption values, should be flagged as errors or explicit user choices. The app should not average conflicting data silently.

## Annual data validation

The application must confirm that the merged dataset contains at least one complete continuous annual analysis period. The validation should be based on timestamps and interval cadence, not simply file size or row count.

A complete annual period means a continuous local-time interval series covering a full year for the selected meter after all uploaded segments are merged. The app should identify the latest complete annual period by default and allow the user to review or choose another complete period where multiple periods exist.

Detect and report:

- Missing intervals.
- Duplicate intervals.
- Conflicting duplicate intervals.
- Out-of-order rows.
- Negative or non-numeric consumption values.
- Estimated-usage intervals.
- Exported energy or generation-like behaviour.
- Multiple meters in the same upload set.
- Files that are individually incomplete but complete after merging.
- Files that cannot be merged into a gap-free annual period.

BC Hydro interval exports may contain daylight-saving-time artifacts when timestamps are represented as local clock time. The validator must handle daylight saving time explicitly for the BC Hydro service area, including the repeated local clock hour in autumn and the skipped local clock hour in spring. Use timezone-aware date handling and convert to a canonical internal timeline for gap checks. Do not treat valid daylight-saving transitions as ordinary data gaps or ordinary duplicates.

## Timezone and calendar assumptions

Use the service area's relevant Pacific timezone unless a future file format provides a more precise timezone. Keep the timezone as configuration. Do not scatter timezone strings throughout the code.

The calculation period should be calendar-accurate. Basic charges and prorated tier allowances should be derived from the exact number of service days or intervals in the selected analysis period. Do not assume a fixed number of rows per year, because daylight-saving transitions and leap years can affect interval counts.

## Consumption basis

The rate comparison should use delivered residential consumption for non-generation service. Where the export includes inflow, outflow, and net consumption, validate the relationship among those fields. For ordinary residential loads with no outflow, net consumption and inflow should generally align. If outflow is present, flag the dataset as potentially outside scope and make the user choose whether to proceed with a non-generation approximation.

The app should expose the selected consumption basis in the assumptions panel. A safe default is to use the net-consumption field only when outflow is absent or immaterial, and otherwise warn that generation-aware billing is intentionally excluded.

## Calculation model

For each selected meter and selected annual period, calculate all four supported options using the same normalized interval dataset.

For the tiered base option, calculate the daily basic charge over the selected period, allocate annual consumption into tier-one and tier-two quantities using the configured prorated tier allowance, apply the configured energy rates, then apply configured base-schedule riders and optional taxes or levies.

For the flat base option, calculate the daily basic charge over the selected period, apply the configured flat energy rate to all consumption, then apply configured base-schedule riders and optional taxes or levies.

For each time-band combination, first calculate the relevant base schedule, then classify every interval into the configured time-band period using local clock time, multiply the interval consumption by the configured adjustment for that period, and add or credit the result according to the configuration. Keep the time-band adjustment separate from the base energy charge so that riders, taxes, and reporting can follow the configured applicability rules.

Rounding should be controlled by configuration. Keep high-precision internal arithmetic and round only at display or configured billing-calculation boundaries. The UI should state whether it is estimating tariff charges over an annual period rather than reproducing exact BC Hydro bill-by-bill rounding.

## User interface requirements

The landing page should be minimal and should not contain any customer-specific information before upload. Provide a drag-and-drop upload zone, a concise explanation of what data is processed locally, and a link or disclosure for the current rate configuration.

After upload, show a validation-first workflow:

- Uploaded files and detected meters.
- Date range per file and per reconstructed meter.
- Whether the merged data contains a complete annual period.
- Any gaps, duplicates, conflicting records, estimated intervals, or out-of-scope generation indicators.
- The selected annual analysis period.
- The rate configuration version and source references.

When the data is valid, show the comparison results as a ranked table and clear visual summary. Include total annual cost for each option, difference from the cheapest option, difference from the current or selected baseline option, total kWh, time-band kWh breakdown, tier-one and tier-two kWh for the tiered options, and itemized cost components.

Provide an assumptions editor for rates and applicability without requiring code changes. The editor should allow the user to update rate values, rider values, period definitions, tax or levy assumptions, effective dates, and source notes. Any changed assumptions should mark results as user-modified.

Provide export options for the result summary and validation report. A CSV export is sufficient for tabular results. A printable report view should be structured so it can be printed to PDF by the browser.

## Error handling and trust

The application should prefer transparent refusal over false precision. If the uploaded data cannot support a complete annual comparison, show exactly why and identify the missing ranges. If the rate configuration is incomplete, stale, or missing required fields, block calculation and instruct the user to complete or update the configuration.

Every result should identify the analysis period, the meter or meters included, the consumption basis, whether taxes and levies are included, whether estimated intervals were present, and the rate configuration version used.

Avoid statements that imply the result is an official BC Hydro bill. Label the result as an estimate for comparison purposes unless the implementation has exact bill-cycle data and exact BC Hydro rounding rules.

## Privacy and data handling

Do not transmit uploaded files, parsed rows, account metadata, meter metadata, or analysis results to any external service. Do not store customer data in local storage by default. If optional persistence is added later, make it explicit and reversible.

Mask or omit private fields in the UI by default. Show only enough metadata for users to distinguish meters, such as a redacted meter identifier or user-supplied nickname. Never include real customer identifiers in demo data, test data, committed fixtures, or screenshots.

## Recommended implementation structure

Use a clear separation between parsing, normalization, validation, rate configuration, calculation, and presentation. The calculator should be pure and testable with synthetic interval data and synthetic rate configurations. The UI should call the calculator only after validation succeeds.

Recommended modules:

- File ingestion and CSV parsing.
- Schema mapping and field normalization.
- Meter grouping and segment merging.
- Timezone-aware interval normalization.
- Annual-period detection.
- Data-quality validation.
- Rate-configuration loading and validation.
- Rate calculation engine.
- Result formatting and export.
- UI components.

Do not couple calculations to UI state. Do not hide utility-specific assumptions inside components.

## Testing expectations

Use synthetic datasets to test all calculation and validation paths. Test complete annual data, segmented same-meter uploads, overlapping duplicates, conflicting duplicates, missing intervals, daylight-saving transitions, estimated intervals, multi-meter uploads, incomplete datasets, and out-of-scope generation indicators.

Use synthetic rate configurations to test tiered, flat, and time-band calculations. Do not use real current rate values in tests. Test that changing the rate configuration changes results without code changes.

Sample BC Hydro exports may be used locally by Codex for parser development, but they should not be committed into the repository or embedded in fixtures unless all private data has been removed and the data has been replaced with synthetic values.

## Acceptance criteria

A user can open the site locally or from static hosting, upload one or more BC Hydro interval CSVs, see the files grouped by meter, merge segmented files for the same meter, receive clear validation feedback, select a complete annual analysis period, edit or review the active rate configuration, and compare annual costs for Rate Schedule 1101, Rate Schedule 1101 plus Rate Schedule 2101, Rate Schedule 1151, and Rate Schedule 1151 plus Rate Schedule 2101 with itemized, exportable results.

The finished implementation must contain no hard-coded rate values, tariff thresholds, time-band windows, tax values, rider values, customer identifiers, meter identifiers, file names, or sample private data in the business logic or UI. All such values must be supplied through uploaded files, user input, or a clearly separated versioned configuration layer.
