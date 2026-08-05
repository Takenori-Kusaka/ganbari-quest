/**
 * scripts/lib/ci/tz-invariance-cases.mjs (#4127)
 *
 * TZ 不変性 proof の登録簿 (SSOT)。
 *
 * # なぜ必要か
 *
 * #4015 で入れた静的 gate は allowlist の `reason` が**非空かどうか**しか検査していなかった。
 * その結果「(b2) パースと読み出しが同じ TZ 系なので安全」と書かれた `daily-mission-service`
 * の `getPreviousDate()` が、実際には TZ=Asia/Tokyo で 2 日前を返していた (#4127 残存 3)。
 * 理由が実測と食い違っていても緑になる allowlist は、除外の体裁だけがある無検査と同じ。
 *
 * 本 registry は「その除外は測って確かめた」と言うための **id 空間**である。
 *
 *   - 静的 gate (`scripts/check-local-tz-date-getters.mjs`) の allowlist は
 *     `kind: 'tz-proof'` のとき `proof` にここの id を要求する (未登録なら fail)
 *   - fitness test (`tests/unit/architecture/tz-invariance.test.ts`) は、ここの全 id に
 *     対応する実測 case を持つことを要求し (双方向 no-silent-gap)、各 case を
 *     `TZ=UTC` と `TZ=Asia/Tokyo` の 2 環境で評価して **JST 暦の期待値と一致する**ことを
 *     assert する
 *
 * つまり allowlist の理由は「文章」ではなく「実行される測定」に紐付く。
 */

/**
 * 判定に使う固定の瞬間。
 *
 * JST 2026-08-01 00:30 = UTC 2026-07-31 15:30。**UTC 経路だと暦日 / 暦月がどちらも 1 つ前に
 * なる窓** (JST 00:00〜09:00) の内側にあり、月境界もまたぐため「UTC で導出しているか」と
 * 「プロセス TZ に依存しているか」を同時に炙り出せる。
 */
export const TZ_PROBE_INSTANT_ISO = '2026-07-31T15:30:00.000Z';

/** `TZ_PROBE_INSTANT_ISO` における JST 暦日 */
export const TZ_PROBE_JST_DATE = '2026-08-01';

/** `TZ_PROBE_INSTANT_ISO` における JST 暦月 */
export const TZ_PROBE_JST_MONTH = '2026-08';

/** fitness test が評価するプロセス TZ。本番 runtime の 2 種 (Lambda=UTC / NUC=JST) に対応する。 */
export const TZ_PROBE_TIMEZONES = ['UTC', 'Asia/Tokyo'];

/**
 * TZ 不変性 proof の登録簿。
 *
 * key = proof id (静的 gate の allowlist から参照される) / value.note = 何を測るか。
 *
 * @type {Record<string, { note: string }>}
 */
export const TZ_INVARIANCE_CASES = {
	'date-utils/today-date-jst': {
		note: 'JST SSOT 自身。todayDateJST / monthKeyJST / weekStartJST が 2 TZ で JST 暦と一致する',
	},
	'date-utils/jst-hour': {
		note: 'jstHour() が 2 TZ で JST の時刻を返す (はやおきボーナスの判定入力、#4127 残存 1)',
	},
	'date-utils/add-days-jst': {
		note: 'addDaysJST / prevDateJST が月またぎ・2 TZ で JST 暦日を返す (#4127 残存 3 の置換先)',
	},
	'bonus-hook/early-bird-hour': {
		note: 'evaluateBonusHooks のはやおきボーナスが JST 07:00 の記録に付き JST 15:00 に付かない (#4127 残存 1)',
	},
	'usage-log/today-summary-date-key': {
		note: 'getTodayUsageSummary が JST の暦日で当日ログを引く (#4127 残存 4)',
	},
	'usage-log/weekly-summary-buckets': {
		note: 'getWeeklyUsageSummary の日次バケットが JST 暦日で並ぶ (#4127 残存 4)',
	},
	'loyalty/increment-month-key': {
		note: 'incrementSubscriptionMonth の二重防止キーが JST 月キーになる (#4127 残存 5)',
	},
	'rest-days/month-symmetry': {
		note: 'おやすみ日の GET 既定月 (導出) と POST の上限判定月 (日付由来) が一致する (#4127 残存 6)',
	},
};

/** proof id の一覧 */
export const TZ_INVARIANCE_CASE_IDS = Object.keys(TZ_INVARIANCE_CASES);

/**
 * proof id が登録済みか
 * @param {string} id
 * @returns {boolean}
 */
export function hasTzInvarianceCase(id) {
	return Object.hasOwn(TZ_INVARIANCE_CASES, id);
}
