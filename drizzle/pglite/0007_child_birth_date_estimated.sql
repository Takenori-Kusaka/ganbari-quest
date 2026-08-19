-- #4718: 年齢だけで登録した子供が本番 (pg-core: cloud DSQL / NUC PGlite) で「0歳」になる是正。
-- children 表は age 列を持たず birth_date が唯一の年齢ソース (compute-on-read) だが、初回
-- セットアップは年齢しか聞かないため birth_date NULL = 0 歳で読めていた。
-- 以後は年齢だけの登録でも推定誕生日 (JST 今年 − 年齢 の 1 月 1 日) を birth_date に保存し、
-- birth_date_estimated=true で実誕生日 (誕生日ボーナス / 🎂 表示の対象) と区別する
-- (規約 SSOT: src/lib/domain/child-age.ts)。
--
-- DSQL 互換のため 0006 と同じ 3 手順に分解する (ADD COLUMN に列制約を付けない /
-- SET DEFAULT はメタデータのみ / backfill は UPDATE)。NOT NULL は Drizzle schema
-- (`boolean('birth_date_estimated').notNull().default(false)`) と app 層で担保する。
-- IF NOT EXISTS ガード: 再適用され得る環境 (fresh provision 済み staging 等) で冪等にする。
ALTER TABLE "children" ADD COLUMN IF NOT EXISTS "birth_date_estimated" boolean;
--> statement-breakpoint
ALTER TABLE "children" ALTER COLUMN "birth_date_estimated" SET DEFAULT false;
--> statement-breakpoint
-- 既存行の backfill (1): 実誕生日を持つ行は estimated=false。冪等 (WHERE IS NULL)。
UPDATE "children" SET "birth_date_estimated" = false WHERE "birth_date_estimated" IS NULL;
--> statement-breakpoint
-- 既存行の backfill (2): birth_date NULL の旧行 (本番で既に 0 歳表示の子)。age 情報は登録時の
-- ui_mode (年齢帯) にしか残っていないため、帯の代表年齢 (representativeAgeForUiMode と同値:
-- baby 1 / preschool 4 / elementary 9 / junior 14 / senior 17) から推定誕生日を合成し
-- estimated=true にする。保護者は管理画面の編集で年齢 / 誕生日を修正できる。
-- 冪等 (WHERE birth_date IS NULL)。JST 暦日基準 (AT TIME ZONE 'Asia/Tokyo'、TZ 非依存)。
-- ⚠️ DSQL は 1 トランザクションで 3,000 行までしか変更できない。children は家族あたり数行で
--    現行規模では 1 文で収まるが、3,000 行を超える規模では本形で書かない (バッチ分割が要る)。
UPDATE "children"
SET "birth_date" = (
		to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY')::int
		- CASE "ui_mode"
			WHEN 'baby' THEN 1
			WHEN 'preschool' THEN 4
			WHEN 'elementary' THEN 9
			WHEN 'junior' THEN 14
			WHEN 'senior' THEN 17
			ELSE 9
		END
	)::text || '-01-01',
	"birth_date_estimated" = true
WHERE "birth_date" IS NULL;
