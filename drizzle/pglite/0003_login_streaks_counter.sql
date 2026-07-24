CREATE TABLE "login_streaks" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"last_login_date" text NOT NULL,
	"current_streak" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_streaks_family_id_child_id_pk" PRIMARY KEY("family_id","child_id")
);
