CREATE TABLE `fiscal_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`locked_at` text,
	`locked_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_periods_org_dates_uq` ON `fiscal_periods` (`organization_id`,`starts_on`,`ends_on`);--> statement-breakpoint
CREATE INDEX `fiscal_periods_org_range_idx` ON `fiscal_periods` (`organization_id`,`starts_on`,`ends_on`);--> statement-breakpoint
ALTER TABLE `payment_allocations` ADD `reversed_at` text;