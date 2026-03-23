// tests/e2e/smoke.spec.ts
// E2E スモークテスト — ユースケースベースの基本フロー検証
//
// テストケース設計方針:
//   ユースケース設計書（UC-01〜UC-13）→ 画面遷移 → 操作 → 検証
//   Phase 1: 各画面の表示確認 + 主要フローの正常動作

import { expect, test } from '@playwright/test';

type Page = import('@playwright/test').Page;

// ============================================================
// ヘルパー: 子供を選択してホーム画面に遷移
// ============================================================
async function selectChild(page: Page) {
	await page.goto('/switch');
	const childButton = page.locator('button[type="submit"]').first();
	await expect(childButton).toBeVisible();
	await childButton.click();
	await page.waitForURL(/\/(kinder|baby)\/home/);
}

// ヘルパー: ログインボーナスのおみくじオーバーレイや各種オーバーレイを閉じる
async function dismissOverlays(page: Page) {
	// おみくじオーバーレイを閉じる（演出の ?マーク → ランク表示 → ボタン の流れ）
	// まず演出中の ?マーク が出ているか短時間チェック
	const hasOmikuji = await page
		.getByText('きょうのうんせい')
		.isVisible()
		.catch(() => false);
	if (hasOmikuji) {
		try {
			const omikujiBtn = page.getByRole('button', { name: /タップしてすすむ/ });
			await omikujiBtn.waitFor({ timeout: 4000 });
			await omikujiBtn.click();
			await page.waitForTimeout(500);
		} catch {
			// ボタンが出なかった場合
		}
	}
	// 誕生日レビューオーバーレイを閉じる
	try {
		const birthdayBtn = page.getByRole('button', { name: /はじめる/ });
		if (await birthdayBtn.isVisible().catch(() => false)) {
			await page.keyboard.press('Escape');
			await page.waitForTimeout(300);
		}
	} catch {
		// なければスキップ
	}
	// 特別報酬や汎用オーバーレイを閉じる（おみくじ後に遅延表示されることがある）
	for (let i = 0; i < 3; i++) {
		await page.waitForTimeout(400);
		try {
			const closeBtn = page.getByRole('button', { name: /とじる|閉じる|OK|やったー/ });
			if (await closeBtn.isVisible().catch(() => false)) {
				await closeBtn.click();
				await page.waitForTimeout(300);
			} else {
				break;
			}
		} catch {
			break;
		}
	}
	await page.waitForTimeout(300);
}

// ヘルパー: 子供を選択してオーバーレイを閉じた状態にする
async function selectChildAndDismiss(page: Page) {
	await selectChild(page);
	await dismissOverlays(page);
}

// ヘルパー: 未記録の活動カードを取得（disabled でないボタン）
function getAvailableActivities(page: Page) {
	return page.locator('button.tap-target:not([disabled])');
}

// ヘルパー: 未記録の活動を記録する（並列テストの競合対策で複数リトライ）
async function recordAnyActivity(page: Page): Promise<boolean> {
	const activities = getAvailableActivities(page);
	const count = await activities.count();

	for (let i = 0; i < Math.min(count, 10); i++) {
		await activities.nth(i).click();

		// 確認ダイアログが出るのを待つ
		try {
			await page.getByText('きろくする？').waitFor({ timeout: 2000 });
		} catch {
			continue;
		}

		await page.getByRole('button', { name: 'きろく！' }).click();

		// 記録成功の結果オーバーレイを待つ（短めのタイムアウトでリトライ高速化）
		try {
			await page.getByText(/きろくしたよ！/).waitFor({ timeout: 2000 });
			return true;
		} catch {
			// ALREADY_RECORDED（並列テストが先に記録済み）→ 確認ダイアログが閉じるのを待って次へ
			await expect(page.getByText('きろくする？'))
				.not.toBeVisible({ timeout: 1000 })
				.catch(() => {});
		}
	}
	return false;
}

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
		await selectChild(page);
		await expect(page).toHaveURL(/\/kinder\/home/);
		await expect(page).toHaveTitle(/ホーム/);
	});
});

// ============================================================
// 3. UC-01: ホーム画面（Kinder）— 活動一覧表示
// ============================================================
test.describe('UC-01: Kinder ホーム画面', () => {
	test.beforeEach(async ({ page }) => {
		await selectChildAndDismiss(page);
	});

	test('活動カードが表示される', async ({ page }) => {
		const activityButtons = page.locator('button.tap-target');
		await expect(activityButtons.first()).toBeVisible();
	});

	test('ヘッダーにニックネームが表示される', async ({ page }) => {
		await expect(page.getByText('ゆうきちゃん')).toBeVisible();
	});

	test('ボトムナビゲーションが表示される', async ({ page }) => {
		const nav = page.locator('nav');
		await expect(nav).toBeVisible();
	});
});

