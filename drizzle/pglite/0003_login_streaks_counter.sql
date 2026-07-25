-- #3946: IF NOT EXISTS ガード — journal `when` 逆転是正 (0003/0004 の when 引き上げ) により、
-- 0003 適用済み環境 (fresh provision 済み staging 等) でも migrator が本 file を再適用し得るため。
CREATE TABLE IF NOT EXISTS "login_streaks" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"last_login_date" text NOT NULL,
	"current_streak" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_streaks_family_id_child_id_pk" PRIMARY KEY("family_id","child_id")
);
