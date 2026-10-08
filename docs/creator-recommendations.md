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

The original catalog is curated; subsequent monitoring and automated extraction are described below. Adding a pick requires explicit endorsement evidence, exact TMDB movie identity, channel/video attribution and publication date. Source weights remain later work. Local-model recommendation extraction is described below. No transcripts, review text or creator thumbnails are distributed with the application.

## Validation

All required checks passed: lint, format:check, check-types and test (517 tests). Browser QA used the isolated throwaway database: all-source blending, all three individual creator selections, Free/With ads filtering, exact channel/video URLs, chapter timestamps, detail-page attribution and 390px mobile layout. No horizontal overflow or browser JavaScript errors. The user library was not used for test mutations. Local web and API health checks returned HTTP 200. Nothing was committed or merged.

Catalog storage is instance-wide, while watch-history recommendations and tracked exclusions remain account-specific. Source choices are returned from the database, so future creators do not require hardcoded UI options. Settings now includes account-specific critic following and channel-check scheduling; see below.

Database migration validation: 3 creators, 3 videos and 11 picks preserved; SQLite integrity check passed with zero foreign-key violations. Existing user tracking, ratings, preferences and integrations matched the pre-migration backup. New tests cover fresh migration, migration reruns preserving edits, database-driven sources, multiple-creator attribution, uniqueness, foreign keys and cascade behavior. Browser QA confirmed source selection survives availability refresh with exact chapter links.

Local pre-migration backup: /home/rspark/Work/sofa-review-tools/sqlite.db.before-creator-tables-20261005-125335.


## Personal critic settings and channel checks

Settings → Account → Critics and creators lets each account select any combination of catalog critics, opt into all future catalog additions, or deselect everyone for watch-history-only recommendations. Choices persist in SQLite appSettings using account-scoped keys. Selecting an individual Home source cannot bypass these preferences. Channel credit links remain visible.

Critic scanning is controlled by administrators. Only admins see the Manual / Hourly / Daily (default) / Weekly frequency controls and Check now. Manual refresh enforces the admin role with a fresh session lookup. Schedule changes likewise require a fresh admin-role check, while every account can still change personal critic selections without changing scan frequency. The server evaluates due schedules every 15 minutes using only current administrator accounts from the database; non-admin preferences never initiate scanning, and demoted admins are excluded on the next evaluation. Manual mode disables automatic scanning for that administrator. Existing frequencies and creator selections are preserved. Home's Refresh recommendations button refreshes availability and does not start critic scanning. Shared in-flight channel checks and a persisted one-minute cooldown still avoid duplicate requests.

YouTube's public Atom feed supplies video IDs, titles and dates without a new API key. Requests use a fixed YouTube host, validated catalog channel IDs, no redirects, a 15-second timeout and a 1MB streamed-body cap. XML is parsed strictly, rejects declarations/entities, and verifies channel identity. A valid empty feed is accepted. Discovered metadata is stored in the new creatorFeedEntries table with unique creator/video keys and cascading foreign keys; the UI lists the 20 latest entries belonging to followed critics, linked to the original YouTube videos. Feed windows are limited and do not provide exhaustive backfill.

A newly discovered video is **not a verified movie recommendation**. The Settings list explicitly labels recommendation review as required. New movie picks still require endorsement evidence and exact TMDB identity before being added to creatorVideos/creatorPicks; local AI checks public descriptions/captions when configured, as described below. This protects against treating a negative or general review as a positive recommendation. Home's Refresh recommendations button separately refreshes its existing recommendation feed.

Migration 20261005183029_groovy_shaman is additive and introduces only creatorFeedEntries. No existing libraries or catalog picks are removed or rewritten. Tests cover account isolation, selected sources, scheduling intervals/manual mode, Atom parsing/identity, video uniqueness, preserving picks and status on failure.


Personal settings validation: all required lint, format:check, check-types and test commands passed without errors or warnings (527 tests). Live feeds for all three creators returned HTTP 200 and parsed 15 entries each. Isolated browser QA verified critic deselection, weekly schedule persistence after reload, live Check now results, channel attribution, Home filtering and a 390px layout without horizontal overflow or JavaScript errors. Local database integrity and foreign-key checks passed; all 11 curated picks remain intact. Main web/API health checks returned HTTP 200. Test servers and browser were stopped; no commits or merges were made.

## Adding a critic

Administrators can use Settings → Account → Critics and creators → Add a critic. Enter a display name and a canonical YouTube channel URL (`https://www.youtube.com/channel/UC…`); handles and video links are not accepted. No feed request is required to save a channel, so a temporary YouTube feed outage does not block catalog additions. The URL format is validated; channel ownership and endorsement are not inferred.