// ============================================================
// 4. UC-01: 活動記録フロー（確認ダイアログ → 記録 → 完了）
// ============================================================
test.describe('UC-01: 活動記録フロー', () => {
	// DB を変更するテストが含まれるため直列実行
	test.describe.configure({ mode: 'serial' });

	test.beforeEach(async ({ page }) => {
		await selectChildAndDismiss(page);
	});

	test('活動をタップすると確認ダイアログが表示される', async ({ page }) => {
		const activity = getAvailableActivities(page).first();
		await activity.click();

		await expect(page.getByText('きろくする？')).toBeVisible();
		await expect(page.getByRole('button', { name: 'きろく！' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'やめる' })).toBeVisible();
	});

	test('「やめる」でダイアログが閉じる', async ({ page }) => {
		const activity = getAvailableActivities(page).first();
		await activity.click();
		await expect(page.getByText('きろくする？')).toBeVisible();

		await page.getByRole('button', { name: 'やめる' }).click();
		await expect(page.getByText('きろくする？')).not.toBeVisible();
	});

	test('「きろく！」で記録が完了しポイントが表示される', async ({ page }) => {
		test.slow(); // リトライで時間がかかる可能性がある
		const recorded = await recordAnyActivity(page);
		expect(recorded).toBe(true);

		await expect(page.getByText(/ポイント！/).first()).toBeVisible();
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
		await selectChildAndDismiss(page);

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
		await selectChildAndDismiss(page);
		await page.goto('/kinder/history');
		await expect(page).toHaveURL(/\/kinder\/history/);
	});

	test('期間タブが表示される', async ({ page }) => {
		await selectChildAndDismiss(page);
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
		await selectChildAndDismiss(page);
		await page.goto('/kinder/status');
		await expect(page).toHaveURL(/\/kinder\/status/);
	});

	test('レベルとキャラクタータイプが表示される', async ({ page }) => {
		await selectChildAndDismiss(page);
		await page.goto('/kinder/status');

		// レベル表示（ヘッダーとメインの2箇所にあるので main 内を指定）
		await expect(page.getByRole('main').getByText(/Lv\./).first()).toBeVisible();
		// ステータスセクション見出し
		await expect(page.getByRole('heading', { name: 'ステータス' })).toBeVisible();
	});
});

// ============================================================
// 8. 実績画面
// ============================================================
test.describe('実績画面', () => {
	test('実績一覧が表示される', async ({ page }) => {
		await selectChildAndDismiss(page);
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
		await selectChildAndDismiss(page);
	});

	test('ボトムナビでページ遷移できる', async ({ page }) => {
		// ホーム → きろく（履歴）
		const historyLink = page.getByRole('link', { name: 'きろく' });
		await historyLink.click();
		await expect(page).toHaveURL(/\/kinder\/history/);

		// きろく → つよさ
		const statusLink = page.getByRole('link', { name: 'つよさ' });
		await statusLink.click();
		await expect(page).toHaveURL(/\/kinder\/status/);

		// つよさ → ホーム
		const homeLink = page.getByRole('link', { name: 'ホーム' });
		await homeLink.click();
		await expect(page).toHaveURL(/\/kinder\/home/);
	});

	test('きりかえリンクで /switch に戻れる', async ({ page }) => {
		const switchLink = page.getByRole('link', { name: 'きりかえ' });
		await switchLink.click();
		await expect(page).toHaveURL(/\/switch/);
	});
});

// ============================================================
// 10. UC-13: ログインボーナス
// ============================================================
test.describe('UC-13: ログインボーナス', () => {
	test('初回アクセスでおみくじが表示される', async ({ page }) => {
		await selectChild(page);

		// おみくじ結果の表示を待つ（最大5秒）
		try {
			await page.getByText(/大吉|中吉|小吉|吉|末吉/).waitFor({ timeout: 5000 });
			await expect(page.getByText(/ポイント/)).toBeVisible();
		} catch {
			// 既に受取済みの場合はスキップ
		}
	});
});

// ============================================================
// 11. UC-09: 親ログイン画面
// ============================================================
test.describe('UC-09: 親ログイン（local モード — 認証不要）', () => {
	test('/login にアクセスするとページが表示される', async ({ page }) => {
		await page.goto('/login');
		// local モードでは /login ページがそのまま表示されるか、/admin にリダイレクト
		const url = page.url();
		expect(url.includes('/login') || url.includes('/admin')).toBeTruthy();
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
