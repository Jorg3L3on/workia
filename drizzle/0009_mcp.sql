-- WRK-I1-1: Workia MCP connector. OAuth clients, authorization codes, connections
-- (OAuth grants and personal tokens), the tool call log, idempotency replies,
-- per-company settings and rate-limit counters. Every table but mcp_clients and
-- rate_limits belongs to one company and gets the RLS policy of 0018.
-- The number 0009 was reserved in Plania before 0010-0018 existed; the registry
-- applies by tag, so it runs after 0018 (docs/migrations.md).
CREATE TABLE "mcp_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"registration" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"grant_types" text[] NOT NULL,
	"token_endpoint_auth_method" text NOT NULL,
	"client_uri" text,
	"logo_uri" text,
	"client_secret_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_clients_client_id_unique" UNIQUE("client_id")
);--> statement-breakpoint
CREATE TABLE "mcp_auth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"scopes" text[] NOT NULL,
	"code_challenge" text NOT NULL,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "mcp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"client_id" text,
	"client_name" text NOT NULL,
	"is_chatgpt" boolean DEFAULT false NOT NULL,
	"scopes" text[] NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"refresh_token_prefix" text,
	"refresh_token_hash" text,
	"refresh_expires_at" timestamp with time zone,
	"rotated_refresh" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resource" text,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_connections_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "mcp_connections_kind_check" CHECK ("kind" IN ('oauth', 'pat'))
);--> statement-breakpoint
CREATE TABLE "mcp_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" uuid,
	"tool" text NOT NULL,
	"result" text NOT NULL,
	"error_code" text,
	"latency_ms" integer NOT NULL,
	"request_id" text,
	"pii_unmasked" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tool_calls_result_check" CHECK ("result" IN ('success', 'error', 'denied'))
);--> statement-breakpoint
CREATE TABLE "mcp_idempotency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"key" text NOT NULL,
	"tool" text NOT NULL,
	"args_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE TABLE "mcp_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"writes_enabled" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);--> statement-breakpoint
ALTER TABLE "mcp_auth_codes" ADD CONSTRAINT "mcp_auth_codes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_auth_codes" ADD CONSTRAINT "mcp_auth_codes_client_id_mcp_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_auth_codes" ADD CONSTRAINT "mcp_auth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_client_id_mcp_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_clients"("client_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_company_connection_fk" FOREIGN KEY ("company_id","connection_id") REFERENCES "public"."mcp_connections"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_idempotency" ADD CONSTRAINT "mcp_idempotency_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_idempotency" ADD CONSTRAINT "mcp_idempotency_company_connection_fk" FOREIGN KEY ("company_id","connection_id") REFERENCES "public"."mcp_connections"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_settings" ADD CONSTRAINT "mcp_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_settings" ADD CONSTRAINT "mcp_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_auth_codes_code_hash_unique" ON "mcp_auth_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "mcp_auth_codes_company_id_idx" ON "mcp_auth_codes" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_connections_token_prefix_unique" ON "mcp_connections" USING btree ("token_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_connections_refresh_token_prefix_unique" ON "mcp_connections" USING btree ("refresh_token_prefix");--> statement-breakpoint
CREATE INDEX "mcp_connections_company_user_idx" ON "mcp_connections" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "mcp_tool_calls_company_occurred_idx" ON "mcp_tool_calls" USING btree ("company_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "mcp_tool_calls_connection_occurred_idx" ON "mcp_tool_calls" USING btree ("connection_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_idempotency_company_connection_key_unique" ON "mcp_idempotency" USING btree ("company_id","connection_id","key");--> statement-breakpoint
CREATE INDEX "mcp_idempotency_expires_at_idx" ON "mcp_idempotency" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
ALTER TABLE "mcp_auth_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "mcp_auth_codes_company_isolation" ON "mcp_auth_codes" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "mcp_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "mcp_connections_company_isolation" ON "mcp_connections" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "mcp_tool_calls_company_isolation" ON "mcp_tool_calls" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "mcp_idempotency" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "mcp_idempotency_company_isolation" ON "mcp_idempotency" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "mcp_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "mcp_settings_company_isolation" ON "mcp_settings" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
-- A bearer credential arrives before anyone knows its company. This function only
-- answers "which company holds this lookup value" (a token prefix, a rotated refresh
-- prefix or an authorization code hash), so the app can then read the row under RLS
-- scoped to that company. It runs as the owner, outside RLS, and returns nothing else.
CREATE FUNCTION "mcp_credential_company"("lookup" text) RETURNS uuid
	LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
	AS $$
		SELECT company_id FROM mcp_connections WHERE token_prefix = lookup OR refresh_token_prefix = lookup
		UNION ALL
		SELECT company_id FROM mcp_connections WHERE rotated_refresh @> jsonb_build_array(jsonb_build_object('prefix', lookup))
		UNION ALL
		SELECT company_id FROM mcp_auth_codes WHERE code_hash = lookup
		LIMIT 1
	$$;--> statement-breakpoint
-- The app role (0018) gets data privileges on the new tables through default privileges
-- when the owner created them; grant again in case those defaults were not in place.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workia_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "mcp_clients", "mcp_auth_codes", "mcp_connections", "mcp_tool_calls", "mcp_idempotency", "mcp_settings", "rate_limits" TO workia_app;
		GRANT EXECUTE ON FUNCTION "mcp_credential_company"(text) TO workia_app;
	END IF;
END $$;
