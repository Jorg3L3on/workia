-- WRK-I5-3: schedule by blocks (days, entry, exit, optional meal) and a rest day per
-- person, frozen in each contract. Additive: the four simple fields stay (mirrored from
-- the first block) and rows without blocks keep reading as the simple schedule.
CREATE TYPE "public"."week_day" AS ENUM('lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom');--> statement-breakpoint
ALTER TABLE "person_schedules" ADD COLUMN "blocks" jsonb;--> statement-breakpoint
ALTER TABLE "person_schedules" ADD COLUMN "rest_day" "week_day";--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "schedule_blocks" jsonb;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "schedule_rest_day" "week_day";--> statement-breakpoint
ALTER TABLE "person_schedules" ADD CONSTRAINT "person_schedules_blocks_array" CHECK ("blocks" IS NULL OR jsonb_typeof("blocks") = 'array');--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_schedule_blocks_array" CHECK ("schedule_blocks" IS NULL OR jsonb_typeof("schedule_blocks") = 'array');
