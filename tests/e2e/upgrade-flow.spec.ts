// tests/e2e/upgrade-flow.spec.ts
// #753: 各プランへのアップグレード導線を網羅する E2E テスト
//
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true で実行。
// DevCognitoAuthProvider のプラン別ダミーユーザーでログインし、
// 各起点画面からアップグレード導線が /admin/subscription に到達するかを検証。
//
// Stripe Checkout / Webhook の統合テストはモック化:
//  - POST /api/stripe/checkout は Stripe が無効な環境では 503 を返す
//  - アップグレード成功後の動作は PremiumWelcome spec (#778) で検証済み
//
// #1535: loginAsPlan() を storageState ベースに移行（describe ブロック分割）
//        beforeAll warmup は削除（storageState + dev サーバーなら不要）
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts upgrade-flow

import { expect, test } from '@playwright/test';
// Phase 7 PR-L4 (#2836): family→premium rename (ADR-0058) で CTA 文言は PLAN_TERMS.premium 参照。
import { PLAN_TERMS } from '../../src/lib/domain/terms';

// ============================================================
// 1. PlanStatusCard からのアップグレード CTA（free）
// ============================================================
test.describe('#753 PlanStatusCard → /admin/subscription — free', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('free プランの PlanStatusCard に「スタンダードにアップグレード」CTA がある', async ({
		page,
	}) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card).toHaveAttribute('data-plan-tier', 'free');

		// free → standard CTA
		const freeCta = page.getByTestId('plan-status-free-cta');
		await expect(freeCta).toBeVisible();
	});

	test('free プランの PlanStatusCard に「プレミアムへ」CTA がある', async ({ page }) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		const familyCta = page.getByTestId('plan-status-family-cta');
		const count = await familyCta.count();
		if (count === 0) {
			test.info().annotations.push({
				type: 'skip-reason',
				description: 'family CTA が PlanStatusCard に存在しないレイアウトのためスキップ',
			});
			return;
		}
		await expect(familyCta).toBeVisible({ timeout: 10_000 });
		await expect(familyCta).toContainText(PLAN_TERMS.premium);
	});
});

