// scripts/lib/db/drizzle-journal-gate.mjs
// #3948 — drizzle journal (`meta/_journal.json`) の `when` 値域を機械検証する gate (pure function)。
//
// ## なぜ必要か (#3946 の class)
//
// drizzle-orm 公式 migrator (pg-core dialect) は
//   `Number(lastDbMigration.created_at) < migration.folderMillis` の時だけ migration を適用する。
// つまり journal の `when` は「適用済み最大値より大きいか」だけで判定され、**一度でも実時刻より
// 未来の `when` が本番 DB に記録されると、それ以降に drizzle-kit が生成する migration は
// (実時刻ベースの `when` を持つため) 永久に skip される**。
//
// 実際に #3946 で本番障害になった: 0002 の `when` が手書きの丸め値 1784500000000 (当時から見て
// 未来) で本番へ適用され、後から生成された 0003/0004 (`when` = 実生成時刻) が NUC で永久 skip →
// `login_streaks` 未作成 → `/preschool/home` が 500。
//
// #3947 が追加した [JM1] は **狭義単調増加のみ**を assert しており、末尾 entry に遠い未来値を
// 手書きすれば PASS したまま同型事故が再発する。本 gate はその穴 (値域の無検証) を塞ぐ。
//
// ## 検証ルール
//
//   [R1] `when` が未来でないこと (`when <= now`)
//        → #3946 の instance はこの 1 本で防げた。手書き未来値は「書いた瞬間の CI」で落ちる。
//   [R2] `when` が手書きの丸め値・連番でないこと (100 秒境界から 10ms 未満のズレを手書きと見なす)
//        → drizzle-kit は `Date.now()` をそのまま入れるため、この範囲に落ちる確率は約 1/10,000。
//   [R3] `when` が明らかに過去すぎないこと (プロジェクト開始前 = 明らかな手書き / 破損)
//   [R4] `idx` 連番 + `when` 狭義単調増加 ([JM1] と同じ不変条件。gate 単体で完結させる)
//
// ## grandfather (既存の手書き値の許容)
//
// `GRANDFATHERED_WHEN` の 3 値は #3946 以前に手書きで journal へ入り、**既に本番 DB の
// `__drizzle_migrations.created_at` として記録済み**のため、今から実生成時刻へ書き換えると
// 「適用済みだが journal 上は未適用」の不整合が起きる (再適用 or 永久 skip)。したがって値そのものは
// 修正せず、R2 の例外として固定する。R1 (未来でない) は 3 値とも既に満たしている。
//
//   1784500000000 = 0002_evaluations_week_unique  — #3946 の原因値 (手書きの丸め値)
//   1784500000001 = 0003_login_streaks_counter    — #3947 で 0002 を上回らせるため手書きした連番
//   1784500000002 = 0004_drop_login_bonuses       — 同上
//
// **新規 migration でこの例外を増やしてはならない**。`npx drizzle-kit generate` が入れた `when` を
// 手で書き換えないこと (手順 SSOT: `.claude/skills/db-migration/SKILL.md`)。

/** 0002_evaluations_week_unique の手書き `when` — #3946 の原因値。 */
export const HANDWRITTEN_WHEN_0002 = 1784500000000;
/** 0003_login_streaks_counter の手書き `when` — #3947 で 0002 を上回らせるために採番した連番。 */
export const HANDWRITTEN_WHEN_0003 = 1784500000001;
/** 0004_drop_login_bonuses の手書き `when` — 同上。 */
export const HANDWRITTEN_WHEN_0004 = 1784500000002;

/** #3946 以前に本番 DB へ記録済みの手書き `when` (R2 の例外)。新規追加は禁止。 */
export const GRANDFATHERED_WHEN = Object.freeze([
	HANDWRITTEN_WHEN_0002,
	HANDWRITTEN_WHEN_0003,
	HANDWRITTEN_WHEN_0004,
]);

/**
 * 「手書きらしさ」の判定境界。`when % ROUND_UNIT_MS` が ROUND_SLACK_MS 未満なら手書きと見なす。
 * drizzle-kit の `Date.now()` が偶然ここに落ちる確率は ROUND_SLACK_MS / ROUND_UNIT_MS = 1/10,000。
 */
export const ROUND_UNIT_MS = 100_000;
export const ROUND_SLACK_MS = 10;

