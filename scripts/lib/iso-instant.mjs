// @ts-check
/**
 * scripts/lib/iso-instant.mjs — ISO8601 を **時刻として** 比較するための唯一の入口 (#4053 AC1 / #4624)
 *
 * # なぜ共有 lib なのか
 *
 * ISO8601 文字列の `>=` / `<` 比較は **辞書順であって時刻順ではない**。
 * `2026-07-26T08:01:03+09:00` と `2026-07-25T23:01:03Z` は同一時刻だが、文字列比較では等しくない。
 *
 * #4053 はこれで実害を出した: 統合 PR の含有一覧が `select(.mergedAt >= "$SINCE_ISO")` で絞られており、
 * anchor 側が commit の記録 TZ (`+09:00`)、`mergedAt` 側が GitHub の `Z` 形だったため、
 * **main..develop に 21 本ある merged PR が 3 本しか出なかった** (main リリースの監査証跡と
 * `Closes` 集約が同時に壊れた)。
 *
 * #4053 の修正は `collect-integration-prs.mjs` の中に正規化関数を置いたが、**その file の中でしか
 * 見つからない**ため、同じ比較を別の file に書く人には届かなかった。実際 #4624 時点で
 * `integration-attest.yml` と `check-admin-bypass-evidence.mjs` に同型の文字列比較が残っていた。
 * 「置いてあるだけの sanctioned API」は回帰ロックとして機能しない、というのが本 lib を切り出した理由。
 *
 * # 使い方
 *
 * - JS からの時刻比較は本 lib を通す (`isAtOrAfterInstant` / `compareIsoInstant`)
 * - 数値が欲しいときだけ `toEpochMs`
 * - jq / shell から比較するときは `fromdateiso8601` 等で **両辺を epoch 秒に落としてから**比較する
 *   (本 lib は JS 専用。yml 側は `tests/unit/architecture/iso-instant-comparison-fitness.test.ts` が見る)
 *
 * 逸脱は `tests/unit/architecture/iso-instant-comparison-fitness.test.ts` が CI で検出する。
 */

/**
 * ISO8601 文字列を epoch ミリ秒へ正規化する純粋関数。
 *
 * `2026-07-26T08:01:03+09:00` (ローカルオフセット形) と `2026-07-25T23:01:03Z` (Z 形) は
 * **同一時刻**であり、本関数を通すと同じ値になる。文字列比較 (`>=`) はこの同一性を壊す。
 *
 * @param {string} iso
 * @returns {number} epoch ms。解釈不能なら NaN
 */
export function toEpochMs(iso) {
	const ms = Date.parse(String(iso ?? ''));
	return Number.isFinite(ms) ? ms : Number.NaN;
}

/**
 * 2 つの ISO8601 を **時刻として** 比較する純粋関数。TZ 表記の違いに影響されない。
 *
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1} a<b: -1 / a==b: 0 / a>b: 1
 * @throws {Error} どちらかが解釈不能な場合 (silent に false を返さない)
 */
export function compareIsoInstant(a, b) {
	const ea = toEpochMs(a);
	const eb = toEpochMs(b);
	if (Number.isNaN(ea) || Number.isNaN(eb)) {
		throw new Error(`[iso-instant] ISO8601 として解釈できない値: a=${a} / b=${b}`);
	}
	if (ea < eb) return -1;
	if (ea > eb) return 1;
	return 0;
}

/**
 * `a >= b` を **時刻として** 判定する純粋関数。
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function isAtOrAfterInstant(a, b) {
	return compareIsoInstant(a, b) >= 0;
}
