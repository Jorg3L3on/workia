-- WRK-I5-2: compensation frozen in each contract (daily and monthly salary, payment
-- method, frequency and pay day). Additive: nullable columns, existing contracts keep none.
CREATE TYPE "public"."payment_method" AS ENUM('transferencia', 'efectivo', 'cheque');--> statement-breakpoint
CREATE TYPE "public"."pay_frequency" AS ENUM('semanal', 'quincenal', 'mensual');--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "salario_diario" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "salario_mensual" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "forma_pago" "payment_method";--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "periodicidad_pago" "pay_frequency";--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "dia_pago" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_salario_check" CHECK ("salario_diario" IS NULL OR "salario_diario" > 0);
