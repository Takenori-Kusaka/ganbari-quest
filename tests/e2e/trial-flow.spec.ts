// tests/e2e/trial-flow.spec.ts
// #752: トライアル開始→アクティブ→終了の全遷移 E2E
//
// cognito-dev モードの free ユーザー (free@example.com, dev-tenant-free) でログインし、
// TrialBanner の「7日間 無料で試す」ボタンからトライアルを開始。
// 開始前→開始後の UI 変化を検証する。
//
// 「終了」状態のテストは trial_history に過去日付のレコードを DB に直接挿入して再現する。
// E2E 後に trial_history をクリーンアップし、他テストに干渉しないようにする。
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts trial-flow

import { expect, test } from '@playwright/test';
import { loginAsPlan, warmupAdminPages } from './plan-login-helpers';

// cognito-dev free ユーザーのテナント ID
const FREE_TENANT_ID = 'dev-tenant-free';

test.beforeAll(async ({ browser }) => {
	test.setTimeout(360_000);
	await warmupAdminPages(browser, ['/admin', '/admin/license']);
});

test.describe('#752 トライアルフロー — 全遷移', () => {
	// テスト前に trial_history をクリーンアップして free ユーザーのトライアル未使用状態を保証
	test.beforeEach(async () => {
		test.slow();
		await cleanupTrialHistory();
	});

	test.afterAll(async () => {
		await cleanupTrialHistory();
	});

	test('未使用 free ユーザーに TrialBanner の「開始」状態が表示される', async ({ page }) => {
		await loginAsPlan(page, 'free');
		await page.goto('/admin', { waitUntil: 'networkidle' });

		const banner = page.getByTestId('trial-banner-not-started');
		await expect(banner).toBeVisible({ timeout: 15_000 });
		// 「7日間、全機能を無料で試せます」テキストの確認
		await expect(banner.getByText('7日間、全機能を無料で試せます')).toBeVisible();
		// 開始ボタンが存在し有効
		const startBtn = page.getByTestId('trial-banner-start-button');
		await expect(startBtn).toBeVisible();
		await expect(startBtn).toBeEnabled();
	});

	test('「7日間 無料で試す」ボタンでトライアルを開始するとバナーがアクティブ表示に切り替わる', async ({
		page,
	}) => {
		await loginAsPlan(page, 'free');
		await page.goto('/admin', { waitUntil: 'networkidle' });

		// 開始前: not-started バナーが見える
		const notStartedBanner = page.getByTestId('trial-banner-not-started');
		await expect(notStartedBanner).toBeVisible({ timeout: 15_000 });

		// トライアル開始
		const startBtn = page.getByTestId('trial-banner-start-button');
		await startBtn.click();

		// 開始後: アクティブバナーに切り替わる（invalidateAll で再描画されるのを待つ）
		// not-started バナーが消える
		await expect(notStartedBanner).toHaveCount(0, { timeout: 15_000 });

		// アクティブ表示: 「残りN日」テキストを含むバナーが表示
		await expect(page.getByText(/無料体験中（残り\d+日）/)).toBeVisible({ timeout: 15_000 });

		// プランを見る CTA が表示
		const activeCta = page.getByTestId('trial-banner-active-cta');
		await expect(activeCta).toBeVisible();
	});

	test('トライアル開始後に /admin/license の PlanStatusCard がトライアル中を反映する', async ({
		page,
	}) => {
		// まずトライアルを開始
		await loginAsPlan(page, 'free');
		await page.goto('/admin', { waitUntil: 'networkidle' });
		const startBtn = page.getByTestId('trial-banner-start-button');
		await expect(startBtn).toBeVisible({ timeout: 15_000 });
		await startBtn.click();
		await expect(page.getByText(/無料体験中/)).toBeVisible({ timeout: 15_000 });

		// license ページに遷移
		await page.goto('/admin/license', { waitUntil: 'networkidle' });

		// PlanStatusCard が standard (trial) を示す
		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 15_000 });
		// トライアル中は planTier=standard に解決されるため
		await expect(card).toHaveAttribute('data-plan-tier', 'standard');
	});

	test('トライアル終了後に TrialBanner が「終了」表示になりアップグレード CTA が出る', async ({
		page,
	}) => {
		// trial_history に過去の endDate でレコードを挿入して expired 状態を作る
		await insertExpiredTrial();

		await loginAsPlan(page, 'free');
		await page.goto('/admin', { waitUntil: 'networkidle' });

		// expired バナーが表示される
		const expiredBanner = page.getByTestId('trial-banner-expired');
		await expect(expiredBanner).toBeVisible({ timeout: 15_000 });
		await expect(expiredBanner.getByText('無料体験が終了しました')).toBeVisible();

		// アップグレード CTA が表示
		const upgradeCta = page.getByTestId('trial-banner-expired-cta');
		await expect(upgradeCta).toBeVisible();
		await expect(upgradeCta).toHaveAttribute('href', '/admin/license');
	});

	test('トライアル使用済みユーザーには開始ボタンが表示されない（1回限り）', async ({ page }) => {
		// expired trial を挿入
		await insertExpiredTrial();

		await loginAsPlan(page, 'free');
		await page.goto('/admin', { waitUntil: 'networkidle' });

		// not-started バナーではなく expired バナーが表示される
		await expect(page.getByTestId('trial-banner-expired')).toBeVisible({ timeout: 15_000 });
		// 開始ボタンは表示されない
		await expect(page.getByTestId('trial-banner-start-button')).toHaveCount(0);
		await expect(page.getByTestId('trial-banner-not-started')).toHaveCount(0);
	});
});

// --- ヘルパー関数 ---

/**
 * dev-tenant-free の trial_history をすべて削除してトライアル未使用状態に戻す
 */
async function cleanupTrialHistory(): Promise<void> {
	const Database = (await import('better-sqlite3')).default;
	const path = await import('node:path');
	const dbPath = path.resolve('data/ganbari-quest.db');
	const db = new Database(dbPath);
	try {
		db.prepare('DELETE FROM trial_history WHERE tenant_id = ?').run(FREE_TENANT_ID);
	} finally {
		db.close();
	}
}

/**
 * dev-tenant-free に expired trial_history を挿入して「トライアル終了」状態を作る
 */
async function insertExpiredTrial(): Promise<void> {
	const Database = (await import('better-sqlite3')).default;
	const path = await import('node:path');
	const dbPath = path.resolve('data/ganbari-quest.db');
	const db = new Database(dbPath);
	try {
		// まずクリーンアップ
		db.prepare('DELETE FROM trial_history WHERE tenant_id = ?').run(FREE_TENANT_ID);
		// 7日前に開始し、今日で期限切れの trial を挿入
		const endDate = new Date();
		endDate.setDate(endDate.getDate() - 1); // 昨日で終了
		const startDate = new Date(endDate);
		startDate.setDate(startDate.getDate() - 7);
		const fmt = (d: Date) =>
			`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		db.prepare(
			'INSERT INTO trial_history (tenant_id, start_date, end_date, tier, source) VALUES (?, ?, ?, ?, ?)',
		).run(FREE_TENANT_ID, fmt(startDate), fmt(endDate), 'standard', 'user_initiated');
	} finally {
		db.close();
	}
}
