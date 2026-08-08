-- #4410: 達成祝福 (SiblingCelebration) を「見せた」記録。NULL = 未表示。
-- 祝福表示の停止条件 SSOT (reward_claimed とは独立)。既存行は NULL = 未表示として扱う。
-- IF NOT EXISTS ガード: 0003/0004 と同様、再適用され得る環境 (fresh provision 済み staging 等) で冪等にする。
ALTER TABLE "child_challenges" ADD COLUMN IF NOT EXISTS "celebration_shown_at" timestamp with time zone;
