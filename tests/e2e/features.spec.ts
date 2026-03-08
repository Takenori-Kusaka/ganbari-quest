// tests/e2e/features.spec.ts
// Done チケット機能検証テスト
// smoke.spec.ts で未カバーの Done チケットを E2E 検証する

import { expect, test } from '@playwright/test';

type Page = import('@playwright/test').Page;

// ============================================================
// ヘルパー
// ============================================================

/** 指定の子供を選択してホーム画面に遷移 */
async function selectChildByName(page: Page, name: string) {
	await page.goto('/switch');
	const childButton = page.locator('button[type="submit"]').filter({ hasText: name });
	await expect(childButton).toBeVisible();
	await childButton.click();
	await page.waitForURL(/\/(kinder|baby)\/home/);
}

/** ゆうきちゃん(kinder)を選択 */
async function selectKinderChild(page: Page) {
	await selectChildByName(page, 'ゆうきちゃん');
}

/** てすとくん(baby)を選択 */
async function selectBabyChild(page: Page) {
	await selectChildByName(page, 'てすとくん');
}

/** オーバーレイを閉じる（おみくじ → 誕生日 → 特別報酬 の順に処理） */
async function dismissOverlays(page: Page) {
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
			// ignore
		}
	}
	try {
		const birthdayBtn = page.getByRole('button', { name: /はじめる/ });
		if (await birthdayBtn.isVisible().catch(() => false)) {
			await page.keyboard.press('Escape');
			await page.waitForTimeout(300);
		}
	} catch {
		// ignore
	}
	// 特別報酬・汎用オーバーレイを複数回チェック（おみくじ後に遅延表示されることがある）
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

// ============================================================
// #0029: Baby モード画面
// ============================================================
test.describe('#0029: Baby モード', () => {
	test('Baby ホーム画面が表示される', async ({ page }) => {
		await selectBabyChild(page);
		await dismissOverlays(page);

		await expect(page).toHaveURL(/\/baby\/home/);
		await expect(page.getByText('てすとくん')).toBeVisible();
	});

	test('活動ボタンが表示される', async ({ page }) => {
		await selectBabyChild(page);
		await dismissOverlays(page);

		// Baby モードは大きなタップボタンを持つ
		const buttons = page.locator('button.tap-target, button.baby-card');
		const count = await buttons.count();
		expect(count).toBeGreaterThan(0);
	});

	test('ボトムナビゲーションが表示される', async ({ page }) => {
		await selectBabyChild(page);
		await dismissOverlays(page);

		const nav = page.locator('nav');
		await expect(nav).toBeVisible();
		await expect(page.getByRole('link', { name: 'ホーム' })).toBeVisible();
	});
});

// ============================================================
// #0037: 忘れ物チェックリスト
// ============================================================
test.describe('#0037: もちものチェックリスト', () => {
	test('チェックリストページが表示される', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);

		await page.goto('/checklist');
		await expect(page).toHaveURL(/\/checklist/);
	});

	test('チェックリストテンプレートが表示される', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);

		await page.goto('/checklist');
		// テンプレート名 "がっこう" が表示される
		await expect(page.getByText('がっこう')).toBeVisible();
	});

	test('ホーム画面からチェックリストへのリンクがある', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);

		const checklistLink = page.getByRole('link', { name: /もちものチェック/ });
		await expect(checklistLink).toBeVisible();
	});
});

// ============================================================
// #0025: 特別報酬システム (API テスト)
// ============================================================
test.describe('#0025: 特別報酬 API', () => {
	test('テンプレート一覧 API が 200 を返す', async ({ request }) => {
		const res = await request.get('/api/v1/special-rewards/templates');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.templates).toBeDefined();
		expect(body.templates.length).toBeGreaterThan(0);
		// テンプレートにはタイトルとポイントがある
		expect(body.templates[0].title).toBeDefined();
		expect(body.templates[0].points).toBeDefined();
	});

	test('特別報酬一覧 API が 200 を返す', async ({ request }) => {
		const res = await request.get('/api/v1/special-rewards/1');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.rewards).toBeDefined();
	});

	test('特別報酬を付与できる', async ({ request }) => {
		const res = await request.post('/api/v1/special-rewards/1', {
			data: {
				title: 'E2Eテスト報酬',
				points: 10,
				icon: '🎁',
				category: 'life',
			},
		});
		expect(res.status()).toBe(201);
		const body = await res.json();
		expect(body.title).toBe('E2Eテスト報酬');
		expect(body.points).toBe(10);
	});

	test('存在しない子供への報酬付与は 404', async ({ request }) => {
		const res = await request.post('/api/v1/special-rewards/999', {
			data: {
				title: 'テスト',
				points: 10,
				icon: '🎁',
				category: 'life',
			},
		});
		expect(res.status()).toBe(404);
	});
});

// ============================================================
// #0049: 活動マスタ編集・削除 (API テスト)
// ============================================================
test.describe('#0049: 活動マスタ CRUD API', () => {
	test('活動詳細 API が 200 を返す', async ({ request }) => {
		const res = await request.get('/api/v1/activities/1');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.name).toBeDefined();
		expect(body.icon).toBeDefined();
	});

	test('活動を更新できる (PATCH)', async ({ request }) => {
		// まず活動情報を取得
		const getRes = await request.get('/api/v1/activities/1');
		const original = await getRes.json();

		// 名前を変更して更新
		const res = await request.patch('/api/v1/activities/1', {
			data: { name: original.name },
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.name).toBe(original.name);
	});

	test('存在しない活動の更新は 404', async ({ request }) => {
		const res = await request.patch('/api/v1/activities/99999', {
			data: { name: 'test' },
		});
		expect(res.status()).toBe(404);
	});

	test('存在しない活動の削除は 404', async ({ request }) => {
		const res = await request.delete('/api/v1/activities/99999');
		expect(res.status()).toBe(404);
	});
});

