-- #3330 案 B counter 縮約: per-date login_bonuses を login_streaks (counter) に fold してから旧表を DROP。
-- fold 論理 = domain deriveStreakCounter (最新ログイン日を終端に連続 run を数える) と同一。
-- gaps-and-islands: 降順 row_number に対し login_date = max_d - (rn-1) を満たす行だけが最新連続 run。
-- updated_at は run 内の最新 created_at を保全する (lastClaimedAt 表示の連続性)。
--
-- fresh-DB-safe guard (#3925): 現 schema は login_bonuses を作らないため、fresh provision
-- (staging / 新規 NUC / DR 再構築) では fold の SELECT が未作成 table を参照して失敗する。
-- pure SQL で guard するため空 shell を IF NOT EXISTS で先置きする (既存 DB では no-op、
-- fresh DB では 0 行 fold の no-op → 末尾 DROP IF EXISTS で shell ごと撤去)。DO ブロックは
-- DSQL 互換が未確証のため不採用。列は fold クエリが参照する 4 列のみ (旧 0000 定義と同型)。
CREATE TABLE IF NOT EXISTS "login_bonuses" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"login_date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_bonuses_family_id_child_id_login_date_pk" PRIMARY KEY("family_id","child_id","login_date")
);
--> statement-breakpoint
INSERT INTO "login_streaks" ("family_id", "child_id", "last_login_date", "current_streak", "updated_at")
SELECT s.family_id, s.child_id, max(s.login_date), count(*)::int, max(s.created_at)
FROM (
	SELECT family_id, child_id, login_date, created_at,
		row_number() OVER (PARTITION BY family_id, child_id ORDER BY login_date DESC) AS rn,
		max(login_date::date) OVER (PARTITION BY family_id, child_id) AS max_d
	FROM login_bonuses
) s
WHERE s.login_date::date = s.max_d - (s.rn - 1)::int
GROUP BY s.family_id, s.child_id
ON CONFLICT (family_id, child_id) DO NOTHING;
--> statement-breakpoint
DROP TABLE IF EXISTS "login_bonuses" CASCADE;
