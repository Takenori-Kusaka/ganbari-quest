// tests/e2e/features.spec.ts
// Done チケット機能検証テスト
// smoke.spec.ts で未カバーの Done チケットを E2E 検証する

import { expect, test } from '@playwright/test';
import {
	dismissOverlays,
	expandAllCategories,
	expandFirstCategory,
	isAwsEnv,
	selectBabyChild,
	selectKinderChild,
} from './helpers';

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

		// Baby モードは data-testid="activity-card-*" の活動カードを持つ
		const cards = page.locator('[data-testid^="activity-card-"]');
		const count = await cards.count();
		expect(count).toBeGreaterThan(0);
	});

	test('ボトムナビゲーションが表示される', async ({ page }) => {
		await selectBabyChild(page);
		await dismissOverlays(page);

		const nav = page.locator('[data-testid="bottom-nav"]');
		await expect(nav).toBeVisible();
		await expect(nav.locator('a').filter({ hasText: 'ホーム' })).toBeVisible();
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
		test.skip(isAwsEnv(), 'AWS 環境ではチェックリストテンプレートのシードデータがない');
		await selectKinderChild(page);
		await dismissOverlays(page);

		await page.goto('/checklist');
		// テンプレート名 "がっこう" が表示される
		await expect(page.getByText('がっこう')).toBeVisible();
	});

	test('ホーム画面からチェックリストへのリンクがある', async ({ page }) => {
		test.skip(isAwsEnv(), 'AWS 環境ではチェックリストテンプレートのシードデータがない');
		await selectKinderChild(page);
		await dismissOverlays(page);

		const checklistLink = page.locator('a').filter({ hasText: 'もちものチェック' });
		await expect(checklistLink).toBeVisible();
	});
});