The authenticated endpoint `account.addCritic` enforces Sofa's administrator middleware. Catalog additions persist in the existing recommendationCreators table with UUIDv7 IDs and stable generated source slugs. Duplicate channel URLs are rejected (including trailing-slash variants), and the catalog is capped at 50 channels to match the refresh scheduler. No migration is required. Users following all critics automatically include new additions; other users can select them from their existing checkboxes. An added channel initially has no curated picks. Added channels enter the same scheduled discovery and source-verification flow as the existing catalog.

## Expanded curated picks (2026-10-05)

The five additional shared catalog channels now have 13 manually verified starter picks, taking the local catalog from 11 to 24 picks. These are selected examples, not exhaustive or automatically refreshed lists. `creator-picks-expansion.json` records the original video title, publication date, channel URL, evidence summary, exact TMDB movie identity and timestamp for every imported pick. Public captions were reviewed without copying transcripts into the repository.

- Dan Murrell: The Substance, The Brutalist and Nosferatu (2024), his top three in [The Best & Worst Movies of 2024!](https://www.youtube.com/watch?v=-ujfuk6QAbo). The worst-film section is excluded.
- Sean Chandler: The Wild Robot, Dune: Part Two and Super/Man: The Christopher Reeve Story, his top three in [The Best Movies of 2024](https://www.youtube.com/watch?v=V1GKsQ6372U).
- Breakfast All Day: Challengers, Dune: Part Two and Robot Dreams from [BEST MOVIES OF 2024 SO FAR](https://www.youtube.com/watch?v=uVN9j7Z44Pg). These are channel-level selections from Christy Lemire and Alonso Duralde, not a claimed joint ranking.
- Kermode and Mayo's Take: The Substance, Love Lies Bleeding and Anora, Mark Kermode's top three in [Best Films of 2024](https://www.youtube.com/watch?v=hIXJ88Tu9r0). Listener lists earlier in the video are excluded.
- RedLetterMedia: Dinner in America from [Mike and Jay Talk About Dinner in America](https://www.youtube.com/watch?v=y3ZLDfB2N3g). The opening explicitly discusses recommending this film; other mentioned movies are excluded.

The local database was backed up before the transactional import. Existing picks were preserved; SQLite integrity and foreign-key checks passed. Import reruns skip existing video/movie pairs. Channel additions and these picks are local database data; the JSON manifest is an audit/recovery record, not a runtime recommendation source or migration. Availability remains independently checked against current US offers.

## Local AI recommendation checks (2026-10-06)

Check now and scheduled checks use the same flow: discover followed creators’ recent uploads, verify video/channel identity, retrieve public descriptions and available English captions, then attempt up to three eligible videos per request from all persisted discoveries. The scan queue is separate from the latest-twenty UI list: it rotates across followed creators, resumes after the last attempted creator, and prioritizes unchecked videos and least-recently-attempted due retries. Completed checks and future cooldowns are excluded. Feed discovery still does not provide exhaustive history backfill. A channel-page fallback handles unavailable Atom feeds; it checks the three newest channel uploads and verifies each publication date and author. No video downloads, login cookies or paid AI API are used.

Set `CREATOR_PICK_MODEL=qwen3:4b` and `CREATOR_CAPTION_TOOL=/usr/bin/yt-dlp` in the server environment. Ollama must be running at `127.0.0.1:11434`. On this PC the runtime/model live under `/home/rspark/Work/sofa-ai`; restart it with `/home/rspark/Work/sofa-ai/start-model.sh`. The model is pretrained, not trained on the user’s library. The environment configuration is local and ignored by Git. No reboot startup service is installed.

Extraction uses structured output, source line spans and an independent endorsement verification pass. Movie titles must appear in the quoted source evidence; generated timestamps are discarded in favor of source timestamps. Listener lists, negative reviews and mere coverage are excluded. Exact TMDB title/original-title matching and any stated release year must produce one unambiguous result; multi-page search results are conservatively held for review. Valid picks are added transactionally without replacing curated picks. Automated provenance (method, model, checked time and short source evidence) is saved in appSettings under each new pick’s ID. Existing curated picks remain separate from these automated audit records.

The UI reports videos checked, picks added and each video’s saved/review/failed status. Home is invalidated after Check now. Missing captions, unavailable services and uncertain endorsement/identity preserve existing picks. Reviews are statuses, not an implemented approval editor. Completed reviews are not automatically reprocessed; failed checks can retry. Without a configured model, only explicit quoted-title/year endorsement rules run.

This is a conservative initial integration, not exhaustive extraction. At most ten proposals per video are considered. Model input is bounded to approximately 24,000 characters (the beginning and ending of long sources); middle sections can be missed. Live mixed viewer/critic lists were held for review, and straightforward direct endorsements passed. A small model can still misclassify context, so automated picks should be audited against their linked video and provenance. Captions are temporary and removed after processing; full transcripts are not stored or shipped.


## Channel audit linkage (2026-10-07)

Every requested channel refresh creates and finalizes a `creatorChannelChecks` row with the requesting account, manual/scheduled trigger, start/end times, source (`atom`, `channel_page`, or `cache`), discovery count and controlled failure code. Shared requests and cooldown returns have their own audit rows without duplicate network requests. `videosFound` counts returned entries, including previously known entries; a cooldown discovers zero entries, while a shared request reports the shared discovery count. Channel success describes discovery only; video/model outcomes remain separate.

Video checks started by the refresh receive its channel audit ID, so movie observations trace through the video to the channel request. Backlog checks link to the refresh attempting them. Completed or coalesced video work retains its existing audit ownership. Startup recovery marks unfinished channel/video rows failed with `interrupted`, makes unfinished video work eligible for retry, and preserves completed rows and existing picks. Historical checks are not retroactively assigned invented channel attempts.


## Check diagnostics (2026-10-07)

The shared API check schema retains diagnostic code, retry eligibility time, source kind, detected discussion/endorsement counts, verified picks added, and available/analyzed text character counts. Optional fields preserve compatibility with older results. Settings shows translated messages for caption limits/unavailability, evidence retrieval, model availability/incomplete/invalid output, movie lookup failures and interrupted checks; unknown codes receive a generic message. Raw reason/code strings are not rendered. Detected endorsements are distinct from verified saved picks.

Description-only and omitted-text checks show coverage limits even when some picks were saved. Retry dates indicate eligibility, not a promised execution time; admin schedules and channel/provider cooldowns still govern execution. Unchecked videos stay pending. Character coverage is recorded after successful analysis: explicit rules read all available text, while model input remains bounded. These details describe available source text, not exhaustive analysis of an entire video.


## Stable recommendation scrolling (2026-10-07)

Recommendation pages now use opaque string cursors. Omit the cursor or send null to start a fresh session. Candidate ordering and personal candidate metadata are retained for that session, while tracked titles and US availability are checked afresh for each batch. Tracking an earlier title or adding new recommendations cannot shift the cursor past an unseen title. New candidates appear on refresh. Empty filtered batches still advance, and only the current batch needs creator metadata hydration.

Cursors are scoped to the authenticated account, recommendation source, availability filter and critic selections. Sessions expire after one hour, are held in server memory, and are limited to four per account and 100 globally. Expiry, eviction, changed selections or a server restart return RECOMMENDATION_SESSION_EXPIRED; the UI keeps already loaded cards and offers Refresh recommendations to restart from the first batch. Ordinary page failures retain Retry. Explicit refresh starts a new scrolling session rather than reloading every previously loaded batch. Native requests without a cursor continue receiving the first batch.


## Scheduled job results (2026-10-07)

The critic scheduler checks all due administrator accounts and aggregates their results. Channel or video-check failure marks that account's refresh incomplete. Successful accounts retain their results even if another fails. After processing all due accounts, any incomplete result throws a controlled aggregate error so the existing cron wrapper records `error` in System Health instead of `success`; the summary counts failed account refreshes, not channels. Partial failures also use `error` because cron has no partial-success outcome. Unexpected exceptions are isolated to the affected account, which retains its last success, records a failed attempt, and follows the existing retry interval. Evaluations with no due accounts remain successful no-ops. Manual Check now continues returning account status directly.


## Shared YouTube backoff (2026-10-07)

All creator YouTube HTTP requests check one persisted provider-wide cooldown before starting: Atom feeds, channel listings, watch metadata and captions. HTTP 429 stops fallback and records Retry-After eligibility (seconds or HTTP date), with a one-hour default for missing/invalid headers and a 24-hour upper bound. A later cooldown cannot shorten an existing pause. Existing caption cooldown settings are also honored before watch-page requests. Subtitle extraction checks the same cooldown before starting, disables download/extractor/fragment retries, and records a shared pause if its output reports HTTP 429.

Caption throttling can preserve already retrieved description evidence and verified picks while marking the source partial and scheduling a retry. Further channel/video processing pauses without more requests. Watch/feed throttling produces controlled rate-limit diagnostics; existing picks remain intact. The pause survives server restart and requests become eligible once it expires, subject to administrator schedules and channel cooldowns. Requests already in flight when a different request receives 429 can finish; the limiter blocks subsequent requests. The separate official-API inventory tool remains separate from runtime critic scanning.
