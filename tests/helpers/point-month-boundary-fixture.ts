// tests/helpers/point-month-boundary-fixture.ts
// #4697 follow-up: 月次レポートの「ポイント」= 台帳のその月の獲得合計 (sumEarnedPointsBetween) が
// **どの backend でも同じ月に帰属する**ことを固定するための共有シナリオ。
//
// 月境界は JST 暦日で決まる (date-utils の SSOT 宣言 / #966 / #4015 / #4127)。JST 00:00〜09:00 は
// UTC ではまだ前日のため、`created_at` (UTC) の日付前方一致で月を決めると 1 日分ずれる。
// 本 fixture は「その 9 時間に記録されたポイント」を月の両端に置き、sqlite backend と
// pg-core backend (dsql / pglite) が同じ帰属を返すことを両方のテストから同一データで表明する
// (期待値のハードコードを 2 箇所に散らさない)。

export interface PointMonthBoundaryRow {
	/** 失敗時に「どの行がずれたか」が読めるようにする説明 */
	readonly label: string;
	/** 台帳に書いた瞬間 (UTC ISO)。sqlite は created_at、pg-core は recorded_date の導出元 */
	readonly createdAtUtcIso: string;
	readonly amount: number;
	/** この瞬間が属する JST 暦月 (YYYY-MM)。手で宣言し、date-utils と一致することをテストで検証する */
	readonly jstMonth: string;
}

/**
 * JST 月境界をまたぐ獲得ポイント。amount は互いに素な値にして、取り違えが合計に必ず現れるようにする。
 */
export const POINT_MONTH_BOUNDARY_ROWS: readonly PointMonthBoundaryRow[] = [
	{
		label: '前月末 JST 23:59 (UTC も前月)',
		createdAtUtcIso: '2026-03-31T14:59:00Z',
		amount: 3,
		jstMonth: '2026-03',
	},
	{
		label: '当月 1 日 JST 00:00 (UTC ではまだ前月末)',
		createdAtUtcIso: '2026-03-31T15:00:00Z',
		amount: 11,
		jstMonth: '2026-04',
	},
	{
		label: '当月 1 日 JST 08:30 (UTC ではまだ前月末)',
		createdAtUtcIso: '2026-03-31T23:30:00Z',
		amount: 13,
		jstMonth: '2026-04',
	},
	{
		label: '当月なかば (JST / UTC で一致)',
		createdAtUtcIso: '2026-04-15T03:00:00Z',
		amount: 17,
		jstMonth: '2026-04',
	},
	{
		label: '当月末 JST 23:59 (UTC も当月)',
		createdAtUtcIso: '2026-04-30T14:59:00Z',
		amount: 19,
		jstMonth: '2026-04',
	},
	{
		label: '翌月 1 日 JST 00:00 (UTC ではまだ当月末)',
		createdAtUtcIso: '2026-04-30T15:00:00Z',
		amount: 23,
		jstMonth: '2026-05',
	},
	{
		label: '翌月 1 日 JST 08:00 (UTC ではまだ当月末)',
		createdAtUtcIso: '2026-04-30T23:00:00Z',
		amount: 29,
		jstMonth: '2026-05',
	},
];

/** 本 fixture を入れたときに `sumEarnedPointsBetween` が返すべき合計 (JST 暦月ごと)。 */
export function expectedEarnedInJstMonth(monthKey: string): number {
	return POINT_MONTH_BOUNDARY_ROWS.filter((r) => r.jstMonth === monthKey && r.amount > 0).reduce(
		(sum, r) => sum + r.amount,
		0,
	);
}

/** 検証対象の月 (前月 / 当月 / 翌月)。どの月でも 0 にならないことが取り違えの検出条件。 */
export const POINT_MONTH_BOUNDARY_MONTHS = ['2026-03', '2026-04', '2026-05'] as const;
