-- #4407: ごほうび交換申請に個数 (quantity) を持たせる。
-- 単位量のごほうび (「ゲーム時間 +30分」等) は「単位 × 個数」で消費されるため 1 申請 = N 個で表す
-- (申請を N 行に増やさない = 親の承認操作も 1 件のまま)。既存行は 1 個として backfill される。
-- IF NOT EXISTS ガード: 0003 / 0004 と同様、fresh provision 済み環境での再適用に備える。
ALTER TABLE "reward_redemption_requests" ADD COLUMN IF NOT EXISTS "quantity" integer DEFAULT 1 NOT NULL;
