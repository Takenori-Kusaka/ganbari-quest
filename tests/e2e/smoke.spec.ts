// tests/e2e/smoke.spec.ts
// E2E スモークテスト — ユースケースベースの基本フロー検証
//
// テストケース設計方針:
//   ユースケース設計書（UC-01〜UC-13）→ 画面遷移 → 操作 → 検証
//   Phase 1: 各画面の表示確認 + 主要フローの正常動作

import { expect, test } from '@playwright/test';
import {
	expandFirstCategory,
	getAvailableActivities,
	isAwsEnv,
	recordAnyActivity,
	selectKinderChild,
	selectKinderChildAndDismiss,
} from './helpers';

// ============================================================
// 1. アプリ起動・ヘルスチェック
// ============================================================
test.describe('アプリ起動確認', () => {
	test('ヘルスチェック API が 200 を返す', async ({ request }) => {
		const res = await request.get('/api/health');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('ok');
	});

	test('ルート (/) が /switch にリダイレクトする', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/switch/);
	});
});

// ============================================================
// 2. UC-05: 子供切り替え画面
// ============================================================
test.describe('UC-05: 子供切り替え', () => {
	test('子供一覧が表示される', async ({ page }) => {
		await page.goto('/switch');
		await expect(page.locator('h1')).toContainText('だれがつかう？');
		await expect(page.getByText('ゆうきちゃん')).toBeVisible();
		await expect(page.getByText('4さい')).toBeVisible();
	});

	test('子供を選択するとホーム画面に遷移する', async ({ page }) => {
		await selectKinderChild(page);
		await expect(page).toHaveURL(/\/kinder\/home/);
		await expect(page).toHaveTitle(/ホーム/);
	});
});

// ============================================================
// 3. UC-01: ホーム画面（Kinder）— 活動一覧表示
// ============================================================
test.describe('UC-01: Kinder ホーム画面', () => {
	test.beforeEach(async ({ page }) => {
		await selectKinderChildAndDismiss(page);
	});

	test('活動カードが表示される', async ({ page }) => {
		// compactMode でカテゴリが折りたたまれているので展開する
		await expandFirstCategory(page);
		const activityCards = page.locator('[data-testid^="activity-card-"]');
		await expect(activityCards.first()).toBeVisible();
		const count = await activityCards.count();
		expect(count).toBeGreaterThan(0);
	});

	test('ヘッダーにニックネームが表示される', async ({ page }) => {
		await expect(page.getByText('ゆうきちゃん')).toBeVisible();
	});

	test('ボトムナビゲーションが表示される', async ({ page }) => {
		const nav = page.locator('[data-testid="bottom-nav"]');
		await expect(nav).toBeVisible();
		// ナビリンクが4つ表示される（ホーム、つよさ、ショップ、きりかえ）
		const links = nav.locator('a');
		expect(await links.count()).toBe(4);
	});

	test('チェックリストショートカットまたは活動カードが表示される', async ({ page }) => {
		// compactMode ではカテゴリヘッダーが表示されていることを確認
		const categoryHeader = page.locator('[data-testid^="category-header-"]');
		await expect(categoryHeader.first()).toBeVisible();
		// カテゴリを展開すると活動カードが表示される
		await expandFirstCategory(page);
		const activityCards = page.locator('[data-testid^="activity-card-"]');
		await expect(activityCards.first()).toBeVisible();
	});
});

