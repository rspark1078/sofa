CREATE TABLE `creatorChannelChecks` (
	`id` text PRIMARY KEY,
	`creatorId` text NOT NULL,
	`requestedByUserId` text,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`source` text,
	`videosFound` integer DEFAULT 0 NOT NULL,
	`errorCode` text,
	`startedAt` integer NOT NULL,
	`finishedAt` integer,
	CONSTRAINT `fk_creatorChannelChecks_creatorId_recommendationCreators_id_fk` FOREIGN KEY (`creatorId`) REFERENCES `recommendationCreators`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_creatorChannelChecks_requestedByUserId_user_id_fk` FOREIGN KEY (`requestedByUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `creatorMovieObservations` (
	`id` text PRIMARY KEY,
	`videoCheckId` text NOT NULL,
	`movieTitle` text NOT NULL,
	`releaseYear` integer,
	`assessment` text NOT NULL,
	`evidence` text NOT NULL,
	`startSeconds` integer,
	`tmdbId` integer,
	`imdbId` text,
	`matchStatus` text NOT NULL,
	`createdAt` integer NOT NULL,
	CONSTRAINT `fk_creatorMovieObservations_videoCheckId_creatorVideoChecks_id_fk` FOREIGN KEY (`videoCheckId`) REFERENCES `creatorVideoChecks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `creatorVideoChecks` (
	`id` text PRIMARY KEY,
	`creatorId` text NOT NULL,
	`channelCheckId` text,
	`videoId` text NOT NULL,
	`videoTitle` text NOT NULL,
	`publishedAt` text NOT NULL,
	`state` text NOT NULL,
	`stage` text NOT NULL,
	`model` text,
	`sourceKind` text,
	`sourceCharacters` integer DEFAULT 0 NOT NULL,
	`analyzedCharacters` integer DEFAULT 0 NOT NULL,
	`moviesDiscussed` integer DEFAULT 0 NOT NULL,
	`moviesRecommended` integer DEFAULT 0 NOT NULL,
	`picksAdded` integer DEFAULT 0 NOT NULL,
	`errorCode` text,
	`reason` text,
	`retryAt` integer,
	`startedAt` integer NOT NULL,
	`finishedAt` integer,
	CONSTRAINT `fk_creatorVideoChecks_creatorId_recommendationCreators_id_fk` FOREIGN KEY (`creatorId`) REFERENCES `recommendationCreators`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_creatorVideoChecks_channelCheckId_creatorChannelChecks_id_fk` FOREIGN KEY (`channelCheckId`) REFERENCES `creatorChannelChecks`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `creatorChannelChecks_creatorId_startedAt` ON `creatorChannelChecks` (`creatorId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `creatorMovieObservations_videoCheckId` ON `creatorMovieObservations` (`videoCheckId`);--> statement-breakpoint
CREATE INDEX `creatorMovieObservations_tmdbId` ON `creatorMovieObservations` (`tmdbId`);--> statement-breakpoint
CREATE INDEX `creatorMovieObservations_imdbId` ON `creatorMovieObservations` (`imdbId`);--> statement-breakpoint
CREATE INDEX `creatorVideoChecks_creatorId_videoId_startedAt` ON `creatorVideoChecks` (`creatorId`,`videoId`,`startedAt`);