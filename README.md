# Ottawa–Beijing lowest-fare search

Search Ctrip for round-trip fares for **1 adult, economy/premium economy, April 11–June 1, 2027, with 28–42 days between outbound and return departures**. The default configuration enumerates all **255 date pairs**, with no airline or transfer-count filter. Fares are displayed in CNY including taxes. Beijing includes both Capital and Daxing airports; check each itinerary for its actual airport.

This version queries Ctrip only. It does not query Air China’s website or book tickets. The return date means departure from Beijing; arrival in Ottawa may be June 2 or later. Stay duration is the difference between departure dates, not the number of nights spent in Beijing.

## Run

Requirements: Node.js 20+ and Google Chrome. Open a terminal in this directory:

```sh
npm ci
npm test
npm run plan
npm run search -- --limit 1
npm run search
npm run report
```

On macOS, you can also double-click `start-search.command`. It installs missing dependencies on the first run, then searches unfinished date pairs. Double-click again to resume.

Check one date pair first to verify that the current website layout works with the adapter. Remove `--limit` to search all pairs. The collector opens a visible browser with its own `browser-profile/`; it does not read your regular Chrome profile.

If the site requests login or verification, handle it yourself in the browser. When verification is detected, the collector saves progress and stops the batch. Complete verification, follow the terminal prompt to exit, then run `npm run search` again. The program does not solve CAPTCHAs, bypass access restrictions, or call undocumented flight APIs.

If Chrome is unavailable, change `browserChannel` in `config.json` to `chromium`, then run `npx playwright install chromium` as described in the [official Playwright browser documentation](https://playwright.dev/docs/browsers).

## How fares are verified

1. Enumerate every valid date pair without weekday-based shortcuts.
2. Open each round-trip search, verify dates and the adult requirement, and select lowest-price sorting.
3. Read actual flight cards with the site’s round-trip, tax-inclusive price label. Calendar estimates and one-way prices are excluded.
4. Select the cheapest outbound option, then read the return-stage round-trip total. If the two totals differ, mark the pair unresolved rather than count it as verified.
5. Save itinerary text, query time, screenshot, and URL. Rank only verified, unexpired results.
6. Report complete coverage only when every date pair has a fresh confirmed result. No-flight pages, access failures, CAPTCHAs, and timeouts remain unresolved rather than proving unavailability.

Even a completed run establishes only the lowest displayed fare found at its query times, for the current account and visible products. Fares and inventory can change during the run; verify again before purchase. Baggage, changes, refunds, overnight transfers, and connection protection are not checked automatically. Different fares may have different conditions.

## Output and resuming

Results are written under `data/<search-scope-hash>/`:

- `plan.json`: every date pair to query.
- `history.jsonl`: append-only query history.
- `results.csv`: Excel-readable dates, statuses, fares, itineraries, and URLs.
- `report.md`: coverage, lowest fare, and the top 20 results.
- `summary.json`: machine-readable summary.
- `evidence/`: screenshots of successful and failed queries.

A new run skips successful queries from the last 12 hours and retries failed or expired pairs. `Ctrl+C` preserves records already written to disk. If `search.lock` remains after an unexpected exit, confirm that no collector is running before removing it. Do not run multiple collectors against the same data directory.

Edit `config.json` to change dates, stay duration, freshness, or query spacing. Changed search criteria use a separate data directory. The default gap between queries is 20 seconds; each pair also waits for flight lists to stabilize. Searching all 255 pairs normally takes several hours, and verification interruptions can extend this.

```sh
node cli.mjs search --config /absolute/path/custom-config.json --limit 5
```

`plan` and `report` do not access flight websites and can run without installing Playwright. Chinese strings retained in selectors, fare patterns, and test fixtures match Ctrip’s Chinese interface. Raw itinerary evidence remains in the website’s language; program messages and report labels are English.

## Validation status

- The source delivery includes `package-lock.json` to pin installed dependency versions. Install dependencies again in a fresh checkout with `npm ci`.
- All five unit tests passed. They cover complete date enumeration, date boundaries, fare parsing, result freshness, failure handling, and coverage reporting.
- The 255-pair plan and an empty report were generated in the original delivery directory.
- macOS process permissions blocked Chrome startup in Codex’s restricted execution environment. The standalone CLI has not completed an end-to-end live search, and the 255 fares have not been collected. Run `npm run search -- --limit 1` in a normal local terminal first.
- Through Codex’s connected browser, the same DOM-reading logic was checked on a real Ctrip search for April 11–May 9, 2027. It extracted six outbound cards and three return cards, with a minimum displayed round-trip total of CNY 8,250 at both stages. That separate check was not a standalone CLI run and was not imported into batch results.
