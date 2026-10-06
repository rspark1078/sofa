# Free discovery MVP review

Branch: `mvp/free-discovery`. Changes remain uncommitted; no merge to main.

## Problem and resulting behavior

A U.S. movie discovery query can combine origin country, original language, genre, year, minimum TMDB score, maximum content rating, multiple providers, and free/ad-supported or paid availability. Discover selections persist in URLs and can now be saved as named account presets.

TMDB discovery can return a movie that is free on one service but rental-only on the selected service. The audit reproduced this with **Exhuma (2024), OnDemandKorea, Free**. Discover now checks the title's U.S. offer list and matches price type and provider on the same offer before including it.

## Availability and watch links

- Title-level U.S. offers are cached for at most 15 minutes, with concurrent requests coalesced, a 1,000-entry cache bound, and batches of at most five requests.
- Successful absence of offers is cached; errors are not converted into verified empty results.
- Discover and recommendations display Free / With ads / Subscription / Rent / Buy badges. Title pages preserve all price types instead of hiding free offers behind a subscription.
- Title pages refresh their availability, display when it was checked, and provide TMDB's title-specific U.S. watch page with TMDB/JustWatch attribution.
- Provider links use exact official title pages when curated and verified. Three initial mappings cover The Gangster, the Cop, the Devil on Tubi and OnDemandKorea, and Exhuma on OnDemandKorea. Other links clearly identify search or home-page fallbacks.
- Link targets accept HTTP/HTTPS only and reject embedded credentials.
- Source pagination counts are candidate counts. Verification can shorten a page; an empty verified page with more candidates offers “Check more results.”

Official pages used in the audit:

- [Tubi: The Gangster, the Cop, the Devil](https://tubitv.com/movies/585846/the-gangster-the-cop-the-devil)
- [OnDemandKorea: The Gangster, the Cop, the Devil](https://www.ondemandkorea.com/en/player/vod/the-gangster-the-cop-the-devil-movie1)
- [OnDemandKorea: Exhuma](https://www.ondemandkorea.com/en/player/vod/exhuma-movie1)
- [TMDB watch-provider API](https://developer.themoviedb.org/reference/movie-watch-providers)

The provider pages establish title identity and link destinations. Displayed U.S. price types come from title-level TMDB data; the audit does not claim a completed provider playback session.

## Presets

Account-authenticated endpoints list, create/update and delete presets using Sofa's existing settings/query layer. Each account can save up to 50 named presets. Names are trimmed and limited to 100 characters; filter data uses the shared validated schema.

Loading a preset replaces the current filters, including provider arrays and sorting. Updating replaces the selected preset; deleting does not affect the current URL. The local database was backed up before testing. No schema migration was introduced.

## Recommendations and empty states

The existing ranking is retained: sources are completed/in-progress titles or titles rated at least four stars; already tracked titles are excluded; recommendation ranks accumulate across sources.

Availability is rechecked against current U.S. title-level offers. Free includes both free and ads; Paid includes subscription, rental and purchase. Up to 50 ranked candidates are considered, stopping once ten verified matches are found. “Based on…” explanations contain only source titles from the current account.

Discover, recommendations and Upcoming provide actionable empty/error states. Upcoming explicitly describes future releases and episodes for titles already in the user's library over the next 90 days.

## Validation

Required checks passed without errors or warnings: `bun run lint`, `bun run format:check`, `bun run check-types`, `bun run test`. The final suite passed 507 tests (447 core, 21 web, 35 i18n, 4 native). LingUI extraction and OpenAPI generation were also run.

Regression coverage includes the cross-provider price mismatch, foreign-region exclusion, cache expiry/coalescing/failure recovery, bounded recommendation checks, ad-supported Free recommendations, account-isolated explanations, preset lifecycle/account isolation/validation/limits, and safe provider URL handling.

Browser QA uses agent-browser against an isolated database/account and separate local ports, preserving the user's library. Checked flows include Korean free discovery, OnDemandKorea selection, URL persistence, preset save/update/reset/load/delete, title availability and links, recommendation explanations and Free filtering, and the Upcoming empty state. Desktop and mobile layout screenshots are retained in the local review-tools directory.

## Review boundaries and remaining manual checks

Availability accuracy depends on TMDB/JustWatch freshness; playback, region restrictions and account/library-card requirements need provider-side confirmation. Direct provider links are deliberately a small curated list, not guessed slugs. General provider categories remain curated; final inclusion uses actual title offers.

The optional Firefox handler is installed only on this Omarchy PC. Actual Chromium permission prompts and a complete provider playback session require the user's interactive check.

No commits, staging, publication, merge, driver/system changes, Docker/Plex changes, or modifications to the existing game/media library were performed during this improvement pass.

## Proposed commit groups

1. Compound Discover filters, URL/reset behavior, provider mappings and regression tests.
2. Explore visibility settings, responsive grids and horizontal browsing controls.
3. Verified U.S. availability, exact offer labels, safe/direct/fallback watch links.
4. Named account presets and endpoint/UI tests.
5. Recommendation verification/explanations and actionable empty states.
6. Translations, generated API documentation and this review record.

The local Firefox desktop handler is outside the repository and should be reviewed separately from the Sofa changes.
