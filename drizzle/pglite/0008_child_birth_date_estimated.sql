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
--
-- ⚠️ 誤差の上限について (QM #4729 レビューで明文化):
--    ui_mode_manually_set = true の行では ui_mode が**年齢を表していない**。保護者が
--    読みやすさ等の理由で帯を手動変更した子は、帯の代表年齢と実年齢が最大 16 年ずれうる
--    (senior の子に preschool を選んだ場合など)。この母集団に対する誤差は
--    「帯の幅 ±3 歳」では **ない**。
--    それでも合成するのは、pg 系 backend には age 列が無く birth_date NULL のままだと
--    **0 歳表示 (= baby 向けの内容が中高生に出る)** が続くためで、0 歳より帯由来の推定値の方が
--    実害が小さいという判断による。全行 birth_date_estimated = true が付き、保護者は
--    管理画面の編集でいつでも修正できる。ずれの是正は保護者の 1 操作で完了する。
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