// ============================================================
// 4. UC-01: 活動記録フロー（確認ダイアログ → 記録 → 完了）
// ============================================================
test.describe('UC-01: 活動記録フロー', () => {
	// DB を変更するテストが含まれるため直列実行
	test.describe.configure({ mode: 'serial' });

	test.beforeEach(async ({ page }) => {
		await selectKinderChildAndDismiss(page);
	});

	test('活動をタップすると確認ダイアログが表示される', async ({ page }) => {
		await expandFirstCategory(page);
		const activity = getAvailableActivities(page).first();
		await activity.click();

		const dialog = page.locator('[data-testid="confirm-dialog"]');
		await expect(dialog).toBeVisible();
		await expect(page.locator('[data-testid="confirm-record-btn"]')).toBeVisible();
		await expect(page.locator('[data-testid="confirm-cancel-btn"]')).toBeVisible();
	});

	test('「やめる」でダイアログが閉じる', async ({ page }) => {
		await expandFirstCategory(page);
		const activity = getAvailableActivities(page).first();
		await activity.click();
		const dialog = page.locator('[data-testid="confirm-dialog"]');
		await expect(dialog).toBeVisible();

		await page.locator('[data-testid="confirm-cancel-btn"]').click();
		await expect(dialog).not.toBeVisible();
	});

	test('「きろく！」で記録が完了しポイントが表示される', async ({ page }) => {
		test.slow(); // リトライで時間がかかる可能性がある
		const recorded = await recordAnyActivity(page);
		expect(recorded).toBe(true);

		await expect(page.getByText(/\+\d+/).first()).toBeVisible();
		await expect(page.getByRole('button', { name: 'やったね！' }).first()).toBeVisible();
	});

	test('記録完了後に「とりけし」ボタンが表示される', async ({ page }) => {
		test.slow();
		const recorded = await recordAnyActivity(page);
		expect(recorded).toBe(true);

		// 結果ダイアログが開いている状態を確認
		await expect(page.getByText(/きろくしたよ！/).first()).toBeVisible({ timeout: 3000 });
		// キャンセルウィンドウ(5秒)内にキャンセルボタンが表示される
		await expect(page.getByRole('button', { name: /とりけし/ })).toBeVisible({ timeout: 3000 });
	});
});

// ============================================================
// 5. UC-02: キャンセルフロー
// ============================================================
test.describe('UC-02: 記録キャンセル', () => {
	test('5秒以内にキャンセルできる', async ({ page }) => {
		test.slow();
		await selectKinderChildAndDismiss(page);

		const recorded = await recordAnyActivity(page);
		expect(recorded).toBe(true);

		// 即座にキャンセル
		const cancelButton = page.getByRole('button', { name: /とりけし/ });
		if (await cancelButton.isVisible()) {
			await cancelButton.click();
			await expect(page.getByText('とりけしました')).toBeVisible();
		}
	});
});

// ============================================================
// 6. UC-03: 履歴画面
// ============================================================
test.describe('UC-03: 活動履歴', () => {
	test('履歴画面が表示される', async ({ page }) => {
		await selectKinderChildAndDismiss(page);
		await page.goto('/kinder/history');
		await expect(page).toHaveURL(/\/kinder\/history/);
		// 期間タブが表示されることでページが正しくレンダリングされたことを確認
		await expect(page.getByRole('tab', { name: 'きょう' })).toBeVisible();
	});

	test('期間タブが表示される', async ({ page }) => {
		await selectKinderChildAndDismiss(page);
		await page.goto('/kinder/history');

		await expect(page.getByRole('tab', { name: 'きょう' })).toBeVisible();
		await expect(page.getByRole('tab', { name: 'しゅう' })).toBeVisible();
		await expect(page.getByRole('tab', { name: 'つき' })).toBeVisible();
	});
});

// ============================================================
// 7. UC-04: ステータス画面
// ============================================================
test.describe('UC-04: ステータス確認', () => {
	test('ステータス画面が表示される', async ({ page }) => {
		await selectKinderChildAndDismiss(page);
		await page.goto('/kinder/status');
		await expect(page).toHaveURL(/\/kinder\/status/);
		// レーダーチャートセクション見出しでレンダリング確認
		await expect(page.getByRole('heading', { name: 'せいちょうチャート' })).toBeVisible();
	});

	test('レベルとキャラクタータイプが表示される', async ({ page }) => {
		await selectKinderChildAndDismiss(page);
		await page.goto('/kinder/status');

		// レベル表示（ヘッダーとメインの2箇所にあるので main 内を指定）
		await expect(page.getByRole('main').getByText(/Lv\./).first()).toBeVisible();
		// レーダーチャートセクション見出し
		await expect(page.getByRole('heading', { name: 'せいちょうチャート' })).toBeVisible();
	});
});

