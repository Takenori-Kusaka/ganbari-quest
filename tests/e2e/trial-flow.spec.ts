// tests/e2e/trial-flow.spec.ts
// #752: トライアル開始→アクティブ→終了の全遷移 E2E
//
// AUTH_MODE=cognito + COGNITO_DEV_MODE=true で実行。
// - dev-tenant-free: トライアル未使用の free ユーザー
// - dev-tenant-trial-expired: トライアル期限切れ済みの free ユーザー
//   （global-setup.ts で trial_history に過去日レコードをシード）
//
// #1535: loginAsPlan() を storageState ベースに移行（describe ブロック分割）
//        beforeAll warmup は削除（storageState + dev サーバーなら不要）
//        DB クリーンアップロジックは保持（テスト間副作用防止のため必要）
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts trial-flow

import path from 'node:path';
import { expect, test } from '@playwright/test';

// ============================================================
// free ユーザーのトライアルフロー（開始 → active → license 確認）
// serial モードで順番に実行（テスト3はテスト2の副作用に依存）
// ============================================================
test.describe('#752 トライアルフロー — free ユーザー', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });
	// MUST: テスト 3 はテスト 2 でトライアルが開始された状態に依存するため serial 実行必須
	test.describe.configure({ mode: 'serial' });

	// テスト 2 で dev-tenant-free のトライアルを開始するため、
	// テスト終了後にクリーンアップして plan-free.spec.ts への副作用を防ぐ
	test.afterAll(async () => {
		const Database = (await import('better-sqlite3')).default;
		const dbPath = path.resolve('data/ganbari-quest.db');
		const db = new Database(dbPath);
		try {
			const result = db
				.prepare("DELETE FROM trial_history WHERE tenant_id = 'dev-tenant-free'")
				.run();
			if (result.changes > 0) {
				console.log(
					`[trial-flow cleanup] Removed ${result.changes} trial record(s) for dev-tenant-free.`,
				);
			}
		} finally {
			db.close();
		}
	});

	// ========================================================
	// 1. 未使用 free ユーザーにトライアル開始導線が表示
	// ========================================================
	test('free ユーザーに TrialBanner の「開始」状態が表示される', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		const banner = page.getByTestId('trial-banner-not-started');
		await expect(banner).toBeVisible({ timeout: 30_000 });
		// "7日間 無料で試す" ボタンが存在
		await expect(page.getByTestId('trial-banner-start-button')).toBeVisible();
		// #1383: 誤字「試すます」→「試せます」を検知できるよう完全一致でアサート
		await expect(banner).toContainText('7日間、全機能を無料で試せます');
	});

	// ========================================================
	// 2. 「7日間無料で試す」ボタンでトライアル開始 → active 状態
	// ========================================================
	test('トライアル開始ボタンクリック → active バナーに切り替わる', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		// 「開始」バナーが表示されるまで待機
		await page
			.getByTestId('trial-banner-start-button')
			.waitFor({ state: 'visible', timeout: 30_000 });

		// トライアル開始ボタンをクリック
		await page.getByTestId('trial-banner-start-button').click();

		// ページが更新されてアクティブバナーに切り替わる
		// active バナーには "残りN日" テキストが表示される
		await expect(page.getByText(/無料体験中/)).toBeVisible({ timeout: 30_000 });
		// CTA「プランを見る」リンクが表示される
		await expect(page.getByTestId('trial-banner-active-cta')).toBeVisible();
		// 「開始」バナーは消える
		await expect(page.getByTestId('trial-banner-not-started')).toHaveCount(0);

		// #2932 CRITICAL: reload 後も trial 状態が維持される（insert が永続していることの確認）。
		// stub の no-op insert だった頃は reload で「開始」バナーに戻っていた（偽 success）。
		await page.reload({ waitUntil: 'commit', timeout: 30_000 });
		await expect(page.getByText(/無料体験中/)).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('trial-banner-not-started')).toHaveCount(0);
	});

	// ========================================================
	// 3. トライアル開始後 — /admin/subscription でトライアルステータス表示
	// ========================================================
	test('トライアル開始後に /admin/subscription でトライアル情報が表示される', async ({ page }) => {
		// Note: 前のテストでトライアルが開始されている前提（同一 tenant DB が共有）。
		// トライアル中は resolvePlanTier() が planTier='standard' に昇格させるため、
		// license ページの `{#if planTier === 'free'}` トライアルセクションは表示されない。
		// 代わりに PlanStatusCard の trial-badge（isTrialActive で描画）で検証する。
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		const trialBadge = page.getByTestId('plan-status-trial-badge');
		await expect(trialBadge).toBeVisible({ timeout: 30_000 });
		await expect(trialBadge).toContainText(/残り.*日/);
	});
});

