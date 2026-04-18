// tests/e2e/trial-notice-consistency.spec.ts
// #1166: 景品表示法リスク回避のため、登録・購入系 CTA の近辺に
//「7日間無料トライアル付き」という付帯表記を出さないことを検証する。
//
// 仕様メモ:
//  - トライアルは /admin/license で明示操作した場合のみ開始（アプリ内 trial-service）
//  - Stripe Checkout 側は trial_period_days を使用しない（stripe-service.ts #314）
//  - カード登録不要 / 7日経過後の自動課金なし
//  → 「登録 / 購入すれば自動付帯」と誤認させる表記は景品表示法リスク
//
// 実行: npx playwright test tests/e2e/trial-notice-consistency.spec.ts
//
// このテストは認証不要の public ページのみ触るため、plan-login-helpers を使わない。

import { expect, test } from '@playwright/test';

const FORBIDDEN_NOTICE = '7日間無料トライアル付き';

const PUBLIC_REGISTRATION_CTA_PAGES = [
	{ path: '/marketplace', label: 'マーケットプレイス一覧' },
	{
		path: '/marketplace/activity-pack/kinder-starter',
		label: 'マケプレ詳細 (activity-pack)',
	},
	{
		path: '/marketplace/reward-set/kinder-rewards',
		label: 'マケプレ詳細 (reward-set)',
	},
	{ path: '/activity-packs', label: '活動パック一覧 (legacy)' },
	{ path: '/activity-packs/kinder-starter', label: '活動パック詳細 (legacy)' },
];

test.describe('#1166 trial notice consistency — public 登録導線', () => {
	for (const { path, label } of PUBLIC_REGISTRATION_CTA_PAGES) {
		test(`${label} (${path}) に「${FORBIDDEN_NOTICE}」が表示されない`, async ({ page }) => {
			await page.goto(path, { waitUntil: 'domcontentloaded' });
			const bodyText = await page.locator('body').innerText();
			expect(bodyText).not.toContain(FORBIDDEN_NOTICE);
		});
	}
});

test.describe('#1166 trial notice consistency — pricing ページ', () => {
	// /pricing は「7日間の無料体験付き」という、プラン付帯を明示した文言を使う
	// （tokushoho.html / terms.html と整合）。誤表記「7日間無料トライアル付き」は
	// 存在しないこと。
	test('/pricing に誤表記が無いこと', async ({ page }) => {
		await page.goto('/pricing', { waitUntil: 'domcontentloaded' });
		const bodyText = await page.locator('body').innerText();
		expect(bodyText).not.toContain(FORBIDDEN_NOTICE);
	});
});