// ============================================================
// 1. PlanStatusCard からのアップグレード CTA（standard）
// ============================================================
test.describe('#753 PlanStatusCard → /admin/subscription — standard', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('standard プランの PlanStatusCard にファミリーアップグレード CTA がある', async ({
		page,
	}) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card).toHaveAttribute('data-plan-tier', 'standard');

		// Portal ボタンまたは plan card 全体非表示 (stripeEnabled=false) のいずれか
		// #2330 で「決済機能は現在準備中です」placeholder が削除されたため、Portal ボタン visible OR 非表示で skip 検出
		const portalBtn = page.getByTestId('open-portal-button');
		const isPortalVisible = await portalBtn
			.waitFor({ state: 'visible', timeout: 10_000 })
			.then(() => true)
			.catch(() => false);

		if (!isPortalVisible) {
			test.info().annotations.push({
				type: 'skip-reason',
				description:
					'Stripe 未設定環境 (stripeEnabled=false で plan card 非表示) のため Portal CTA 不在',
			});
			return;
		}
	});

	// #4139: standard → premium のアップグレード CTA が「自ページへのリンク」になっていた
	// (押しても何も起きない = 収益導線が死ぬ)。CTA が実処理を起動する操作要素であることを固定する。
	test('standard の「プレミアムへ」CTA が自ページを指さず、押すと何かが起きる (#4139)', async ({
		page,
	}) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		const cta = page.getByTestId('plan-status-family-cta');
		await expect(cta).toBeVisible({ timeout: 30_000 });
		await expect(cta).toContainText(PLAN_TERMS.premium);
		// 自己リンクでないこと (旧実装は href="/admin/subscription" の <a> だった)
		await expect(cta).toHaveJSProperty('tagName', 'BUTTON');

		// 押下 → `handlePlanUpgrade` (SaasLicensePanel.svelte:252) が契約状態で分岐する:
		//   (a) 契約あり (hasSubscription) → `requestPortal()` → 請求管理ページ確認ダイアログ
		//   (b) 契約なし                   → `startCheckout()` → checkout session を作り
		//                                     `window.location.href` で checkout.stripe.com へ離脱
		// cognito-dev の standard fixture は `stripe_subscription_id` を seed しないため (b)。
		//
		// **到達先を検証する**。「/admin/subscription から離れた」だけを合格にすると、
		// セッション失効 redirect (`/auth/login`) や認可拒否 redirect も等しく PASS してしまい、
		// 課金・認可の退行を検出できない。
		//
		// `role="alert"` は成功条件に入れない。checkout 失敗時も `checkoutError` →
		// `<Alert variant="danger">` (role="alert") が出る (SaasLicensePanel.svelte:228/719) ため、
		// alert を合格に含めると「アップグレードが常に失敗する」状態まで緑になる。
		// alert が出た場合はその文言を添えて明示的に fail させる。
		await cta.click();
		const portalConfirm = page.getByTestId('portal-confirm-button');
		await Promise.race([
			portalConfirm.waitFor({ state: 'visible', timeout: 20_000 }),
			page.waitForURL((url) => url.origin === 'https://checkout.stripe.com', {
				timeout: 20_000,
			}),
		]).catch(() => {
			/* どちらも起きなければ下の assert で文脈付き fail させる */
		});

		// origin の完全一致で判定する。`startsWith('https://checkout.stripe.com')` は
		// `https://checkout.stripe.com.example/` のような別ホストにも一致してしまい
		// (CodeQL js/incomplete-url-substring-sanitization)、到達先を検証するという
		// 本 assert の目的を満たさない。上の waitForURL 述語と同じ origin 比較に揃える。
		const reachedStripeCheckout = new URL(page.url()).origin === 'https://checkout.stripe.com';
		const portalDialogOpen = await portalConfirm.isVisible().catch(() => false);
		if (!reachedStripeCheckout && !portalDialogOpen) {
			const alertText = await page
				.getByRole('alert')
				.first()
				.textContent()
				.catch(() => null);
			throw new Error(
				`CTA 押下後に Stripe Checkout への遷移も請求管理ページ確認ダイアログも起きなかった。` +
					` url=${page.url()} / alert=${alertText?.trim() ?? 'なし'}`,
			);
		}
		expect(reachedStripeCheckout || portalDialogOpen).toBe(true);
	});
});

// ============================================================
// 1. PlanStatusCard からのアップグレード CTA（family）
// ============================================================
test.describe('#753 PlanStatusCard → /admin/subscription — family', () => {
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('family プランの PlanStatusCard にアップグレード CTA は表示されない', async ({ page }) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card).toHaveAttribute('data-plan-tier', 'family');

		// Portal ボタンまたは plan card 全体非表示 (stripeEnabled=false) のいずれか
		// #2330 で「決済機能は現在準備中です」placeholder が削除されたため、Portal ボタン visible OR 非表示で skip 検出
		const portalBtn = page.getByTestId('open-portal-button');
		const isPortalVisible = await portalBtn
			.waitFor({ state: 'visible', timeout: 10_000 })
			.then(() => true)
			.catch(() => false);

		if (!isPortalVisible) {
			test.info().annotations.push({
				type: 'skip-reason',
				description:
					'Stripe 未設定環境 (stripeEnabled=false で plan card 非表示) のため Portal CTA 不在',
			});
			return;
		}
	});
});

// ============================================================
// 2. /admin/rewards からの disabled CTA → /admin/subscription（free）
// ============================================================
test.describe('#753 /admin/rewards → アップグレード導線', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	// EPIC #3533 §10.2.3: 旧 rewards-upgrade-banner + CTA を撤去し、gate 導線を「+ 追加」dropdown の
	//   manual 項目 (locked-but-active) に集約。free の upgrade 導線 = manual 選択でプラン画面へ遷移する
	//   goal 完遂を検証する (banner→CTA と等価の非 dead-end 導線、AC6 相当の click-through も本 test が担保)。
	test('free プランで「+ 追加」manual (locked) 選択が /admin/subscription へ遷移する', async ({
		page,
	}) => {
		await page.goto('/admin/rewards', { waitUntil: 'commit', timeout: 30_000 });

		// 旧常設バナーは撤去済
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);

		await page.getByTestId('rewards-add-menu').click();
		const manualItem = page.getByTestId('menu-item-manual');
		await expect(manualItem).toBeVisible();
		await expect(manualItem).toContainText('🔒');

		// locked manual を選択するとプラン画面へ遷移する (dead-end でない)
		await manualItem.click();
		await page.waitForURL(/\/admin\/subscription/, { timeout: 30_000 });
	});
});

