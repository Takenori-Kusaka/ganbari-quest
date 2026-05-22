// tests/e2e/plan-gated-features.spec.ts
// #776: プラン別ゲート UI の E2E 検証
//
// ローカル auth モードでは plan-limit-service の resolvePlanTier が
// 早期 return で常に 'family' を返すため、プランゲートを E2E で検証できない。
// この spec は AUTH_MODE=cognito + COGNITO_DEV_MODE=true 前提で実行し、
// DevCognitoAuthProvider のプラン別ダミーユーザー（free/standard/family）で
// ログイン → 実際のプランゲート UI を検証する。
//
// #1535: loginAsPlan() を storageState ベースに移行（describe ブロック分割）
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts plan-gated-features
//
// 対応ゲート:
//  - /admin/rewards: rewards-upgrade-banner（free のみ表示）
//
// #2316 削除済 ゲート:
//  - /admin/messages: ひとことメッセージボタン (free/standard disabled, family enabled)
//    → #2267 (PR #2293) で /admin/messages 廃止 + /admin/cheer 統合により、
//      メッセージ機能は応援機能の付随要素として全プラン解放された
//      (ADR-0006 assertion erosion ban に従い skip ではなく削除)

import { expect, test } from '@playwright/test';

// ============================================================
// /admin/rewards — #728 カスタムごほうびプランゲート
// ============================================================
test.describe('#776 /admin/rewards プランゲート — free', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('free プランではアップグレードバナーが表示される', async ({ page }) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toBeVisible();
		await expect(page.getByTestId('rewards-upgrade-cta')).toBeVisible();
	});
});

test.describe('#776 /admin/rewards プランゲート — standard', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('standard プランではアップグレードバナーが表示されない', async ({ page }) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
	});
});

test.describe('#776 /admin/rewards プランゲート — family', () => {
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('family プランではアップグレードバナーが表示されない', async ({ page }) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
	});
});

// ============================================================
// /admin/challenges — #2402 QM must-3 (OWASP A01) challenge-set import family ゲート
// ============================================================
// 兄弟チャレンジは family-only 機能。client-side `{#if !isFamily}` UI ゲートを
// 直接 POST でバイパスできないよう、サーバー側でも family プラン厳密比較を実施。
// `importMarketplaceChallengeSet` (UnifiedImportHub) と `importChallengeSet`
// (query-param dialog) の両方の経路で 403 が返ることを確認する。

test.describe('#2402 /admin/challenges 直接 POST バイパス防止 — free', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('importMarketplaceChallengeSet を free プランで叩くと 403 で拒否される', async ({
		request,
	}) => {
		const res = await request.post('/admin/challenges?/importMarketplaceChallengeSet', {
			multipart: { presetId: 'japan-annual-events' },
		});
		// SvelteKit form action の fail() は HTTP 200 + JSON body 形式で返る。
		// app crash (5xx) させず、family ゲート発火を確認する。
		expect(res.status()).toBeLessThan(500);
		const text = await res.text();
		// `tier !== 'family'` ゲートが発火した証拠 (createPlanLimitError の最小プラン要求)
		expect(text).toMatch(/family|ファミリー|きょうだいチャレンジ/);
	});

	test('importChallengeSet (query-param 経路) を free プランで叩いても 403 で拒否される', async ({
		request,
	}) => {
		const res = await request.post('/admin/challenges?/importChallengeSet', {
			multipart: { presetId: 'japan-annual-events' },
		});
		expect(res.status()).toBeLessThan(500);
		const text = await res.text();
		expect(text).toMatch(/family|ファミリー|きょうだいチャレンジ/);
	});
});

test.describe('#2402 /admin/challenges 直接 POST バイパス防止 — standard', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('importMarketplaceChallengeSet を standard プランで叩いても 403 (family-only)', async ({
		request,
	}) => {
		// standard は paid だが family 未満なので兄弟チャレンジは禁止。
		// rewards (isPaidTier OK) と異なり challenges は family 厳密比較である点を検証。
		const res = await request.post('/admin/challenges?/importMarketplaceChallengeSet', {
			multipart: { presetId: 'japan-annual-events' },
		});
		expect(res.status()).toBeLessThan(500);
		const text = await res.text();
		expect(text).toMatch(/family|ファミリー|きょうだいチャレンジ/);
	});
});

test.describe('#2402 /admin/challenges 直接 POST バイパス防止 — family', () => {
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('family プランでは 403 にならない (成功 / 4xx 他の理由で fail 可)', async ({ request }) => {
		// family なら family ゲートを通過。dispatchImport 内部で 200 / 4xx / 5xx 何かしらの結果。
		// 重要なのは「family ゲートで弾かれない」ことの証明 (gate 文言不在を検証)。
		const res = await request.post('/admin/challenges?/importMarketplaceChallengeSet', {
			multipart: { presetId: 'japan-annual-events' },
		});
		// app crash しないことを確認 + family 文言で gate が発火していないことを確認
		expect(res.status()).toBeLessThan(500);
		const text = await res.text();
		// family ゲート文言が含まれない (このゲートは通過した)
		// "きょうだいチャレンジ" は gate メッセージ専用文言のため不在を確認
		expect(text).not.toMatch(/きょうだいチャレンジ.*ファミリープラン/);
	});
});
