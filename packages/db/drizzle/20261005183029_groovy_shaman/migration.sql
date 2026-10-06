CREATE TABLE `creatorFeedEntries` (
	`id` text PRIMARY KEY,
	`creatorId` text NOT NULL,
	`videoId` text NOT NULL,
	`videoTitle` text NOT NULL,
	`publishedAt` text NOT NULL,
	`discoveredAt` integer NOT NULL,
	CONSTRAINT `fk_creatorFeedEntries_creatorId_recommendationCreators_id_fk` FOREIGN KEY (`creatorId`) REFERENCES `recommendationCreators`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creatorFeedEntries_creatorId_videoId` ON `creatorFeedEntries` (`creatorId`,`videoId`);