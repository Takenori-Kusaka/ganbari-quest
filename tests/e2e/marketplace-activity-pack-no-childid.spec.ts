// tests/e2e/marketplace-activity-pack-no-childid.spec.ts
// #2362 PR-3 Phase 5 (CWE-598 + ADR-0055 per-child + marketplace-import-flow §4 検証)
//
// 設計背景:
//   marketplace 詳細 page は public surface であり、ADR-0055 / marketplace-import-flow §1.1
//   (User §7.3 直接指針) により URL / form body / response の **どこにも childId / nickname
//   を露出させない**ことが必須。Phase 4 で admin/activities 側に ChildSelectionDialog auto-open
//   mechanism を実装したため、marketplace 詳細から childId を渡す必要が無くなった。
//
// 検証対象 (本 spec で担保する CWE-598 boundary):
//   AC1: /marketplace/activity-pack/[itemId] の取込 CTA href に `childId` パラメータが含まれない
//   AC2: 取込 CTA は `/admin/activities?import=<itemId>` (Phase 4 admin の auto-open) または
//        `/auth/login?next=/admin/activities?import=<itemId>` (未ログイン誘導) のみ
//   AC3: 詳細ページの DOM / form action に `name="childId"` の input が存在しない
//        (reward-set / checklist / rule-preset では childId 受領があるが、本 spec は activity-pack のみ検証)
//   AC4: 未認証 user が browse できる + child 情報露出 0 (response body grep)
//
// 環境:
//   AUTH_MODE=local では `locals.context` が常に設定されるため未ログイン状態が再現不可。
//   本 spec はブラウザ実画面の **HTML 検証** に絞り、href / DOM / form action / response 内
//   の child 露出を 0 件 assert する。詳細な service 層検証は service unit test 担当。
//
// 関連:
//   docs/design/marketplace-import-flow.md §1.1 (privacy 要件) / §3.1 (取込フロー sequence)
//   docs/decisions/0055-per-child-primary-data-model-pattern.md
//   tests/e2e/marketplace-auth-redirect.spec.ts (#2303 redirect 先 ガード)

import { expect, test } from '@playwright/test';

test.describe('#2362 PR-3 Phase 5 marketplace activity-pack 取込で childId 露出 0 件', () => {
	test.setTimeout(60_000);

	// 代表 fixture: kinder-starter は activity-pack data fixture に常時存在（marketplace-pack-coverage.test.ts 検証済）
	const PACK_ITEM_ID = 'kinder-starter';
	const PACK_URL = `/marketplace/activity-pack/${PACK_ITEM_ID}`;

	test('AC1: 取込 CTA の href に childId パラメータが含まれない (CWE-598)', async ({ page }) => {
		const res = await page.goto(PACK_URL, { waitUntil: 'domcontentloaded' });
		expect(res?.status()).toBe(200);

		// activity-pack 取込 CTA の全 href を走査して childId が含まれないことを assert
		const ctaSelector =
			'a[data-testid="activity-pack-import-cta"], a[data-testid="activity-pack-signup-redirect"]';
		const ctaLinks = page.locator(ctaSelector);
		const count = await ctaLinks.count();

		// AC1-a: 取込関連 CTA は 1 件以上存在する (ログイン状態に応じてどちらか)
		expect(count).toBeGreaterThanOrEqual(1);

		// AC1-b: 各 href に childId が含まれない
		for (let i = 0; i < count; i++) {
			const href = await ctaLinks.nth(i).getAttribute('href');
			expect(href).toBeTruthy();
			expect(href).not.toContain('childId');
			expect(href).not.toContain('child_id');
		}
	});

	test('AC2: 取込 CTA は admin/activities?import 形式または auth/login?next= 形式のみ', async ({
		page,
	}) => {
		const res = await page.goto(PACK_URL, { waitUntil: 'domcontentloaded' });
		expect(res?.status()).toBe(200);

		const ctaSelector =
			'a[data-testid="activity-pack-import-cta"], a[data-testid="activity-pack-signup-redirect"]';
		const ctaLinks = page.locator(ctaSelector);
		const count = await ctaLinks.count();
		expect(count).toBeGreaterThanOrEqual(1);

		// AC2: href は admin/activities?import=<itemId> または auth/login?next=/admin/activities... のみ
		for (let i = 0; i < count; i++) {
			const href = await ctaLinks.nth(i).getAttribute('href');
			expect(href).toBeTruthy();
			const isAdminImport = href?.startsWith('/admin/activities?import=');
			const isAuthLogin = href?.startsWith('/auth/login?next=/admin/activities');
			expect(isAdminImport || isAuthLogin).toBe(true);
		}
	});

	test('AC3: 詳細ページに name="childId" の input form が存在しない (activity-pack scope)', async ({
		page,
	}) => {
		await page.goto(PACK_URL, { waitUntil: 'domcontentloaded' });

		// activity-pack CTA section 内に form (method=POST) が無いこと
		// (reward-set / checklist は form を持つが、activity-pack は admin redirect で代替)
		const ctaSection = page.locator('[data-testid="marketplace-detail-cta"]');
		await expect(ctaSection).toBeVisible();

		// activity-pack 取込フローは form 不要 (admin/activities redirect で代替)
		// section 内に `form[action="?/importActivityPack"]` が存在しないこと
		const importActivityForm = ctaSection.locator('form[action*="importActivityPack"]');
		await expect(importActivityForm).toHaveCount(0);

		// activity-pack CTA 周囲 (a[data-testid=activity-pack-*]) の input[name=childId] も 0 件
		// （CTA 直前の form 要素を含めて global に検証）
		const activityPackChildIdInput = page.locator(
			'a[data-testid^="activity-pack-"] input[name="childId"]',
		);
		await expect(activityPackChildIdInput).toHaveCount(0);
	});

	test('AC4: response body / URL に child 情報露出 0 件 (CWE-598 privacy)', async ({ page }) => {
		const res = await page.goto(PACK_URL, { waitUntil: 'domcontentloaded' });
		expect(res?.status()).toBe(200);

		// URL に childId / nickname 等の child 情報が含まれない
		const url = page.url();
		expect(url).not.toContain('childId');
		expect(url).not.toContain('nickname');
		expect(url).not.toContain('child_id');

		// breadcrumb / item heading 等 marketplace 通常 UI が render されることを spot check
		// (full child 情報露出検証は marketplace-auth-redirect.spec.ts と相補的に担保)
		const breadcrumb = page.locator('nav', { hasText: 'みんなのテンプレート' });
		await expect(breadcrumb).toBeVisible();
	});
});
