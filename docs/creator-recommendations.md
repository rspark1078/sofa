# Creator recommendations MVP

The Home recommendations feed blends personal TMDB recommendations with 11 curated movie picks. The source selector supports watch history only and Jeremy Jahns, Chris Stuckmann or Flick Connection individually. Existing Free / Paid filters still verify current US offers, including ads in Free. Already tracked titles are excluded per account. Creator picks work without a watch history.

Each movie card and detail page credits the channel and links to the original video, with its title and publication date. All credited creators are preserved when a movie has multiple picks. Attribution does not imply creator endorsement of Sofa. Review coverage alone is never counted as a recommendation.

## Verified starter sources

- Jeremy Jahns: https://www.youtube.com/watch?v=nOPiMHx0Slo (2023-12-26). Public captions explicitly identify John Wick: Chapter 4, Godzilla Minus One and Oppenheimer as picks. No rank/score is converted into a universal critic rating.
- Chris Stuckmann: https://www.youtube.com/watch?v=oCZM6UoZdOQ (2024-12-27). His description links his own list https://boxd.it/AVrZE. Confirmed picks: Hundreds of Beavers, Sing Sing, Dìdi and The Wild Robot. This avoids treating a general review as a positive endorsement.
- Flick Connection: https://www.youtube.com/watch?v=UKz65tlZsCY (2024-12-20). Explicit recommendation video with public chapters: A Scanner Darkly 18:19, Cube 19:20, Dark City 22:58 and Project Wolf Hunting 6:14. Watch links jump to each chapter.

Movie identities were individually verified against TMDB, including correcting Project Wolf Hunting to movie 799379. Availability mentioned in older videos is not reused as a current availability claim.

## Architecture and limits

Catalog: SQLite tables recommendationCreators, creatorVideos and creatorPicks. The additive migration 20261005165514_creator_recommendations imports the original three creators, three videos and 11 picks once. Runtime reads use the query layer; later catalog edits are not overwritten on restart. Creator profiles use UUIDv7 keys and stable slugs for API/UI selection. Video metadata/evidence is shared across its movie picks, and chapter timestamps belong to each pick. The retired JSON file is no longer read. Core handles matching, fair creator interleaving, account-specific tracked exclusions and blending with existing personal ranking. Movie metadata requests are bounded to batches of five, coalesced and cached for one hour; availability uses the existing independent 15-minute US cache. Shared API fields also support future native/TV clients. No new API key is needed. Catalog candidates are capped at 50 per request; movie metadata caching is bounded to 500 entries.

This is a curated starter catalog, not automatic YouTube monitoring. Adding a pick requires explicit endorsement evidence, exact TMDB movie identity, channel/video attribution and publication date. Source weights and automatic recommendation extraction are later work. No transcripts, review text or creator thumbnails are distributed with the application.

## Validation

All required checks passed: lint, format:check, check-types and test (517 tests). Browser QA used the isolated throwaway database: all-source blending, all three individual creator selections, Free/With ads filtering, exact channel/video URLs, chapter timestamps, detail-page attribution and 390px mobile layout. No horizontal overflow or browser JavaScript errors. The user library was not used for test mutations. Local web and API health checks returned HTTP 200. Nothing was committed or merged.

Catalog storage is instance-wide, while watch-history recommendations and tracked exclusions remain account-specific. Source choices are returned from the database, so future creators do not require hardcoded UI options. Settings now includes account-specific critic following and channel-check scheduling; see below.

Database migration validation: 3 creators, 3 videos and 11 picks preserved; SQLite integrity check passed with zero foreign-key violations. Existing user tracking, ratings, preferences and integrations matched the pre-migration backup. New tests cover fresh migration, migration reruns preserving edits, database-driven sources, multiple-creator attribution, uniqueness, foreign keys and cascade behavior. Browser QA confirmed source selection survives availability refresh with exact chapter links.

Local pre-migration backup: /home/rspark/Work/sofa-review-tools/sqlite.db.before-creator-tables-20261005-125335.


## Personal critic settings and channel checks

Settings → Account → Critics and creators lets each account select any combination of catalog critics, opt into all future catalog additions, or deselect everyone for watch-history-only recommendations. Choices and check frequency persist in SQLite appSettings using account-scoped keys. Selecting an individual Home source cannot bypass these preferences. Channel credit links remain visible.

Checks can be Manual, Hourly, Daily (default), or Weekly, with Check now and last-success/error status. The server cron checks for due account preferences (including the daily default) every 15 minutes, including when no browser is open. Changed preferences reset their check status and become due on the next tick. Manual users are never polled. After downtime, due checks resume on the next tick. Failures retry after at most an hour, preserve existing picks and discoveries, and do not mark a failed check successful. Shared in-flight channel checks and a persisted one-minute cooldown avoid duplicate requests across accounts.

YouTube's public Atom feed supplies video IDs, titles and dates without a new API key. Requests use a fixed YouTube host, validated catalog channel IDs, no redirects, a 15-second timeout and a 1MB streamed-body cap. XML is parsed strictly, rejects declarations/entities, and verifies channel identity. A valid empty feed is accepted. Discovered metadata is stored in the new creatorFeedEntries table with unique creator/video keys and cascading foreign keys; the UI lists the 20 latest entries belonging to followed critics, linked to the original YouTube videos. Feed windows are limited and do not provide exhaustive backfill.

A newly discovered video is **not a verified movie recommendation**. The Settings list explicitly labels recommendation review as required. New movie picks still require endorsement evidence and exact TMDB identity before being added to creatorVideos/creatorPicks; there is no automatic endorsement classifier or transcript import. This protects against treating a negative or general review as a positive recommendation. Home's Refresh recommendations button separately refreshes its existing recommendation feed.

Migration 20261005183029_groovy_shaman is additive and introduces only creatorFeedEntries. No existing libraries or catalog picks are removed or rewritten. Tests cover account isolation, selected sources, scheduling intervals/manual mode, Atom parsing/identity, video uniqueness, preserving picks and status on failure.


Personal settings validation: all required lint, format:check, check-types and test commands passed without errors or warnings (527 tests). Live feeds for all three creators returned HTTP 200 and parsed 15 entries each. Isolated browser QA verified critic deselection, weekly schedule persistence after reload, live Check now results, channel attribution, Home filtering and a 390px layout without horizontal overflow or JavaScript errors. Local database integrity and foreign-key checks passed; all 11 curated picks remain intact. Main web/API health checks returned HTTP 200. Test servers and browser were stopped; no commits or merges were made.
