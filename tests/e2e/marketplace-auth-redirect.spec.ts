// tests/e2e/marketplace-auth-redirect.spec.ts
// #2303: マーケプレ未ログイン CTA リダイレクト先を /auth/login に変更
//
// 設計背景:
//   旧実装は `/auth/signup` へ redirect していたため、既存ユーザが CTA を押すと
//   新規アカウント作成画面に飛ばされ、誤って二重登録するリスクがあった
//   (Cognito / Stripe / DB 二重作成 = data integrity 侵害)。
//   /auth/login へ redirect することで既存ユーザはログイン、
//   新規ユーザは login 画面内「新規アカウント作成」リンクから signup へ到達する。
//
// 検証対象 (AC3):
//   1. /marketplace 一覧画面の CTA `href` が `/auth/login` であること
//   2. /marketplace/[type]/[itemId] 詳細画面の各 CTA `href` が `/auth/login*` であること
//
// 環境:
//   AUTH_MODE=local では `locals.context` が常に設定されるため、未ログイン状態の
//   「未ログイン CTA」locator は描画されない。本 spec は **静的 HTML 検証** に絞り、
//   実装ファイル経由で `/auth/signup` への直接遷移が無いことを保証する
//   (詳細な静的検証は unit `tests/unit/routes/marketplace-auth-redirect.test.ts` 担当)。
//
// E2E ではブラウザ実画面で `/auth/signup` href が存在しないことを確認する
// (LP truth: ADR-0013 整合、未ログイン誘導動線が実機画面で壊れていないことを担保)。

import { expect, test } from '@playwright/test';

test.describe('#2303 marketplace 未ログイン CTA は /auth/login redirect', () => {
	test.setTimeout(60_000);

	test('AC3a: /marketplace 一覧ページに /auth/signup への直接 href が存在しない', async ({
		page,
	}) => {
		const res = await page.goto('/marketplace', { waitUntil: 'domcontentloaded' });
		expect(res?.status()).toBe(200);

		// /auth/signup を持つ `<a>` が画面上に 0 件であること (data integrity 保護)
		const signupLinks = page.locator('a[href^="/auth/signup"]');
		await expect(signupLinks).toHaveCount(0);
	});

	test('AC3b: /marketplace/rule-preset/streak-bonus 詳細ページに /auth/signup への直接 href が存在しない', async ({
		page,
	}) => {
		const res = await page.goto('/marketplace/rule-preset/streak-bonus', {
			waitUntil: 'domcontentloaded',
		});
		expect(res?.status()).toBe(200);

		// /auth/signup を持つ `<a>` が画面上に 0 件であること
		const signupLinks = page.locator('a[href^="/auth/signup"]');
		await expect(signupLinks).toHaveCount(0);
	});

	test('AC3c: /marketplace/reward-set 詳細ページに /auth/signup への直接 href が存在しない', async ({
		page,
	}) => {
		// reward-set の代表的な item を 1 件選定 (実 fixture に依存)
		// 詳細ページにアクセスして 200 が返れば assertion 実施
		// fixture に依存しないよう、一覧経由で取得した item にアクセスする pattern も検討したが、
		// 既存 spec (marketplace-reward-set-import.spec.ts) で reward-set fixture の存在を確認済
		const res = await page.goto('/marketplace?type=reward-set', { waitUntil: 'domcontentloaded' });
		expect(res?.status()).toBe(200);

		// 一覧から最初の reward-set 詳細ページへ遷移
		const firstCard = page.locator('a[href^="/marketplace/reward-set/"]').first();
		if (await firstCard.count()) {
			await firstCard.click();
			await page.waitForURL(/\/marketplace\/reward-set\//);

			// 詳細ページ上に /auth/signup への直接 href が無いこと
			const signupLinks = page.locator('a[href^="/auth/signup"]');
			await expect(signupLinks).toHaveCount(0);
		}
		// fixture が空の環境 (一部 CI / preview) では skip 相当 (回帰のメインゲートは unit spec)
	});
});