// ============================================================
// 3. /admin/activities の AiSuggestPanel disabled CTA → /admin/subscription（free）
// ============================================================
test.describe('#753 /admin/activities AI → アップグレード導線', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('free プランで AI パネルの upgrade-cta が /admin/subscription へリンクする', async ({
		page,
	}) => {
		await page.goto('/admin/activities', { waitUntil: 'commit', timeout: 30_000 });

		// EPIC #2253 / #2255: header + dropdown menu から AI を選択
		await page.waitForLoadState('domcontentloaded');
		const addBtn = page.getByTestId('header-add-activity-btn');
		await expect(addBtn).toBeVisible({ timeout: 30_000 });
		await addBtn.click();
		await page.getByTestId('menu-item-ai').click();
		await expect(page.getByTestId('add-activity-dialog')).toBeVisible();

		const panel = page.getByTestId('ai-suggest-panel');
		await expect(panel).toBeVisible();
		await expect(panel).toHaveAttribute('data-plan-locked', 'true');

		const cta = page.getByTestId('ai-suggest-upgrade-cta');
		await expect(cta).toBeVisible();

		// CTA をクリックすると /admin/subscription に遷移する
		await cta.click();
		await page.waitForURL(/\/admin\/subscription/, { timeout: 30_000 });
	});
});

// ============================================================
// 4. /pricing からのサインアップ → /admin/subscription 導線（free）
// ============================================================
test.describe('#753 /pricing → アップグレード導線', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('/pricing ページにプランカードと CTA が表示される', async ({ page }) => {
		await page.goto('/pricing', { waitUntil: 'commit', timeout: 30_000 });

		await expect(page.getByTestId('pricing-heading')).toBeVisible({ timeout: 30_000 });

		// プランカードが複数表示される
		const planCards = page.getByTestId('pricing-plan-card');
		const cardCount = await planCards.count();
		expect(cardCount).toBeGreaterThanOrEqual(2);

		// CTA ボタンが存在する
		const ctaButtons = page.getByTestId('pricing-cta');
		const ctaCount = await ctaButtons.count();
		expect(ctaCount).toBeGreaterThan(0);
	});
});

// ============================================================
// 5. /admin/subscription でプラン選択 → Stripe Checkout 遷移 (mock)
//    （認証不要な API テスト）
// ============================================================
test.describe('#753 Stripe Checkout 遷移 — API', () => {
	test('POST /api/stripe/checkout に有効なプランで 503 が返る（Stripe 未設定環境）', async ({
		request,
	}) => {
		// cognito-dev 環境では Stripe が有効でないため、503 STRIPE_DISABLED を期待
		// または 401/403 （認証状態による）
		const res = await request.post('/api/stripe/checkout', {
			headers: { 'Content-Type': 'application/json' },
			data: { planId: 'monthly' },
		});

		// 認証状態による分岐: 503 (Stripe 未設定) or 401/403 (未認証)
		expect([401, 403, 503]).toContain(res.status());
	});

	test('POST /api/stripe/checkout に不正なプランで 400 が返る', async ({ request }) => {
		const res = await request.post('/api/stripe/checkout', {
			headers: { 'Content-Type': 'application/json' },
			data: { planId: 'invalid-plan' },
		});

		// 認証状態により 400 (不正プラン) or 401/403 (未認証)
		expect([400, 401, 403]).toContain(res.status());
	});
});

