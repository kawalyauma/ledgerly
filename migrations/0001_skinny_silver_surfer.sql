CREATE TABLE `payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`document_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_allocations_payment_document_uq` ON `payment_allocations` (`organization_id`,`payment_id`,`document_id`);--> statement-breakpoint
CREATE INDEX `payment_allocations_document_idx` ON `payment_allocations` (`organization_id`,`document_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`type` text NOT NULL,
	`number` text NOT NULL,
	`contact_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`control_account_id` text NOT NULL,
	`payment_date` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`reference` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`journal_entry_id` text,
	`idempotency_key` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`control_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_org_number_uq` ON `payments` (`organization_id`,`type`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_org_idempotency_uq` ON `payments` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `payments_org_date_idx` ON `payments` (`organization_id`,`payment_date`,`status`);--> statement-breakpoint
ALTER TABLE `document_lines` ADD `account_id` text NOT NULL REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `document_lines` ADD `tax_account_id` text REFERENCES accounts(id);