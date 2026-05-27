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
// 注意 (#2520 finishing): global-setup の seed は はなこちゃん(baby=準備モード) を含み、
// baby は activity card を持たない (ADR-0011)。そのため「先頭 2 child」ではなく
// activity を持つことが保証された 2 mode (けんたくん=elementary / ゆうこちゃん=junior) を
// 名前で選択する。category compact 折りたたみ対策に expandAllCategories で card を surface する。
//
// 関連: service 層 unit test `tests/unit/services/activity-log-service.test.ts`
//       (recordActivity: child 越境ガード) と相補。

import { expect, test } from '@playwright/test';
import { expandAllCategories } from './helpers';

/**
 * 指定 nickname の child を選択して home に遷移し、(childId, 自分の activityId 1 件) を取得する。
 *   - childId は `/switch` の `child-select-{id}` testid から抽出する。
 *   - activity card は category compact で折りたたまれている場合があるため expandAllCategories で展開する。
 */
async function selectChildAndGetIds(
	page: import('@playwright/test').Page,
	nickname: string,
): Promise<{ childId: number; activityId: number }> {
	await page.goto('/switch');
	const childButton = page.locator('[data-testid^="child-select-"]').filter({ hasText: nickname });
	await expect(
		childButton,
		`${nickname} の child-select ボタンが seed されていること`,
	).toBeVisible();

	const testid = await childButton.getAttribute('data-testid');
	const childId = Number(testid?.replace('child-select-', ''));
	expect(Number.isFinite(childId), `${nickname} の childId を取得できること`).toBe(true);

	await childButton.click();
	await page.waitForURL(/\/(preschool|elementary|junior|senior)\/home/);

	// compact 折りたたみ対策: card が隠れている場合 category を展開して surface する
	await expandAllCategories(page);

	const cards = page.locator('[data-testid^="activity-card-"]');
	await expect(cards.first(), `${nickname} の home に activity card が存在すること`).toBeVisible();
	const cardTestid = await cards.first().getAttribute('data-testid');
	const activityId = Number(cardTestid?.replace('activity-card-', ''));
	expect(Number.isFinite(activityId), `${nickname} の activity-card id を取得できること`).toBe(
		true,
	);

	return { childId, activityId };
}

test.describe('#2520 AC8: child 越境記録ガード (CWE-598)', () => {
	// DB を変更しうる記録 API を叩くため直列実行
	test.describe.configure({ mode: 'serial' });

	test('child A の context で child B の activity_id を記録 → 404 NOT_FOUND (越境拒否)', async ({
		page,
		request,
	}) => {
		// けんたくん(elementary) を A、ゆうこちゃん(junior) を B とする (いずれも activity を持つ非 baby child)
		const childA = await selectChildAndGetIds(page, 'けんたくん');
		const childB = await selectChildAndGetIds(page, 'ゆうこちゃん');

		expect(childA.childId, 'A と B は別の child であること').not.toBe(childB.childId);

		// === 越境記録: child A の childId で child B の activityId を POST ===
		const res = await request.post('/api/v1/activity-logs', {
			data: { childId: childA.childId, activityId: childB.activityId },
		});

		// 越境は「activity が見つからない」として拒否される (404 NOT_FOUND)。
		// 防御が外れていると 201 で記録され、child A の履歴に child B の activity が混入する。
		expect(
			res.status(),
			`child A(${childA.childId}) で child B(${childB.childId}) の activity(${childB.activityId}) を記録できてはならない`,
		).toBe(404);
		// apiError レスポンス body: { error: { code: 'NOT_FOUND', ... } }
		const body = await res.json();
		expect(body.error?.code).toBe('NOT_FOUND');
	});

	test('自分の activity_id なら 201 で正常記録できる (過剰ガードでないこと)', async ({
		page,
		request,
	}) => {
		const childB = await selectChildAndGetIds(page, 'ゆうこちゃん');

		const res = await request.post('/api/v1/activity-logs', {
			data: { childId: childB.childId, activityId: childB.activityId },
		});

		// 自分の activity は記録成功 (201) または当日 2 回目で 409 ALREADY_RECORDED。
		// いずれも「越境ではない正規アクセス」として処理されること (404 にならない)。
		expect(
			[201, 409].includes(res.status()),
			`child B 自身の activity 記録は 201/409 のいずれか (got ${res.status()})`,
		).toBe(true);
	});
});