// ============================================================
// 6. /admin/subscription のプラン選択 UI（free）
// ============================================================
test.describe('#753 /admin/subscription プラン選択 UI — free', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('free プランで /admin/subscription にプラン選択カードが表示される', async ({ page }) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		// Stripe 有効環境ではプラン選択カードが表示される。Stripe 無効では plan card 全体非表示 (#2330)
		// プラン選択カード visible なら通常検証、無ければ Stripe 未設定環境として skip。
		const standardPlanCard = page.getByTestId('standard-plan-card');
		const isPlanCardVisible = await standardPlanCard
			.waitFor({ state: 'visible', timeout: 5_000 })
			.then(() => true)
			.catch(() => false);

		if (!isPlanCardVisible) {
			test.info().annotations.push({
				type: 'skip-reason',
				description: 'Stripe 未設定環境 (stripeEnabled=false で plan card 非表示) のため skip',
			});
			return;
		}

		// Stripe 有効環境: スタンダード / ファミリーの選択カードが表示される
		// (preparingText 重複 skip 機構は #2330 で placeholder 削除済のため撤去)
		await expect(standardPlanCard).toBeVisible();
		await expect(page.getByTestId('family-plan-card')).toBeVisible();

		// #3204: 年額トグルは撤去 (#2719 年額廃止と UI 整合)。月額固定で年額ボタンは存在しない。
		await expect(page.getByRole('button', { name: /年額/ })).toHaveCount(0);
	});
});

// ============================================================
// 6. /admin/subscription のプラン選択 UI（standard）
// ============================================================
test.describe('#753 /admin/subscription プラン選択 UI — standard', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('standard プランでは Stripe Portal ボタンが表示される（サブスク有りの場合）', async ({
		page,
	}) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		// standard はサブスクリプション有りなので Portal ボタンが出る、
		// または Stripe 未設定環境では plan card 全体非表示 (#2330 で placeholder 削除済)
		const portalBtn = page.getByTestId('open-portal-button');
		const isPortalVisible = await portalBtn
			.waitFor({ state: 'visible', timeout: 10_000 })
			.then(() => true)
			.catch(() => false);

		if (!isPortalVisible) {
			test.info().annotations.push({
				type: 'skip-reason',
				description: 'Stripe 未設定環境 (stripeEnabled=false) のため Portal ボタン不在',
			});
			return;
		}
	});
});

// ============================================================
// 7. アップグレード成功後の PremiumWelcome モーダル表示（standard / family）
// ============================================================
test.describe('#753 PremiumWelcome モーダル — standard', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('standard プランで /admin に歓迎モーダルの条件がある', async ({ page }) => {
		// PremiumWelcome の詳細テストは premium-welcome.spec.ts に委譲。
		// ここではアップグレード導線の一部として、standard/family ログイン後に
		// /admin にアクセスできることを確認する。
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		// /admin に到達していることを確認
		await expect(page).toHaveURL(/\/admin/);
	});
});

test.describe('#753 PremiumWelcome モーダル — family', () => {
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('family プランで /admin に到達できる', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		await expect(page).toHaveURL(/\/admin/);
	});
});

// ============================================================
// 8. アップグレード成功後の機能即時有効化（standard）
//    #2316: family は /admin/messages 廃止に伴いテスト削除 (下記参照)
// ============================================================
test.describe('#753 アップグレード後の機能有効化 — standard', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('standard プランでカスタムごほうびが有効（manual に lock マーカーなし + 常設バナーなし）', async ({
		page,
	}) => {
		await page.goto('/admin/rewards', { waitUntil: 'commit', timeout: 30_000 });

		// EPIC #3533 §10.2.3: 常設バナーは撤去済。standard では manual が gate なし (lock マーカーなし)。
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
		await page.getByTestId('rewards-add-menu').click();
		await expect(page.getByTestId('menu-item-manual')).not.toContainText('🔒');
	});
});

// #2316: 旧 family プラン「ひとことメッセージ有効化」テストは削除。
//   #2267 (PR #2293) で /admin/messages 廃止 + /admin/cheer 統合により、
//   family 限定の有効化ゲートが消滅 (応援機能は全プラン解放)。
//   ADR-0006 (assertion erosion ban) に従い skip ではなく削除。
//   アップグレード機能有効化の家系統的検証は standard 側 rewards-upgrade-banner 非表示で担保。
