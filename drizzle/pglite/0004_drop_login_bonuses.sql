-- #3330 案 B counter 縮約: per-date login_bonuses を login_streaks (counter) に fold してから旧表を DROP。
-- fold 論理 = domain deriveStreakCounter (最新ログイン日を終端に連続 run を数える) と同一。
-- gaps-and-islands: 降順 row_number に対し login_date = max_d - (rn-1) を満たす行だけが最新連続 run。
-- updated_at は run 内の最新 created_at を保全する (lastClaimedAt 表示の連続性)。
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
DROP TABLE "login_bonuses" CASCADE;