/**
 * これより過去の `when` は手書き / 破損と見なす (2023-01-01T00:00:00Z、本プロジェクト開始より前)。
 *
 * **絶対値の固定閾値**であり `now` からの相対ではない。journal の `when` は「その migration が
 * 生成された時刻」で以後不変なので、古い branch を checkout しても・長期間 merge されない branch で
 * CI を回しても、entries は「現在の journal の部分集合 (先頭 N 件)」にしかならず値自体は動かない。
 * したがって branch の鮮度で誤 fail しない (相対閾値にすると逆に「古い branch ほど落ちる」になる)。
 * 実 journal の最古 entry は 1783659891383 (2026-07) で、本閾値から 3 年半以上の余裕がある。
 */
export const MIN_PLAUSIBLE_WHEN = 1_672_531_200_000;

/**
 * journal entries の `when` 値域・順序を検証し、違反を配列で返す (違反ゼロ = 空配列)。
 *
 * @param {{ idx: number, when: number, tag: string }[]} entries
 * @param {{ now?: number, grandfathered?: readonly number[] }} [options]
 * @returns {{ rule: string, tag: string, when: number, message: string }[]}
 */
export function findJournalWhenViolations(entries, options = {}) {
	const now = options.now ?? Date.now();
	const grandfathered = new Set(options.grandfathered ?? GRANDFATHERED_WHEN);
	/** @type {{ rule: string, tag: string, when: number, message: string }[]} */
	const violations = [];

	entries.forEach((entry, i) => {
		const { tag, when, idx } = entry;

		if (idx !== i) {
			violations.push({
				rule: 'R4-idx',
				tag,
				when,
				message:
					`idx が配列順と一致しない (idx=${idx}, 期待=${i})。
` + `    → entries の並べ替え・手編集を戻し、drizzle-kit が生成した idx 連番へ戻してください。`,
			});
		}

		if (when > now) {
			violations.push({
				rule: 'R1-future',
				tag,
				when,
				message:
					`when=${when} が現在時刻 (${now}) より未来。未来値を本番 DB へ適用すると、` +
					`以降 drizzle-kit が生成する全 migration が既存 DB で永久 skip される (#3946 と同型)。\n` +
					`    → 手書きした値を戻し、drizzle-kit が生成した実時刻をそのまま使ってください。`,
			});
		}

		if (when < MIN_PLAUSIBLE_WHEN) {
			violations.push({
				rule: 'R3-too-old',
				tag,
				when,
				message:
					`when=${when} がプロジェクト開始 (${MIN_PLAUSIBLE_WHEN}) より過去。手書き値か journal 破損の疑い。\n` +
					`    → epoch 秒 (10 桁) を epoch ミリ秒 (13 桁) と取り違えていないか確認し、` +
					`drizzle-kit が生成した実時刻へ戻してください。`,
			});
		}

		if (!grandfathered.has(when) && when % ROUND_UNIT_MS < ROUND_SLACK_MS) {
			violations.push({
				rule: 'R2-handwritten',
				tag,
				when,
				message:
					`when=${when} が手書きの丸め値・連番に見える (${ROUND_UNIT_MS}ms 境界から ${ROUND_SLACK_MS}ms 未満)。\n` +
					`    → 手で書き換えた場合: 書き換えを戻し、drizzle-kit が生成した実時刻をそのまま使ってください。\n` +
					`    → これが本当に drizzle-kit 生成値の場合 (約 1/${ROUND_UNIT_MS / ROUND_SLACK_MS} の偶然): ` +
					`migration を再生成 (\`npx drizzle-kit generate\` をやり直す) してください。` +
					`未適用の migration なら再生成が最も安全です。既に本番へ適用済みで再生成できない場合のみ、` +
					`GRANDFATHERED_WHEN (scripts/lib/db/drizzle-journal-gate.mjs) へ理由付きで追加してください。`,
			});
		}
	});

	entries.reduce(
		(prev, entry) => {
			if (prev && entry.when <= prev.when) {
				violations.push({
					rule: 'R4-monotonic',
					tag: entry.tag,
					when: entry.when,
					message:
						`when=${entry.when} が直前 ${prev.tag} (when=${prev.when}) 以下。` +
						`逆転した migration は既存 DB で永久 skip される (#3946 の直接原因)。
` +
						`    → 先行 entry の when を下げるのではなく、本 entry を drizzle-kit で再生成して実時刻を入れ直してください。`,
				});
			}
			return entry;
		},
		/** @type {{ idx: number, when: number, tag: string } | null} */ (null),
	);

	return violations;
}

/**
 * 違反配列を人間可読な 1 本のメッセージへ整形する。
 *
 * @param {{ rule: string, tag: string, when: number, message: string }[]} violations
 * @returns {string}
 */
export function formatJournalWhenViolations(violations) {
	return violations.map((v) => `  [${v.rule}] ${v.tag}: ${v.message}`).join('\n');
}
