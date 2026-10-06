CREATE TABLE `creatorPicks` (
	`id` text PRIMARY KEY,
	`videoId` text NOT NULL,
	`tmdbId` integer NOT NULL,
	`type` text DEFAULT 'movie' NOT NULL,
	`movieTitle` text NOT NULL,
	`startSeconds` integer,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT `fk_creatorPicks_videoId_creatorVideos_id_fk` FOREIGN KEY (`videoId`) REFERENCES `creatorVideos`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `creatorVideos` (
	`id` text PRIMARY KEY,
	`creatorId` text NOT NULL,
	`videoUrl` text NOT NULL,
	`videoTitle` text NOT NULL,
	`publishedAt` text NOT NULL,
	`evidenceUrl` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT `fk_creatorVideos_creatorId_recommendationCreators_id_fk` FOREIGN KEY (`creatorId`) REFERENCES `recommendationCreators`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `recommendationCreators` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`channelUrl` text NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creatorPicks_videoId_tmdbId_type` ON `creatorPicks` (`videoId`,`tmdbId`,`type`);--> statement-breakpoint
CREATE INDEX `creatorPicks_tmdbId_type` ON `creatorPicks` (`tmdbId`,`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `creatorVideos_creatorId_videoUrl` ON `creatorVideos` (`creatorId`,`videoUrl`);
--> statement-breakpoint
-- Creator starter catalog (one-time migration seed)
INSERT INTO "recommendationCreators" ("id", "slug", "name", "channelUrl", "sortOrder", "createdAt", "updatedAt") VALUES ('01a10cff-8d3a-70d1-9e9c-4b9cdd554650', 'jeremy-jahns', 'Jeremy Jahns', 'https://www.youtube.com/channel/UC7v3-2K1N84V67IF-WTRG-Q', 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "recommendationCreators" ("id", "slug", "name", "channelUrl", "sortOrder", "createdAt", "updatedAt") VALUES ('01a10cff-8d3a-70d1-9e9c-4b9d1e6b1c9e', 'chris-stuckmann', 'Chris Stuckmann', 'https://www.youtube.com/channel/UCCqEeDAUf4Mg0GgEN658tkA', 1, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "recommendationCreators" ("id", "slug", "name", "channelUrl", "sortOrder", "createdAt", "updatedAt") VALUES ('01a10cff-8d3a-70d1-9e9c-4b9e0aa8da48', 'flick-connection', 'Flick Connection', 'https://www.youtube.com/channel/UCT09qC2vwlbJvofZRIdLalg', 2, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "creatorVideos" ("id", "creatorId", "videoUrl", "videoTitle", "publishedAt", "evidenceUrl", "createdAt", "updatedAt") VALUES ('01a10cff-8d3a-70d1-9e9c-4b9fa46af4b6', '01a10cff-8d3a-70d1-9e9c-4b9cdd554650', 'https://www.youtube.com/watch?v=nOPiMHx0Slo', 'Top 10 BEST Movies 2023', '2023-12-26', 'https://www.youtube.com/watch?v=nOPiMHx0Slo', CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "creatorPicks" ("id", "videoId", "tmdbId", "type", "movieTitle", "startSeconds", "sortOrder", "createdAt", "updatedAt") VALUES ('01a10cff-8d3a-70d1-9e9c-4ba0f74e7539', '01a10cff-8d3a-70d1-9e9c-4b9fa46af4b6', 603692, 'movie', 'John Wick: Chapter 4', NULL, 0, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "creatorPicks" ("id", "videoId", "tmdbId", "type", "movieTitle", "startSeconds", "sortOrder", "createdAt", "updatedAt") VALUES ('01a10cff-8d3a-70d1-9e9c-4ba1018c4d50', '01a10cff-8d3a-70d1-9e9c-4b9fa46af4b6', 940721, 'movie', 'Godzilla Minus One', NULL, 1, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "creatorPicks" ("id", "videoId", "tmdbId", "type", "movieTitle", "startSeconds", "sortOrder", "createdAt", "updatedAt") VALUES ('01a10cff-8d3a-70d1-9e9c-4ba28537f219', '01a10cff-8d3a-70d1-9e9c-4b9fa46af4b6', 872585, 'movie', 'Oppenheimer', NULL, 2, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "creatorVideos" ("id", "creatorId", "videoUrl", "videoTitle", "publishedAt", "evidenceUrl", "createdAt", "updatedAt") VALUES ('01a10cff-8d3a-70d1-9e9c-4ba3612a0a70', '01a10cff-8d3a-70d1-9e9c-4b9d1e6b1c9e', 'https://www.youtube.com/watch?v=oCZM6UoZdOQ', 'The Best Movies of 2024', '2024-12-27', 'https://boxd.it/AVrZE', CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "creatorPicks" ("id", "videoId", "tmdbId", "type", "movieTitle", "startSeconds", "sortOrder", "createdAt", "updatedAt") VALUES ('01a10cff-8d3a-70d1-9e9c-4ba4692a359a', '01a10cff-8d3a-70d1-9e9c-4ba3612a0a70', 1019939, 'movie', 'Hundreds of Beavers', NULL, 3, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "creatorPicks" ("id", "videoId", "tmdbId", "type", "movieTitle", "startSeconds", "sortOrder", "createdAt", "updatedAt") VALUES ('01a10cff-8d3a-70d1-9e9c-4ba596ce86dd', '01a10cff-8d3a-70d1-9e9c-4ba3612a0a70', 1155828, 'movie', 'Sing Sing', NULL, 4, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "creatorPicks" ("id", "videoId", "tmdbId", "type", "movieTitle", "startSeconds", "sortOrder", "createdAt", "updatedAt") VALUES ('01a10cff-8d3a-70d1-9e9c-4ba69c3bfd87', '01a10cff-8d3a-70d1-9e9c-4ba3612a0a70', 1158915, 'movie', 'Dìdi (弟弟)', NULL, 5, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "creatorPicks" ("id", "videoId", "tmdbId", "type", "movieTitle", "startSeconds", "sortOrder", "createdAt", "updatedAt") VALUES ('01a10cff-8d3a-70d1-9e9c-4ba791a8ac6d', '01a10cff-8d3a-70d1-9e9c-4ba3612a0a70', 1184918, 'movie', 'The Wild Robot', NULL, 6, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "creatorVideos" ("id", "creatorId", "videoUrl", "videoTitle", "publishedAt", "evidenceUrl", "createdAt", "updatedAt") VALUES ('01a10cff-8d3b-756f-82e7-90772abf507e', '01a10cff-8d3a-70d1-9e9c-4b9e0aa8da48', 'https://www.youtube.com/watch?v=UKz65tlZsCY', '20 TERRIFICALLY TWISTED SCI-FI Flicks on Prime!', '2024-12-20', 'https://www.youtube.com/watch?v=UKz65tlZsCY', CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "creatorPicks" ("id", "videoId", "tmdbId", "type", "movieTitle", "startSeconds", "sortOrder", "createdAt", "updatedAt") VALUES ('01a10cff-8d3b-756f-82e7-9078401d79da', '01a10cff-8d3b-756f-82e7-90772abf507e', 431, 'movie', 'Cube', 1160, 7, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "creatorPicks" ("id", "videoId", "tmdbId", "type", "movieTitle", "startSeconds", "sortOrder", "createdAt", "updatedAt") VALUES ('01a10cff-8d3b-756f-82e7-90798c73b2c8', '01a10cff-8d3b-756f-82e7-90772abf507e', 2666, 'movie', 'Dark City', 1378, 8, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "creatorPicks" ("id", "videoId", "tmdbId", "type", "movieTitle", "startSeconds", "sortOrder", "createdAt", "updatedAt") VALUES ('01a10cff-8d3b-756f-82e7-907a3e5e55d8', '01a10cff-8d3b-756f-82e7-90772abf507e', 3509, 'movie', 'A Scanner Darkly', 1099, 9, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));

--> statement-breakpoint
INSERT INTO "creatorPicks" ("id", "videoId", "tmdbId", "type", "movieTitle", "startSeconds", "sortOrder", "createdAt", "updatedAt") VALUES ('01a10cff-8d3b-756f-82e7-907b54a7d019', '01a10cff-8d3b-756f-82e7-90772abf507e', 799379, 'movie', 'Project Wolf Hunting', 374, 10, CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER));
