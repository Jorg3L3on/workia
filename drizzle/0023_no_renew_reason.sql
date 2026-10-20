-- WRK-I5-6: why a contract was not renewed, in its own column (it lived in the audit
-- summary until now). Nullable: earlier decisions keep theirs in the audit log.
ALTER TABLE "contracts" ADD COLUMN "no_renew_reason" text;