// ============================================================
// trial-expired ユーザーの確認
// ============================================================
test.describe('#752 トライアルフロー — trial-expired ユーザー', () => {
	test.use({ storageState: 'playwright/.auth/trial-expired.json' });

	// ========================================================
	// 4. トライアル期限切れユーザー — expired バナー表示
	// ========================================================
	test('トライアル期限切れユーザーに expired バナーが表示される', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		const expiredBanner = page.getByTestId('trial-banner-expired');
		await expect(expiredBanner).toBeVisible({ timeout: 30_000 });
		// 「無料体験が終了しました」テキスト
		await expect(expiredBanner).toContainText('終了');
		// アップグレード CTA が表示される
		await expect(page.getByTestId('trial-banner-expired-cta')).toBeVisible();
	});

	// ========================================================
	// 5. 期限切れユーザー — 再トライアル開始ボタンが存在しない
	// ========================================================
	test('トライアル使用済みユーザーには「開始」ボタンが表示されない', async ({ page }) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });

		// expired バナーが表示されるまで待つ
		await page.getByTestId('trial-banner-expired').waitFor({ state: 'visible', timeout: 30_000 });
		// 「開始」ボタンは表示されない（trialUsed=true なので canStartTrial=false）
		await expect(page.getByTestId('trial-banner-start-button')).toHaveCount(0);
	});

	// ========================================================
	// 6. 期限切れ後に /admin/subscription でトライアル終了状態が表示される
	// ========================================================
	test('期限切れ後の /admin/subscription でトライアル終了が反映される', async ({ page }) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		// license ページの PlanStatusCard が free を示す
		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card).toHaveAttribute('data-plan-tier', 'free');
	});
});

// ============================================================
// #2941 項目 2: negative path — trialUsed=true 再押下で fail(400) が
// ユーザーに見えるエラーメッセージとして表示される (NN/G #1)
// ============================================================
test.describe('#2941 トライアル開始 negative path — 使用済み tenant の再押下', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	// 本 describe は dev-tenant-free に使用済み trial を直接 seed するため、
	// 終了後にクリーンアップして plan-free.spec.ts 等への副作用を防ぐ
	// (上の free describe と同パターン)
	test.afterAll(async () => {
		const Database = (await import('better-sqlite3')).default;
		const dbPath = path.resolve('data/ganbari-quest.db');
		const db = new Database(dbPath);
		try {
			const result = db
				.prepare("DELETE FROM trial_history WHERE tenant_id = 'dev-tenant-free'")
				.run();
			if (result.changes > 0) {
				console.log(
					`[trial-negative cleanup] Removed ${result.changes} trial record(s) for dev-tenant-free.`,
				);
			}
		} finally {
			db.close();
		}
	});

	test('stale 画面から「開始」再押下 → 400 エラーがユーザーに見える形で表示される', async ({
		page,
	}) => {
		// 1. trial 未使用状態で /admin を開く（「開始」ボタンが見える stale 画面を作る）
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });
		await expect(page.getByTestId('trial-banner-start-button')).toBeVisible({ timeout: 30_000 });
		// #702 hydration marker: use:enhance バインド前に click すると native form POST に
		// fallback して /admin/subscription へ全画面遷移してしまうため、hydration 完了を待つ
		await page.waitForFunction(() => window.__APP_HYDRATED__ === true, undefined, {
			timeout: 30_000,
		});

		// 2. 「別タブで既に開始済み」の状況を再現: DB に使用済み trial を直接 seed
		//    (global-setup.ts の dev-tenant-trial-expired seed と同手法)
		const Database = (await import('better-sqlite3')).default;
		const db = new Database(path.resolve('data/ganbari-quest.db'));
		try {
			const pastEnd = new Date();
			pastEnd.setDate(pastEnd.getDate() - 3);
			const pastStart = new Date();
			pastStart.setDate(pastStart.getDate() - 10);
			db.prepare(
				'INSERT INTO trial_history (tenant_id, start_date, end_date, tier, source) VALUES (?, ?, ?, ?, ?)',
			).run(
				'dev-tenant-free',
				pastStart.toISOString().split('T')[0],
				pastEnd.toISOString().split('T')[0],
				'standard',
				'user_initiated',
			);
		} finally {
			db.close();
		}

		// 3. stale 画面の「開始」ボタンを再押下 → server action は startTrial=false で fail(400)
		await page.getByTestId('trial-banner-start-button').click();

		// 4. NN/G #1: 400 が黙殺されず、role=alert のエラーメッセージとして表示される
		//    (getActionErrorDisplay #2913 経路、TRIAL_LABELS.startErrorAlreadyUsed)
		const error = page.getByTestId('trial-banner-start-error');
		await expect(error).toBeVisible({ timeout: 30_000 });
		await expect(error).toHaveText('無料体験はすでに使用済みです');
		await expect(error).toHaveAttribute('role', 'alert');
	});
});
