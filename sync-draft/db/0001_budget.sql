CREATE TABLE `budget_documents` (
	`user_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL
);
