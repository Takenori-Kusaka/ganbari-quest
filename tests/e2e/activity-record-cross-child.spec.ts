// tests/e2e/activity-record-cross-child.spec.ts
//
// #2520 AC8 — child 越境記録 negative E2E (CWE-598 IDOR / ADR-0055 §3.1 core path)
//
// per-child refactor (ADR-0055) 後、`child_activities.id` は child に閉じている。
// 記録 API (`POST /api/v1/activity-logs`) の body `childId` は session ではなく
// クライアント指定値を信頼するため、child A の context で child B の `activityId` を
// 渡す越境 (CWE-598) が成立すると、child A の活動履歴に別の子の活動が混入する。
// これは「別の子のデータ表示」(research §2 Class 4) に直結する failure class で、
// 親が即離脱する重大な信頼毀損につながる。
//
// 本 spec は実 API を叩き、越境記録が 404 (NOT_FOUND) で構造的に拒否されること、
// および自分の activity なら 201 で正常記録できること (過剰ガードでないこと) を検証する。
//
// 関連: service 層 unit test `tests/unit/services/activity-log-service.test.ts`
//       (recordActivity: child 越境ガード) と相補。

import { expect, test } from '@playwright/test';

/**
 * `/switch` から 2 人分の child id を取得する。
 * global-setup.ts は 5 children を seed するため最低 2 件は必ず存在する。
 */
async function getTwoChildIds(page: import('@playwright/test').Page): Promise<[number, number]> {
	await page.goto('/switch');
	const buttons = page.locator('[data-testid^="child-select-"]');
	await expect(buttons.first()).toBeVisible();
	const count = await buttons.count();
	expect(
		count,
		'2 child 以上の seed が必要 (global-setup.ts TEST_CHILDREN 参照)',
	).toBeGreaterThanOrEqual(2);

	const ids: number[] = [];
	for (let i = 0; i < count && ids.length < 2; i++) {
		const testid = await buttons.nth(i).getAttribute('data-testid');
		const id = Number(testid?.replace('child-select-', ''));
		if (Number.isFinite(id)) ids.push(id);
	}
	expect(ids.length).toBe(2);
	const [a, b] = ids;
	// expect で 2 件を保証済 (precondition assert)。tuple として返し呼び出し側の undefined 推論を排除。
	if (a === undefined || b === undefined) {
		throw new Error('child id を 2 件取得できませんでした (seed 破綻)');
	}
	return [a, b];
}

/**
 * 指定 child を選択して home に遷移し、その child の activity id を 1 件取得する。
 * activity card の `data-testid="activity-card-{id}"` から id を抜き出す。
 */
async function getOwnActivityId(
	page: import('@playwright/test').Page,
	childId: number,
): Promise<number> {
	await page.goto('/switch');
	const childButton = page.getByTestId(`child-select-${childId}`);
	await expect(childButton).toBeVisible();
	await childButton.click();
	await page.waitForURL(/\/(baby|preschool|elementary|junior|senior)\/home/);

	const cards = page.locator('[data-testid^="activity-card-"]');
	await expect(cards.first()).toBeVisible();
	const testid = await cards.first().getAttribute('data-testid');
	const activityId = Number(testid?.replace('activity-card-', ''));
	expect(Number.isFinite(activityId), 'activity-card id を取得できること').toBe(true);
	return activityId;
}

test.describe('#2520 AC8: child 越境記録ガード (CWE-598)', () => {
	// DB を変更しうる記録 API を叩くため直列実行
	test.describe.configure({ mode: 'serial' });

	test('child A の context で child B の activity_id を記録 → 404 NOT_FOUND (越境拒否)', async ({
		page,
		request,
	}) => {
		const [childA, childB] = await getTwoChildIds(page);

		// baby (準備モード) は activity card を持たないため、子供 mode を持つ child を使う。
		// global-setup の seed 上、たろうくん(preschool)/けんたくん(elementary) 等は activity を持つ。
		// child id 配列の先頭 2 件が baby を含む可能性があるため、home の activity 取得で
		// 失敗したら別 child を使う必要があるが、preschool が必ず seed されるため先頭 2 件で十分。
		const activityIdOfB = await getOwnActivityId(page, childB);

		// === 越境記録: child A の childId で child B の activityId を POST ===
		const res = await request.post('/api/v1/activity-logs', {
			data: { childId: childA, activityId: activityIdOfB },
		});

		// 越境は「activity が見つからない」として拒否される (404 NOT_FOUND)。
		// 防御が外れていると 201 で記録され、child A の履歴に child B の activity が混入する。
		expect(
			res.status(),
			`child A(${childA}) で child B(${childB}) の activity(${activityIdOfB}) を記録できてはならない`,
		).toBe(404);
		// apiError レスポンス body: { error: { code: 'NOT_FOUND', ... } }
		const body = await res.json();
		expect(body.error?.code).toBe('NOT_FOUND');
	});

	test('自分の activity_id なら 201 で正常記録できる (過剰ガードでないこと)', async ({
		page,
		request,
	}) => {
		const ids = await getTwoChildIds(page);
		const childB = ids[1];
		const activityIdOfB = await getOwnActivityId(page, childB);

		const res = await request.post('/api/v1/activity-logs', {
			data: { childId: childB, activityId: activityIdOfB },
		});

		// 自分の activity は記録成功 (201) または当日 2 回目で 409 ALREADY_RECORDED。
		// いずれも「越境ではない正規アクセス」として処理されること (404 にならない)。
		expect(
			[201, 409].includes(res.status()),
			`child B 自身の activity 記録は 201/409 のいずれか (got ${res.status()})`,
		).toBe(true);
	});
});
