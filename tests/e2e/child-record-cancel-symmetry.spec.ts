// tests/e2e/child-record-cancel-symmetry.spec.ts
// #4686: 活動の「とりけし」でコンボボーナス等の optional 付与が巻き戻り、残高が記録前と一致する
// (act → outcome → persistence)。あわせて結果ダイアログの合計 (記録ポイント + コンボ純増) が
// 台帳の増分と一致することを assert する (tier 満額表示で合計が残高と合わなかった F3 の回帰)。
//
// deterministic 化: 同一 worker DB の他 spec が当日の記録を残していても成立するよう、
// 「記録前後 / とりけし後」の **台帳合計の差分** で検証する (絶対値に依存しない)。

import { expect, test } from './fixtures';
import { dismissOverlays, expandAllCategories, selectKinderChildAndDismiss } from './helpers';

const CHILD_NICKNAME = 'たろうくん';

async function openDb(workerDbPath: string) {
	const { default: Database } = await import('better-sqlite3');
	return new Database(workerDbPath);
}

/** 子供 id と、カテゴリの異なる可視活動 2 件 (当日未記録にリセット) を返す。 */
async function prepareTwoActivities(
	workerDbPath: string,
): Promise<{ childId: number; a: number; b: number }> {
	const db = await openDb(workerDbPath);
	try {
		const child = db
			.prepare('SELECT id FROM children WHERE nickname = ? LIMIT 1')
			.get(CHILD_NICKNAME) as { id: number } | undefined;
		if (!child) throw new Error(`${CHILD_NICKNAME} not found`);
		const rows = db
			.prepare(
				`SELECT id, category_id FROM child_activities
				 WHERE child_id = ? AND is_visible = 1 AND is_archived = 0
				 ORDER BY sort_order, id`,
			)
			.all(child.id) as Array<{ id: number; category_id: number }>;
		const a = rows[0];
		const b = rows.find((r) => r.category_id !== a?.category_id);
		if (!a || !b) throw new Error('need 2 activities of different categories');
		// 当日の記録を消して「記録できる」状態にする (JST 今日)
		const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
		db.prepare(
			'DELETE FROM activity_logs WHERE child_id = ? AND recorded_date = ? AND activity_id IN (?, ?)',
		).run(child.id, today, a.id, b.id);
		return { childId: child.id, a: a.id, b: b.id };
	} finally {
		db.close();
	}
}

async function ledgerSum(workerDbPath: string, childId: number): Promise<number> {
	const db = await openDb(workerDbPath);
	try {
		const row = db
			.prepare('SELECT coalesce(sum(amount), 0) AS s FROM point_ledger WHERE child_id = ?')
			.get(childId) as { s: number };
		return Number(row.s);
	} finally {
		db.close();
	}
}

/** "+5P" / "+¥50" 等から符号付き数値を取り出す。 */
function parseSigned(text: string | null): number {
	const m = (text ?? '').replace(/,/g, '').match(/([+-])\s*[^\d]*(\d+)/);
	if (!m) return 0;
	return (m[1] === '-' ? -1 : 1) * Number(m[2]);
}

async function recordActivityById(page: import('@playwright/test').Page, activityId: number) {
	await dismissOverlays(page);
	await expandAllCategories(page);
	const card = page.getByTestId(`activity-card-${activityId}`);
	await card.scrollIntoViewIfNeeded();
	await card.click();
	await expect(page.getByTestId('confirm-dialog')).toBeVisible();
	await Promise.all([
		page.waitForResponse(
			(res) => res.url().includes('?/record') && res.request().method() === 'POST',
		),
		page.getByTestId('confirm-record-btn').click(),
	]);
	await expect(page.getByTestId('result-point-value')).toBeVisible();
}

test.describe('#4686 とりけしの対称巻き戻し (コンボ) + 結果ダイアログ合計 = 台帳増分', () => {
	test.slow();

	test('2 種目目の記録 → とりけし で残高が記録前に戻り、ダイアログ合計は台帳増分と一致する', async ({
		page,
		workerDbPath,
	}) => {
		const { childId, a, b } = await prepareTwoActivities(workerDbPath);
		await selectKinderChildAndDismiss(page);

		// 1 件目: 記録して閉じる (コンボの土台)
		await recordActivityById(page, a);
		await page.getByTestId('activity-confirm-btn').click();
		await expect(page.getByTestId('result-point-value')).toBeHidden();

		const beforeB = await ledgerSum(workerDbPath, childId);

		// 2 件目: 別カテゴリ → コンボ純増がダイアログに出る
		await recordActivityById(page, b);
		const shownPoints = parseSigned(await page.getByTestId('result-point-value').textContent());
		const readIfVisible = async (testId: string) => {
			const el = page.getByTestId(testId);
			return (await el.isVisible().catch(() => false)) ? parseSigned(await el.textContent()) : 0;
		};
		const shownCombo = await readIfVisible('result-combo-new-bonus');
		const shownMission = await readIfVisible('result-mission-bonus');
		const shownFocus = await readIfVisible('result-focus-bonus');
		expect(shownPoints).toBeGreaterThan(0);

		// outcome ①: ダイアログの合計 (記録ポイント + コンボ純増 + ミッション / フォーカス差分) = 台帳の増分
		await expect
			.poll(async () => (await ledgerSum(workerDbPath, childId)) - beforeB)
			.toBe(shownPoints + shownCombo + shownMission + shownFocus);

		// act: とりけし (5 秒窓内)
		const cancelBtn = page.getByTestId('activity-cancel-btn');
		await expect(cancelBtn).toBeVisible();
		await Promise.all([
			page.waitForResponse(
				(res) => res.url().includes('cancelRecord') && res.request().method() === 'POST',
			),
			cancelBtn.click(),
		]);
		await expect(page.getByText('とりけしました')).toBeVisible();

		// outcome ② / persistence: 残高 (台帳合計) が 2 件目の記録前と一致 (コンボも巻き戻る)
		await expect.poll(async () => await ledgerSum(workerDbPath, childId)).toBe(beforeB);
	});
});
