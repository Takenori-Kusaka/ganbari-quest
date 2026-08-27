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
//  - /admin/rewards: 「+ 追加」manual の locked-but-active（free のみ lock マーカー、EPIC #3533 §10.2.3）
//
// #2316 削除済 ゲート:
//  - /admin/messages: ひとことメッセージボタン (free/standard disabled, family enabled)
//    → #2267 (PR #2293) で /admin/messages 廃止 + /admin/cheer 統合により、
//      メッセージ機能は応援機能の付随要素として全プラン解放された
//      (ADR-0006 assertion erosion ban に従い skip ではなく削除)

import { expect, test } from '@playwright/test';
import { openMenu } from './helpers/goal-flows';

// ============================================================
// /admin/rewards — #728 カスタムごほうびプランゲート
// ============================================================
test.describe('#776 /admin/rewards プランゲート — free', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	// EPIC #3533 §10.2.3: 旧 rewards-upgrade-banner (slot 4 常設 CTA バナー) は撤去。
	//   free の gate は「+ 追加」dropdown の manual 項目が locked-but-active (lock マーカー +
	//   選択でプラン画面遷移) で表現される。banner が消え、gate signal が manual 項目へ移ったことを検証する
	//   (ADR-0006: assertion は弱体化でなく新 UX 機構への置換。click→プラン画面遷移の goal 完遂は AC6 で担保)。
	test('free プランでは manual 追加が locked-but-active (lock マーカー) + 常設バナーなし', async ({
		page,
	}) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
		// #4609: Ark UI Menu の trigger は hydration 前 click が握り潰される。共有 helper で開く
		await openMenu(page, 'rewards-add-menu', 'menu-item-manual');
		await expect(page.getByTestId('menu-item-manual')).toContainText('🔒');
	});

	// #4705: free tier は marketplace の取込 CTA から着地しても **子供選択 dialog を開かない**。
	// 旧挙動 (#2894) は dialog → 全員選択 → 確定 → POST 後に 403 で拒否しており、
	// 「押せる → 子供まで選ばせる → 断る」という順序そのものが問題だった (PO 指摘)。
	// assertion は弱めていない: 403 表示の検証を「そもそも到達させない」検証に置き換え、
	// 拒否の実体 (server action / REST の gate) は unit で保持する
	// (tests/unit/routes/admin-rewards-actions.test.ts / special-rewards-api-plan-gate.test.ts)。
	test('free プランで reward-set 取込 URL に着地 → dialog を開かず条件を先に示す (#4705)', async ({
		page,
	}) => {
		test.slow(); // Vite dev コールドコンパイル耐性

		await page.goto('/admin/rewards?import=kinder-rewards', { waitUntil: 'domcontentloaded' });

		// 条件メッセージが出る (banner は role=status、Toast と 2 層防御)
		const banner = page.getByTestId('rewards-action-message');
		await expect(banner).toBeVisible({ timeout: 15_000 });
		await expect(banner).not.toContainText('[object Object]');
		await expect(banner).toContainText('スタンダードプラン');

		// 子供選択 dialog は開かない (子供を選ばせてから拒否しない)
		await expect(page.getByTestId('reward-import-child-selection-dialog')).toHaveCount(0);

		// NN/G #9: 次の行き先が示される
		const upgradeLink = page.getByTestId('rewards-upgrade-link');
		await expect(upgradeLink).toBeVisible();
		await expect(upgradeLink).toHaveAttribute('href', '/admin/subscription');
	});

	// #4705: marketplace 詳細でも **押す前に** 条件が出る (CTA 自体を差し替える)。
	test('free プランで reward-set 詳細 → 取込 CTA が条件表示に差し替わる (#4705)', async ({
		page,
	}) => {
		test.slow();

		await page.goto('/marketplace/reward-set/kinder-rewards', { waitUntil: 'domcontentloaded' });
		const locked = page.getByTestId('marketplace-import-locked');
		await expect(locked).toBeVisible({ timeout: 15_000 });
		await expect(locked).toContainText('スタンダードプラン');
		// 取込 CTA (押すと子供選択に進む導線) は出さない
		await expect(page.getByTestId('reward-set-import-cta')).toHaveCount(0);
		await expect(page.getByTestId('marketplace-import-locked-cta')).toHaveAttribute(
			'href',
			'/admin/subscription',
		);
	});

	// #4705: 交換型ルール (rule-preset exchange) も取込先が /admin/rewards なので同じ扱い。
	test('free プランで 交換型ルール詳細 → 取込 CTA が条件表示に差し替わる (#4705)', async ({
		page,
	}) => {
		test.slow();

		await page.goto('/marketplace/rule-preset/night-owl-pass', {
			waitUntil: 'domcontentloaded',
		});
		await expect(page.getByTestId('marketplace-import-locked')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId('rule-preset-import-cta')).toHaveCount(0);
	});
});

