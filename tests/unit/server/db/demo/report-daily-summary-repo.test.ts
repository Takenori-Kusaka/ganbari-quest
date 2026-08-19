/**
 * tests/unit/server/db/demo/report-daily-summary-repo.test.ts
 *
 * #4712: demo の日次サマリ repo が fixture の活動ログから集計を返すことを固定する。
 *
 * 旧実装は常に `[]` を返しており、デモの月次レポート / ダッシュボードが全員
 * 「活動 0 回・活動日数 0」に見えていた (fixture には直近 0〜10 日の活動ログがある)。
 * デモは「使われている家族」を見せる場なので、read は Fake (fixture 集計)、
 * write は Stub (no-op) の hybrid とする (ADR-0048 §決定 §2)。
 */

import { describe, expect, it } from 'vitest';
import { asChildId } from '$lib/domain/ids';
import {
	DEMO_ACTIVITY_LOGS,
	DEMO_POINT_BALANCES,
	DEMO_STATUSES,
} from '$lib/server/demo/demo-data';
import * as repo from '../../../../../src/lib/server/db/demo/report-daily-summary-repo';

const TENANT = 'demo';
/** fixture 全体を必ず含む広い範囲 (fixture は「N 日前」で作られるため固定日付では挟めない) */
const WIDE_START = '2000-01-01';
const WIDE_END = '2100-12-31';

describe('#4712 demo report-daily-summary repo (fixture 集計 Fake)', () => {
	it('findByTenantAndDateRange が 1 件以上返す (旧 stub の空配列ではない)', async () => {
		const rows = await repo.findByTenantAndDateRange(TENANT, WIDE_START, WIDE_END);
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => r.activityCount > 0)).toBe(true);
	});

	it('活動ログの件数と集計の合計が一致する (cancelled は除外)', async () => {
		const rows = await repo.findByTenantAndDateRange(TENANT, WIDE_START, WIDE_END);
		const summed = rows.reduce((acc, r) => acc + r.activityCount, 0);
		const expected = DEMO_ACTIVITY_LOGS.filter((l) => !l.cancelled).length;
		expect(summed).toBe(expected);
	});

	it('(child, date) 単位で 1 行に畳まれる', async () => {
		const rows = await repo.findByTenantAndDateRange(TENANT, WIDE_START, WIDE_END);
		const keys = rows.map((r) => `${r.childId}:${r.date}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('findByChildAndDateRange は指定した子供の行だけを返す', async () => {
		const childId = asChildId(902);
		const rows = await repo.findByChildAndDateRange(childId, WIDE_START, WIDE_END, TENANT);
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => r.childId === childId)).toBe(true);
	});

	it('日付範囲の外は返さない', async () => {
		const rows = await repo.findByChildAndDateRange(
			asChildId(902),
			'1999-01-01',
			'1999-12-31',
			TENANT,
		);
		expect(rows).toEqual([]);
	});

	it('categoryBreakdown / checklistCompletion は JSON 文字列 (実 repo と同形状)', async () => {
		const rows = await repo.findByTenantAndDateRange(TENANT, WIDE_START, WIDE_END);
		const first = rows[0];
		expect(first).toBeDefined();
		if (!first) return;
		const breakdown = JSON.parse(first.categoryBreakdown) as Record<string, number>;
		expect(Object.values(breakdown).reduce((a, b) => a + b, 0)).toBe(first.activityCount);
		expect(JSON.parse(first.checklistCompletion)).toEqual({});
	});

	it('レベル / 累計ポイントはデモ他画面と同じ fixture 値を使う (同一デモ内で数字が食い違わない)', async () => {
		const rows = await repo.findByChildAndDateRange(asChildId(902), WIDE_START, WIDE_END, TENANT);
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => r.totalPoints === DEMO_POINT_BALANCES['902'])).toBe(true);
		const expectedLevel = Math.max(
			...DEMO_STATUSES.filter((st) => st.childId === asChildId(902)).map((st) => st.level),
		);
		expect(rows.every((r) => r.level === expectedLevel)).toBe(true);
	});

	it('write は no-op のまま (fixture immutability)', async () => {
		await expect(repo.upsert({} as never)).resolves.toBeUndefined();
		await expect(repo.deleteOlderThan(TENANT, '2026-01-01')).resolves.toBe(0);
		await expect(repo.deleteByTenantId(TENANT)).resolves.toBeUndefined();
	});
});