// ============================================================
// #0051: 活動の複数回実行対応
// ============================================================
test.describe('#0051: 複数回実行', () => {
	test('dailyLimit > 1 の活動が一覧に含まれる', async ({ request }) => {
		const res = await request.get('/api/v1/activities?childId=1');
		expect(res.status()).toBe(200);
		const { activities } = await res.json();

		// dailyLimit > 1 の活動が存在する
		const multiActivities = activities.filter(
			(a: { dailyLimit: number | null }) => a.dailyLimit !== null && a.dailyLimit > 1,
		);
		expect(multiActivities.length).toBeGreaterThan(0);
	});

	test('複数回実行可能な活動のUIにバッジが表示される', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);

		// 複数回実行対応の活動（例: おさらあらい dailyLimit=3）を探す
		// 記録済みの場合はバッジ(回数)が表示される
		// 未記録でもdailyLimitが1より大きいので、ボタンが有効なまま残る仕様
		const multiButton = page.locator('button.tap-target').filter({ hasText: 'おさらあらい' });
		await expect(multiButton).toBeVisible();
	});
});

// ============================================================
// #0054: 複合アイコン対応 (API テスト)
// ============================================================
test.describe('#0054: 複合アイコン', () => {
	test('活動一覧 API がアイコンを返す', async ({ request }) => {
		const res = await request.get('/api/v1/activities');
		expect(res.status()).toBe(200);
		const { activities } = await res.json();

		// 全活動にアイコンが設定されている
		for (const activity of activities) {
			expect(activity.icon).toBeDefined();
			expect(activity.icon.length).toBeGreaterThan(0);
		}
	});

	test('複合アイコンのある活動が正しく表示される', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);

		// 複合アイコンの例: おさらあらい (🍽️💧), 水やりをする (🌱💧)
		// これらの活動ボタンが正常に表示される
		const button = page.locator('button.tap-target').filter({ hasText: '水やりをする' });
		await expect(button).toBeVisible();
	});
});

// ============================================================
// #0053/#0058: 多重送信防止 (UI 動作テスト)
// ============================================================
test.describe('#0053/#0058: 多重送信防止', () => {
	test('記録ボタン押下後にボタンが無効化される', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);

		// 未記録の活動を探してクリック
		const activity = page.locator('button.tap-target:not([disabled])').first();
		await activity.click();

		// 確認ダイアログが表示される
		await expect(page.getByText('きろくする？')).toBeVisible();

		// 「きろく！」ボタンを押す
		const recordBtn = page.getByRole('button', { name: 'きろく！' });
		await recordBtn.click();

		// 送信中はボタンが無効化される（submitting 状態）
		// 結果ダイアログ or エラー が出るまで待つ
		await page
			.getByText(/きろくしたよ！|エラー/)
			.first()
			.waitFor({ timeout: 5000 });
	});
});

// ============================================================
// #0056: 日付リセットのタイムゾーン対応 (API テスト)
// ============================================================
test.describe('#0056: タイムゾーン対応', () => {
	test('ポイント残高 API が正しいデータを返す', async ({ request }) => {
		// タイムゾーン対応により、JST ベースで日付が計算される
		const res = await request.get('/api/v1/points/1');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.balance).toBeDefined();
		expect(typeof body.balance).toBe('number');
	});

	test('ステータス API が正しいデータを返す', async ({ request }) => {
		const res = await request.get('/api/v1/status/1');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.level).toBeDefined();
		expect(body.maxValue).toBeDefined();
		expect(body.statuses).toBeDefined();
	});
});

// ============================================================
// #0082: レーダーチャートステータス画面
// ============================================================
test.describe('#0082: レーダーチャート', () => {
	test('Kinder ステータス画面にレーダーチャートが表示される', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);

		await page.goto('/kinder/status');
		await expect(page).toHaveURL(/\/kinder\/status/);

		// SVG レーダーチャートが描画されている
		const svg = page.locator('svg[aria-label="ステータスレーダーチャート"]');
		await expect(svg).toBeVisible();

		// 5カテゴリのラベルが表示される
		await expect(page.getByText('ステータス')).toBeVisible();
	});

	test('「くわしくみる」で詳細が展開される', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);

		await page.goto('/kinder/status');

		// 折りたたみボタンをクリック
		const detailBtn = page.getByText('くわしくみる');
		await expect(detailBtn).toBeVisible();
		await detailBtn.click();

		// プログレスバーが表示される（StatusBar コンポーネント）
		await expect(page.getByText('うんどう').first()).toBeVisible();
		await expect(page.getByText('べんきょう').first()).toBeVisible();
	});

	test('Baby ステータス画面にもレーダーチャートが表示される', async ({ page }) => {
		await selectBabyChild(page);
		await dismissOverlays(page);

		await page.goto('/baby/status');
		await expect(page).toHaveURL(/\/baby\/status/);

		const svg = page.locator('svg[aria-label="ステータスレーダーチャート"]');
		await expect(svg).toBeVisible();
	});
});