test.describe('#776 /admin/rewards プランゲート — standard', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('standard プランでは manual 追加が gate なし (lock マーカーなし) + 常設バナーなし', async ({
		page,
	}) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
		// #4609: Ark UI Menu の trigger は hydration 前 click が握り潰される。共有 helper で開く
		await openMenu(page, 'rewards-add-menu', 'menu-item-manual');
		await expect(page.getByTestId('menu-item-manual')).not.toContainText('🔒');
	});

	// #2894 AC5: paid tier (standard) は reward-set 取込が成功し一覧に反映される
	// (free の 403 と対になる positive case)。upgrade 導線は出ない。
	test('standard プランで reward-set 取込 → 成功 + upgrade 導線なし (#2894 AC5)', async ({
		page,
	}) => {
		test.slow();

		await page.goto('/admin/rewards?import=kinder-rewards', { waitUntil: 'domcontentloaded' });
		const dialog = page.getByTestId('reward-import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 15_000 });

		const confirm = page.getByTestId('child-selection-confirm');
		await expect(confirm).toBeEnabled();
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/importPresetToChildren/.test(r.url())),
			confirm.click(),
		]);
		expect(resp.ok()).toBeTruthy();

		// 成功 banner が出て `[object Object]` も upgrade 導線も出ない。
		const banner = page.getByTestId('rewards-action-message');
		await expect(banner).toBeVisible({ timeout: 10_000 });
		await expect(banner).not.toContainText('[object Object]');
		await expect(banner).not.toContainText('スタンダードプラン以上');
		await expect(page.getByTestId('rewards-upgrade-link')).toHaveCount(0);
	});
});

test.describe('#776 /admin/rewards プランゲート — family', () => {
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('family プランでは manual 追加が gate なし (lock マーカーなし) + 常設バナーなし', async ({
		page,
	}) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
		// #4609: Ark UI Menu の trigger は hydration 前 click が握り潰される。共有 helper で開く
		await openMenu(page, 'rewards-add-menu', 'menu-item-manual');
		await expect(page.getByTestId('menu-item-manual')).not.toContainText('🔒');
	});
});

// ============================================================
// /admin/challenges — #2402 QM must-3 (OWASP A01) challenge-set import family ゲート
// ============================================================
// 兄弟チャレンジは family-only 機能。client-side `{#if !isFamily}` UI ゲートを
// 直接 POST でバイパスできないよう、サーバー側でも family プラン厳密比較を実施。
//
// **検証層**: unit テスト (`tests/unit/routes/admin-challenges-marketplace-import-plan-gate.test.ts`)
// で action handler を直接呼び出して検証する。
//
// E2E (`request.post`) で同等の検証を試みたところ、SvelteKit の CSRF 保護
// (`Cross-site POST form submissions are forbidden`) が family ゲートに到達する前に
// レスポンスを差し替えるため、E2E 層で gate メッセージを assert できない問題があった
// (PR #2402 e2e-cognito-dev failure)。
// unit テストで action handler を直接呼ぶことで CSRF を回避しつつ、ADR-0006 に従い
// 403 family gate の assertion 強度は維持する (検証層を移動するだけで弱体化させない)。
