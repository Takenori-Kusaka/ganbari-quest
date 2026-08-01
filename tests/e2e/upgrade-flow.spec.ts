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

	// #4161: 旧テストは「family CTA が 0 件なら annotation を積んで return」で、実装
	//   (`PlanStatusCard.svelte` の `{:else if planTier === 'free'}` 分岐は free CTA のみ)
	//   では**常に 0 件 = 毎回 return** し、タイトルが主張する内容を一度も検証していなかった。
	//   実装の事実 (free の次の一歩は standard) を検証する形に直す。
	test('free プランの PlanStatusCard はアップグレード CTA を 1 本だけ出す (standard への 1 歩)', async ({
		page,
	}) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		const freeCta = page.getByTestId('plan-status-free-cta');
		await expect(freeCta).toBeVisible({ timeout: 10_000 });
		// free から premium への直行 CTA は出さない (選択肢を 1 本に絞る、Hick's Law)
		await expect(page.getByTestId('plan-status-family-cta')).toHaveCount(0);
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
		// standard には上位プランへの CTA が出る (テスト名が主張していた当のもの)
		await expect(page.getByTestId('plan-status-family-cta')).toBeVisible();

		// #4161: 旧実装は「請求管理ボタンが見えなければ annotation を積んで return」だった。
		//   このレーンでは契約なしが常なので**毎回 return し、何も検証していなかった**。
		//   請求管理ボタンの有無を決めるのは契約状態なので、それを読んで対応する側だけを検証する。
		const hasSubscription = await page
			.getByTestId('saas-license-panel')
			.getAttribute('data-has-subscription');
		expect(['true', 'false']).toContain(hasSubscription);
		const portalBtn = page.getByTestId('open-portal-button');
		if (hasSubscription === 'true') {
			await expect(portalBtn).toBeVisible();
		} else {
			// 契約なしは `{#if hasSubscription}` が false = ボタンごと非描画 (hidden ですらない)
			await expect(portalBtn).toHaveCount(0);
		}
	});

	// #4139: standard → premium のアップグレード CTA が「自ページへのリンク」になっていた
	// (押しても何も起きない = 収益導線が死ぬ)。CTA が実処理を起動する操作要素であることを固定する。
	//
	// #4161: 旧実装は「起こりうる結末」を or で並べており、どの環境でどちらの分岐が走るかを
	//   宣言していなかった。結末を or で並べると、走らなかった側は永久に評価されない死んだ
	//   部分式として残り、書いた本人にも「どちらが走ったか」が見えない。
	//   分岐を決める 2 変数 (`stripeEnabled` / `hasSubscription`) を実際に読んで表明し、
	//   その組み合わせに対応する 1 つの結末だけを検証する。
	test('standard の「プレミアムへ」CTA が自ページを指さず、宣言した分岐の実処理を起動する (#4139 / #4161)', async ({
		page,
	}) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		// --- どちらの分岐を検証しているかを、推測ではなく画面から読む ---
		const panel = page.getByTestId('saas-license-panel');
		await expect(panel).toBeVisible({ timeout: 30_000 });
		const stripeEnabled = await panel.getAttribute('data-stripe-enabled');
		const hasSubscription = await panel.getAttribute('data-has-subscription');
		// 属性が消える / 値が bool 以外になったら、分岐の宣言そのものが壊れているので落とす
		expect(['true', 'false']).toContain(stripeEnabled);
		expect(['true', 'false']).toContain(hasSubscription);

		// 本レーン (cognito-dev = AUTH_MODE=cognito + DATA_SOURCE 既定の sqlite) の前提を固定する。
		// sqlite の auth repo は stub テナントを返し `stripeSubscriptionId` を持たない
		// (`src/lib/server/db/sqlite/auth-repo.ts:22-32`) ため、**どの plan fixture でも契約なし**になる。
		// = 契約ありの portal 分岐はこのレーンでは原理的に到達できない。fixture / backend が変わって
		// ここが true になったら「検証すべき分岐が変わった」という意味で落とし、放置を防ぐ。
		// 契約あり (portal) 分岐は component 層で決定的に検証している:
		//   tests/unit/components/saas-license-panel-upgrade-branch.test.ts (b)
		expect(hasSubscription).toBe('false');

		const cta = page.getByTestId('plan-status-family-cta');
		await expect(cta).toBeVisible({ timeout: 30_000 });
		await expect(cta).toContainText(PLAN_TERMS.premium);
		// 自己リンクでないこと (旧実装は href="/admin/subscription" の <a> だった)
		await expect(cta).toHaveJSProperty('tagName', 'BUTTON');

		await cta.click();

		if (stripeEnabled === 'true') {
			// 契約なし + 決済有効 → `startCheckout()` が checkout session を作り離脱する。
			// **到達先まで検証する**。「/admin/subscription から離れた」だけを合格にすると、
			// セッション失効 redirect (`/auth/login`) や認可拒否 redirect も等しく PASS してしまう。
			// origin の完全一致で判定する (prefix 一致は `checkout.stripe.com.example` にも当たる、
			// CodeQL js/incomplete-url-substring-sanitization)。
			await page.waitForURL((url) => url.origin === 'https://checkout.stripe.com', {
				timeout: 30_000,
			});
			expect(new URL(page.url()).origin).toBe('https://checkout.stripe.com');
		} else {
			// 決済未設定 (fork PR 等で STRIPE_SECRET_KEY_TEST が供給されないレーン) では、
			// #4161 の是正どおり「理由を出して打ち切る」。PIN 付き確認ダイアログを開いて
			// 確定させた末に失敗する dead-end (#2544 型) になっていないことも併せて固定する。
			await expect(page.getByTestId('billing-unavailable-alert')).toBeVisible({
				timeout: 15_000,
			});
			await expect(page.getByTestId('portal-confirm-button')).toBeHidden();
			expect(new URL(page.url()).pathname).toBe('/admin/subscription');
		}
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

		// #4161: テスト名が主張している当のことを検証する (最上位プランなので上位への CTA は無い)。
		//   旧実装は請求管理ボタンが見えなければ annotation を積んで return するだけで、
		//   「CTA が表示されない」を一度も確かめていなかった。
		await expect(page.getByTestId('plan-status-family-cta')).toHaveCount(0);
		await expect(page.getByTestId('plan-status-free-cta')).toHaveCount(0);

		const hasSubscription = await page
			.getByTestId('saas-license-panel')
			.getAttribute('data-has-subscription');
		expect(['true', 'false']).toContain(hasSubscription);
		const portalBtn = page.getByTestId('open-portal-button');
		if (hasSubscription === 'true') {
			await expect(portalBtn).toBeVisible();
		} else {
			await expect(portalBtn).toHaveCount(0);
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

		// #4161: 旧実装は「plan card が見えなければ skip 理由を積んで return」で、
		//   決済未設定レーンでは何も検証しないまま緑になっていた。
		//   plan card の有無を決めるのは `stripeEnabled` なので、それを読んで両側を検証する。
		const stripeEnabled = await page
			.getByTestId('saas-license-panel')
			.getAttribute('data-stripe-enabled');
		expect(['true', 'false']).toContain(stripeEnabled);

		const standardPlanCard = page.getByTestId('standard-plan-card');
		if (stripeEnabled === 'true') {
			// スタンダード / ファミリーの選択カードが表示される
			await expect(standardPlanCard).toBeVisible({ timeout: 10_000 });
			await expect(page.getByTestId('family-plan-card')).toBeVisible();
		} else {
			// 決済未設定ではプラン管理カードごと非描画 (#2330 で placeholder 削除済)
			await expect(standardPlanCard).toHaveCount(0);
			await expect(page.getByTestId('family-plan-card')).toHaveCount(0);
		}

		// #3204: 年額トグルは撤去 (#2719 年額廃止と UI 整合)。月額固定で年額ボタンは存在しない。
		await expect(page.getByRole('button', { name: /年額/ })).toHaveCount(0);
	});
});

// ============================================================
// 6. /admin/subscription のプラン選択 UI（standard）
// ============================================================
test.describe('#753 /admin/subscription プラン選択 UI — standard', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	// #4161: 請求管理ボタンの表示条件は「決済有効 かつ 契約あり」の 2 条件。
	//   旧実装は不在なら return するだけで、条件と描画の対応を一度も確かめていなかった。
	test('請求管理ボタンの表示が「決済有効 かつ 契約あり」と一致する', async ({ page }) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		const panel = page.getByTestId('saas-license-panel');
		await expect(panel).toBeVisible({ timeout: 30_000 });
		const stripeEnabled = await panel.getAttribute('data-stripe-enabled');
		const hasSubscription = await panel.getAttribute('data-has-subscription');
		expect(['true', 'false']).toContain(stripeEnabled);
		expect(['true', 'false']).toContain(hasSubscription);

		const portalBtn = page.getByTestId('open-portal-button');
		if (stripeEnabled === 'true' && hasSubscription === 'true') {
			await expect(portalBtn).toBeVisible({ timeout: 10_000 });
		} else {
			await expect(portalBtn).toHaveCount(0);
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