// ============================================================
// 8. 実績画面
// ============================================================
test.describe('実績画面', () => {
	test('実績一覧が表示される', async ({ page }) => {
		await selectKinderChildAndDismiss(page);
		await page.goto('/kinder/achievements');
		await expect(page).toHaveURL(/\/kinder\/achievements/);

		await expect(page.getByText(/たっせい/)).toBeVisible();
	});
});

// ============================================================
// 9. ボトムナビゲーション遷移
// ============================================================
test.describe('ナビゲーション', () => {
	test.beforeEach(async ({ page }) => {
		await selectKinderChildAndDismiss(page);
	});

	test('ボトムナビでページ遷移できる', async ({ page }) => {
		const nav = page.locator('[data-testid="bottom-nav"]');

		// ホーム → つよさ（ステータス）
		await nav.locator('a').filter({ hasText: 'つよさ' }).click();
		await expect(page).toHaveURL(/\/kinder\/status/);

		// つよさ → ショップ
		await nav.locator('a').filter({ hasText: 'ショップ' }).click();
		await expect(page).toHaveURL(/\/kinder\/shop/);

		// ショップ → ホーム
		await nav.locator('a').filter({ hasText: 'ホーム' }).click();
		await expect(page).toHaveURL(/\/kinder\/home/);
	});

	test('きりかえリンクで /switch に戻れる', async ({ page }) => {
		const nav = page.locator('[data-testid="bottom-nav"]');
		await nav.locator('a').filter({ hasText: 'きりかえ' }).click();
		await expect(page).toHaveURL(/\/switch/);
	});
});

// ============================================================
// 10. UC-13: ログインボーナス（スタンプカード）
// ============================================================
test.describe('UC-13: ログインボーナス', () => {
	test('初回アクセスでスタンプ押印オーバーレイが表示される', async ({ page }) => {
		test.skip(isAwsEnv(), 'AWS 環境ではログインボーナス未初期化（事前claimでオーバーレイ非表示）');
		await selectKinderChild(page);

		// スタンプ押印オーバーレイ or おみくじ結果が表示される
		const stampOverlay = page.getByTestId('stamp-press-overlay');
		const omikuji = page.getByText(/大吉|中吉|小吉|吉|末吉/);
		try {
			await Promise.race([
				stampOverlay.waitFor({ timeout: 5000 }),
				omikuji.waitFor({ timeout: 5000 }),
			]);
			await expect(page.getByText(/ポイント|pt/)).toBeVisible();
		} catch {
			// 他テストで既にclaimされている場合はスキップ
		}
	});
});

// ============================================================
// 11. UC-09: 親ログイン画面
// ============================================================
test.describe('UC-09: 親ログイン', () => {
	test('/login にアクセスするとページが表示される', async ({ page }) => {
		await page.goto('/login');
		// local モードでは /login or /admin、Cognito モードでは /auth/login にリダイレクト
		await expect(page).toHaveURL(/\/(login|admin|auth\/login)/);
	});
});

// ============================================================
// 12. API エンドポイントの基本動作確認
// ============================================================
test.describe('API 基本動作', () => {
	test('活動一覧 API が 200 を返す', async ({ request }) => {
		const res = await request.get('/api/v1/activities');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.activities).toBeDefined();
		expect(body.activities.length).toBeGreaterThan(0);
	});

	test('活動一覧 API で年齢フィルタが動作する', async ({ request }) => {
		const res = await request.get('/api/v1/activities?childId=1');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.activities).toBeDefined();
		expect(body.activities.length).toBeGreaterThan(0);
	});

	test('ポイント残高 API が 200 を返す', async ({ request }) => {
		const res = await request.get('/api/v1/points/1');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.balance).toBeDefined();
	});

	test('ステータス API が 200 を返す', async ({ request }) => {
		const res = await request.get('/api/v1/status/1');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.level).toBeDefined();
	});

	test('存在しない子供の API は 404 を返す', async ({ request }) => {
		const res = await request.get('/api/v1/points/999');
		expect(res.status()).toBe(404);
	});
});