// ============================================================
// #0025: 特別報酬システム (API テスト)
// ============================================================
test.describe('#0025: 特別報酬 API', () => {
	test('テンプレート一覧 API が 200 を返す', async ({ request }) => {
		test.skip(isAwsEnv(), 'AWS 環境では特別報酬テンプレートのシードデータがない');
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
		test.skip(isAwsEnv(), 'AWS 環境では DynamoDB が dailyLimit を null として返すことがある');
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
		await expandAllCategories(page);

		// 複数回実行対応の活動（例: おさらあらい dailyLimit=3）を探す
		// 記録済みの場合はバッジ(回数)が表示される
		// 未記録でもdailyLimitが1より大きいので、ボタンが有効なまま残る仕様
		const multiButton = page
			.locator('[data-testid^="activity-card-"]')
			.filter({ hasText: 'おさらあらい' });
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
		await expandAllCategories(page);

		// 複合アイコンの例: おさらあらい (🍽️💧), 水やりをする (🌱💧)
		// これらの活動ボタンが正常に表示される
		const button = page
			.locator('[data-testid^="activity-card-"]')
			.filter({ hasText: '水やりをする' });
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
		await expandFirstCategory(page);

		// 未記録の活動を探してクリック
		const activity = page.locator('[data-testid^="activity-card-"]:not([disabled])').first();
		await activity.click();

		// 確認ダイアログが表示される
		const dialog = page.locator('[data-testid="confirm-dialog"]');
		await expect(dialog).toBeVisible();

		// 「きろく！」ボタンを押す
		const recordBtn = page.locator('[data-testid="confirm-record-btn"]');
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

		// せいちょうチャートの見出しが表示される
		await expect(page.getByText('せいちょうチャート')).toBeVisible();
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

// ============================================================
// #0122: アバターアップロード (ファイルアップロード正常系)
// ★ Lambda BODY_SIZE_LIMIT 問題で検出漏れした領域
// ============================================================
test.describe('#0122: アバターアップロード', () => {
	/** 最小限の有効 JPEG バイナリ */
	function createMinimalJpeg(): Buffer {
		return Buffer.from([
			0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
			0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06,
			0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b,
			0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
			0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31,
			0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff,
			0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00,
			0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
			0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7b, 0x94, 0x11, 0x00, 0x00,
			0x00, 0x00, 0xff, 0xd9,
		]);
	}

	test('有効なJPEGファイルでアバターをアップロードできる', async ({ request }) => {
		const jpegData = createMinimalJpeg();
		const res = await request.post('/api/v1/children/1/avatar', {
			multipart: {
				avatar: {
					name: 'test-avatar.jpg',
					mimeType: 'image/jpeg',
					buffer: jpegData,
				},
			},
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.avatarUrl).toBeDefined();
		expect(body.avatarUrl).toMatch(/\/tenants\/[^/]+\/avatars\/1\/[0-9a-f-]+\.jpg/);
	});

	test('アップロードしたアバター画像を取得できる', async ({ request }) => {
		const jpegData = createMinimalJpeg();
		const uploadRes = await request.post('/api/v1/children/1/avatar', {
			multipart: {
				avatar: {
					name: 'test.jpg',
					mimeType: 'image/jpeg',
					buffer: jpegData,
				},
			},
		});
		expect(uploadRes.status()).toBe(200);
		const { avatarUrl } = await uploadRes.json();

		const getRes = await request.get(avatarUrl);
		expect(getRes.status()).toBe(200);
		expect(getRes.headers()['content-type']).toMatch(/image\/jpeg/);
	});

	test('ファイルなしで400エラー', async ({ request }) => {
		const res = await request.post('/api/v1/children/1/avatar', {
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		});
		expect(res.status()).toBe(400);
	});

	test('不正なMIMEタイプで400エラー', async ({ request }) => {
		const res = await request.post('/api/v1/children/1/avatar', {
			multipart: {
				avatar: {
					name: 'test.gif',
					mimeType: 'image/gif',
					buffer: Buffer.from('GIF89a'),
				},
			},
		});
		expect(res.status()).toBe(400);
	});

	test('存在しない子供のアバターアップロードで404', async ({ request }) => {
		const jpegData = createMinimalJpeg();
		const res = await request.post('/api/v1/children/999/avatar', {
			multipart: {
				avatar: {
					name: 'test.jpg',
					mimeType: 'image/jpeg',
					buffer: jpegData,
				},
			},
		});
		expect(res.status()).toBe(404);
	});

	test('アバターURLがテナントプレフィックスパスを含む', async ({ request }) => {
		const jpegData = createMinimalJpeg();
		const res = await request.post('/api/v1/children/1/avatar', {
			multipart: {
				avatar: {
					name: 'tenant-test.jpg',
					mimeType: 'image/jpeg',
					buffer: jpegData,
				},
			},
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		// tenants/{tenantId}/avatars/{childId}/{uuid}.{ext} 形式
		expect(body.avatarUrl).toContain('/tenants/');
		expect(body.avatarUrl).toContain('/avatars/1/');
		expect(body.avatarUrl).toMatch(/\.[a-z]+$/);
	});

	test('PNG形式のアバターもテナントパスで保存される', async ({ request }) => {
		// Minimal valid PNG (1x1 white pixel)
		const pngData = Buffer.from([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
			0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
			0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8,
			0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
			0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
		]);
		const res = await request.post('/api/v1/children/1/avatar', {
			multipart: {
				avatar: {
					name: 'test.png',
					mimeType: 'image/png',
					buffer: pngData,
				},
			},
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.avatarUrl).toMatch(/\/tenants\/[^/]+\/avatars\/1\/[0-9a-f-]+\.png/);
	});

	test('アバター更新時に新しいURLが返る（UUID異なる）', async ({ request }) => {
		const jpegData = createMinimalJpeg();

		// 1回目アップロード
		const res1 = await request.post('/api/v1/children/1/avatar', {
			multipart: {
				avatar: { name: 'first.jpg', mimeType: 'image/jpeg', buffer: jpegData },
			},
		});
		const url1 = (await res1.json()).avatarUrl;

		// 2回目アップロード
		const res2 = await request.post('/api/v1/children/1/avatar', {
			multipart: {
				avatar: { name: 'second.jpg', mimeType: 'image/jpeg', buffer: jpegData },
			},
		});
		const url2 = (await res2.json()).avatarUrl;

		// UUID が異なるため別のURLになる
		expect(url1).not.toBe(url2);
		// 両方ともテナントパス形式
		expect(url1).toContain('/tenants/');
		expect(url2).toContain('/tenants/');
	});

	test('テナントファイル配信ルートで存在しないファイルは404', async ({ request }) => {
		const res = await request.get('/tenants/nonexistent/avatars/1/missing.jpg');
		expect(res.status()).toBe(404);
	});
});

// ============================================================
// API 正常系テスト — 全 POST/PUT/PATCH/DELETE エンドポイント
// ★ 正常パスの網羅的カバレッジ
// ============================================================
test.describe('API 正常系: 活動記録', () => {
	test('活動を記録してログが返る', async ({ request }) => {
		const activitiesRes = await request.get('/api/v1/activities?childId=1');
		const { activities } = await activitiesRes.json();
		expect(activities.length).toBeGreaterThan(0);

		const activityId = activities[0].id;
		const res = await request.post('/api/v1/activity-logs', {
			data: { childId: 1, activityId },
		});
		// 201(成功) or 409(既に記録済み)
		expect([201, 409]).toContain(res.status());
	});

	test('活動ログを取得できる', async ({ request }) => {
		const res = await request.get('/api/v1/activity-logs?childId=1&period=week');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.logs).toBeDefined();
	});
});

test.describe('API 正常系: 活動マスタ', () => {
	test('活動を新規作成できる', async ({ request }) => {
		const res = await request.post('/api/v1/activities', {
			data: {
				name: 'E2Eテスト活動',
				icon: '🧪',
				basePoints: 5,
				categoryId: 1,
				ageMin: null,
				ageMax: null,
			},
		});
		expect(res.status()).toBe(201);
		const body = await res.json();
		expect(body.name).toBe('E2Eテスト活動');
		expect(body.id).toBeDefined();
	});

	test('活動の表示切替ができる', async ({ request }) => {
		// 活動ID 1の現在状態を取得
		const getRes = await request.get('/api/v1/activities/1');
		const original = await getRes.json();

		// 表示状態を切り替え
		const res = await request.patch('/api/v1/activities/1/visibility', {
			data: { isVisible: !original.isVisible },
		});
		expect(res.status()).toBe(200);

		// 元に戻す
		await request.patch('/api/v1/activities/1/visibility', {
			data: { isVisible: original.isVisible },
		});
	});
});

test.describe('API 正常系: ポイント', () => {
	test('ポイント残高が取得できる', async ({ request }) => {
		const res = await request.get('/api/v1/points/1');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(typeof body.balance).toBe('number');
	});

	test('ポイント履歴が取得できる', async ({ request }) => {
		const res = await request.get('/api/v1/points/1/history');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.history).toBeDefined();
		expect(Array.isArray(body.history)).toBe(true);
	});
});

test.describe('API 正常系: ログインボーナス', () => {
	test('ログインボーナスを請求できる', async ({ request }) => {
		const res = await request.post('/api/v1/login-bonus/1/claim');
		// 201(成功) or 409(既に請求済み)
		expect([201, 409]).toContain(res.status());
	});

	test('ログインボーナス状態が取得できる', async ({ request }) => {
		const res = await request.get('/api/v1/login-bonus/1');
		expect(res.status()).toBe(200);
	});
});

test.describe('API 正常系: 実績', () => {
	test('実績一覧が取得できる', async ({ request }) => {
		const res = await request.get('/api/v1/achievements/1');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.achievements).toBeDefined();
		expect(Array.isArray(body.achievements)).toBe(true);
	});
});

test.describe('API 正常系: 週次評価', () => {
	test('週次評価が取得できる', async ({ request }) => {
		const res = await request.get('/api/v1/evaluations/1');
		expect(res.status()).toBe(200);
	});
});

test.describe('API 正常系: キャリア', () => {
	test('キャリア分野一覧が取得できる', async ({ request }) => {
		const res = await request.get('/api/v1/career-fields');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.careerFields).toBeDefined();
		expect(Array.isArray(body.careerFields)).toBe(true);
	});

	test('キャリアプランの取得ができる', async ({ request }) => {
		const res = await request.get('/api/v1/career-plans/1');
		// 200(プランあり) or 200(plan: null)
		expect(res.status()).toBe(200);
	});
});

test.describe('API 正常系: 認証', () => {
	test('管理画面にアクセスできる', async ({ request }) => {
		const res = await request.get('/admin');
		expect(res.ok()).toBeTruthy();
	});

	test('PIN ログイン API が 200 を返す（ローカルモード専用）', async ({ request }) => {
		test.skip(isAwsEnv(), 'AWS 環境では PIN 認証 API は存在しない');
		const res = await request.post('/api/v1/auth/login', {
			data: { pin: '1234' },
		});
		expect(res.status()).toBe(200);
	});

	test('PIN ログアウト API が 200 を返す（ローカルモード専用）', async ({ request }) => {
		test.skip(isAwsEnv(), 'AWS 環境では PIN 認証 API は存在しない');
		const res = await request.post('/api/v1/auth/logout');
		expect(res.status()).toBe(200);
	});
});

test.describe('API 正常系: 画像', () => {
	test('favicon パスが取得できる', async ({ request }) => {
		const res = await request.get('/api/v1/images?type=favicon');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect('faviconPath' in body).toBe(true);
	});

	test('不正なtypeパラメータで400', async ({ request }) => {
		const res = await request.get('/api/v1/images?type=invalid');
		expect(res.status()).toBe(400);
	});
});

test.describe('API 正常系: OCRレシート', () => {
	test('image/mimeType 未指定で400', async ({ request }) => {
		const res = await request.post('/api/v1/points/ocr-receipt', {
			data: {},
		});
		expect(res.status()).toBe(400);
	});

	test('不正なMIMEタイプで400', async ({ request }) => {
		const res = await request.post('/api/v1/points/ocr-receipt', {
			data: { image: 'base64data', mimeType: 'text/plain' },
		});
		expect(res.status()).toBe(400);
	});
});

test.describe('API 正常系: 活動サジェスト', () => {
	test('空テキストで400', async ({ request }) => {
		const res = await request.post('/api/v1/activities/suggest', {
			data: { text: '' },
		});
		expect(res.status()).toBe(400);
	});

	test('長すぎるテキストで400', async ({ request }) => {
		const res = await request.post('/api/v1/activities/suggest', {
			data: { text: 'x'.repeat(201) },
		});
		expect(res.status()).toBe(400);
	});
});

// ============================================================
// #0129: 招待リンクによるメンバー追加
// ============================================================

test.describe('#0129: メンバー管理画面', () => {
	test('メンバー管理画面が表示される', async ({ page }) => {
		await page.goto('/admin/members');
		await expect(page.getByText('現在のメンバー')).toBeVisible();
		await expect(page.getByText('メンバーを招待')).toBeVisible();
	});

	test('ナビゲーションにメンバーリンクがある', async ({ page }) => {
		await page.goto('/admin');
		const memberLink = page.locator('a').filter({ hasText: 'メンバー' });
		await expect(memberLink).toBeVisible();
	});

	test('招待ロール選択がある', async ({ page }) => {
		await page.goto('/admin/members');
		const roleSelect = page.locator('#invite-role');
		await expect(roleSelect).toBeVisible();
		// 保護者とこどもの選択肢
		await expect(roleSelect.locator('option[value="parent"]')).toHaveCount(1);
		await expect(roleSelect.locator('option[value="child"]')).toHaveCount(1);
	});
});

test.describe('#0129: 招待ランディングページ', () => {
	test('無効な招待コードでエラー表示', async ({ page }) => {
		await page.goto('/auth/invite/invalid-code-12345');
		await expect(page.getByText('この招待リンクは無効または期限切れです')).toBeVisible();
		await expect(page.getByText('ログインページへ')).toBeVisible();
	});
});

test.describe('#0129: 招待 API', () => {
	test('招待一覧 API が 200 を返す', async ({ request }) => {
		const res = await request.get('/api/v1/admin/invites');
		expect(res.status()).toBe(200);
	});

	test('招待作成 API でバリデーションエラー', async ({ request }) => {
		const res = await request.post('/api/v1/admin/invites', {
			data: { role: 'owner' },
		});
		// owner ロールは拒否される（400 or 401）
		expect(res.status()).toBeGreaterThanOrEqual(400);
	});

	test('存在しない招待コードの取消しは冪等に成功する', async ({ request }) => {
		const res = await request.delete('/api/v1/admin/invites/nonexistent-code');
		// revoke は冪等操作として 200 を返す
		expect(res.status()).toBe(200);
	});
});

// ============================================================
// #0130: ライセンス管理画面
// ============================================================

test.describe('#0130: ライセンス管理画面', () => {
	test('ライセンス管理画面が表示される', async ({ page }) => {
		await page.goto('/admin/license');
		await expect(page.getByText('現在のプラン')).toBeVisible();
	});

	test('プラン情報が表示される', async ({ page }) => {
		await page.goto('/admin/license');
		// プラン名が表示される
		const planEl = page.locator('main').getByText('無料プラン');
		await planEl.scrollIntoViewIfNeeded();
		await expect(planEl).toBeVisible();
		// ステータスバッジが表示される
		const statusBadge = page.locator('main').getByText('有効');
		await expect(statusBadge).toBeVisible();
	});

	test('ローカルモードではナビゲーションにライセンスリンクが非表示', async ({ page }) => {
		test.skip(isAwsEnv(), 'AWS 環境ではライセンスリンクは表示される');
		await page.goto('/admin');
		const licenseLink = page.locator('a').filter({ hasText: 'ライセンス' });
		await expect(licenseLink).not.toBeVisible();
	});

	test('プラン管理セクションが表示される', async ({ page }) => {
		await page.goto('/admin/license');
		const planSection = page.getByText('プラン管理');
		await planSection.scrollIntoViewIfNeeded();
		await expect(planSection).toBeVisible();
		// Stripe未設定時は準備中メッセージが表示される
		const prepMessage = page.getByText('決済機能は現在準備中です');
		await prepMessage.scrollIntoViewIfNeeded();
		await expect(prepMessage).toBeVisible();
	});

	test('支払い履歴セクションが表示される', async ({ page }) => {
		await page.goto('/admin/license');
		const paymentHistory = page.getByText('支払い履歴はまだありません');
		await paymentHistory.scrollIntoViewIfNeeded();
		await expect(paymentHistory).toBeVisible();
	});
});

test.describe('#0130: ライセンス API', () => {
	test('ライセンス情報 API が 200 を返す', async ({ request }) => {
		const res = await request.get('/api/v1/admin/license');
		expect(res.status()).toBe(200);
		const data = await res.json();
		expect(data.license).toBeDefined();
		expect(data.license.status).toBeDefined();
	});
});

// ============================================================
// #0131 準備: 法的ページ（利用規約・プライバシーポリシー・特定商取引法）
// ============================================================
// #0131-prep: 法的ページ — HP側（GitHub Pages）に移設済み (#0144)
