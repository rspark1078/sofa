# Upstream integration review — 2026-10-06

Reviewed and integrated the 109 commits from original Sofa main after our shared base `75ede45`, through `8da4cbb` (2026-10-05). Original repository: https://github.com/jakejarvis/sofa. Our starting feature commit was `d509510` on `mvp/free-discovery`.

## Changes retained

- Authentication and upload hardening: resolved client IP rate limits, Expo proxy restrictions, authenticated large uploads and body/ZIP expansion limits.
- Backup restore migration before swapping the restored database into place, older-schema backup acceptance, import normalization and cancellation fixes.
- Discover/search: shared core browse service, IMDb ID lookup, TV date-sort mapping, TMDB page cap, pagination retries and loaded-page retention.
- Tracking/history: watch-history page and editing, last-watched sort, quick episode actions, aired-only Continue Watching, Recently aired view and corrected date/stat windows.
- Background metadata refresh improvements, cache invalidation fixes, clearer errors, translations and native accessibility/session/widget fixes.

The whole reviewed upstream range was integrated to retain its connected fixes and test coverage. No commits were made on our `main`, and no changes were sent to the original creator's repository. Native upstream changes include iOS 17 minimum support; native runtime/device testing was not performed.

## Custom feature compatibility

Merge resolutions retain country/language/year/genre/score/content-rating filters, provider multiselect and linked categories, US offer verification, URL reset and saved filters, always-visible Discover, Explore visibility settings and horizontal arrow navigation. Custom recommendations retain Free/Paid filtering, selected critics, admin catalog additions, curated/automated credit labels and local-model checks.

Custom browse verification now runs in the upstream core browse service. A server regression test checks Korean-origin/Korean-language/7+/maximum PG-13/free-or-ads parameters, rejects paid-only US candidates and retains the upstream 500-page cap. Pagination failures keep existing cards visible and offer a retry. Translation catalogs and API references were regenerated for the combined contract.

## Validation

Required lint, formatting, type checks and tests were run on an isolated integration checkout. Combined suite: 976 tests (661 core, 140 server, 44 web, 44 native, 61 i18n, 26 public API). Web production build passed. An initial browser dependency-optimization warning was resolved by a clean rerun after optimization completed.

All upstream migrations were applied twice to a copy of the existing local SQLite database. Integrity passed, foreign-key violations were zero, all 24 critic picks remained, and the five enrichment-check columns were present. The actual application database is backed up before upgrading the running checkout.

Isolated browser QA used a disposable account in the copied database: Home creator credits, compound URL filters and live results, Explore arrows, all eight critic tiles, refresh controls, avatar loading and 390px layout. No JavaScript errors, broken critic avatars or horizontal overflow were observed. QA changes were confined to the copied database.
