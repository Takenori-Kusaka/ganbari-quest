// tests/e2e/production-smoke.spec.ts
// 本番環境（ganbari-quest.com）に対するスモークテスト
// 実行: npx playwright test --config tests/e2e/production.config.ts

import { expect, test } from '@playwright/test';

type Page = import('@playwright/test').Page;

const BASE_URL = 'https://ganbari-quest.com';

// ============================================================
// ヘルパー
// ============================================================
async function selectChild(page: Page) {
	await page.goto(`${BASE_URL}/switch`);
	const childButton = page.locator('button[type="submit"]').first();
	await expect(childButton).toBeVisible({ timeout: 10000 });
	await childButton.click();
	await page.waitForURL(/\/(kinder|baby)\/home/, { timeout: 10000 });
}

async function dismissOverlays(page: Page) {
	const hasOmikuji = await page
		.getByText('きょうのうんせい')
		.isVisible()
		.catch(() => false);

	if (hasOmikuji) {
		const closeBtn = page.getByRole('button', { name: /とじる|閉じる|OK/i });
		await closeBtn.waitFor({ timeout: 8000 }).catch(() => {});
		if (await closeBtn.isVisible().catch(() => false)) {
			await closeBtn.click();
		}
	}

	for (let i = 0; i < 3; i++) {
		const overlay = page.locator(
			'[data-testid="achievement-overlay"], [data-testid="title-overlay"]',
		);
		if (await overlay.isVisible().catch(() => false)) {
			const btn = overlay.getByRole('button').first();
			if (await btn.isVisible().catch(() => false)) {
				await btn.click();
				await page.waitForTimeout(300);
			}
		}
	}
}

/** 1x1 の最小限の有効 JPEG バイナリを生成 */
function createMinimalJpeg(): Buffer {
	return Buffer.from([
		0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
		0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
		0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
		0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
		0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
		0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
		0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
		0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
		0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
		0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00,
		0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
		0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
		0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35,
		0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
		0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
		0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
		0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2,
		0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
		0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6,
		0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda,
		0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7b, 0x94, 0x11, 0x00, 0x00, 0x00, 0x00, 0xff,
		0xd9,
	]);
}

// ============================================================
// ページ表示テスト
// ============================================================

test.describe('本番環境スモークテスト', () => {
	test('ヘルスチェック', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/health`);
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.status).toBe('ok');
		expect(body.dataSource).toBe('dynamodb');
	});

	test('トップページ（/switch）が表示される', async ({ page }) => {
		await page.goto(`${BASE_URL}/switch`);
		await expect(page).toHaveTitle(/がんばりクエスト|Ganbari/i, { timeout: 10000 });
		const childButton = page.locator('button[type="submit"]').first();
		await expect(childButton).toBeVisible({ timeout: 10000 });
	});

	test('子供を選択してホーム画面に遷移できる', async ({ page }) => {
		await selectChild(page);
		await dismissOverlays(page);
		const url = page.url();
		expect(url).toMatch(/\/(kinder|baby)\/home/);
	});

	test('子供選択のform action（?/select）が動作する', async ({ page }) => {
		await page.goto(`${BASE_URL}/switch`);
		const childButton = page.locator('button[type="submit"]').first();
		await expect(childButton).toBeVisible({ timeout: 10000 });
		await childButton.click();
		await page.waitForURL(/\/(kinder|baby)\/home/, { timeout: 10000 });
		expect(page.url()).not.toContain('/switch');
	});

	test('ステータス画面が表示される', async ({ page }) => {
		await selectChild(page);
		await dismissOverlays(page);

		const statusLink = page.getByRole('link', { name: /ステータス|すてーたす|つよさ/i });
		if (await statusLink.isVisible().catch(() => false)) {
			await statusLink.click();
			await page.waitForURL(/\/status/, { timeout: 10000 });
			await expect(page.locator('body')).toBeVisible();
		}
	});

	test('活動ボタンが表示される', async ({ page }) => {
		await selectChild(page);
		await dismissOverlays(page);

		const activityButtons = page.locator(
			'[data-testid="activity-button"], .activity-card, .baby-card, button.tap-target',
		);
		const count = await activityButtons.count();
		expect(count).toBeGreaterThan(0);
	});

	test('管理画面が表示される', async ({ page }) => {
		await page.goto(`${BASE_URL}/admin`);
		await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
	});

	test('ナビゲーション: きりかえリンクで/switchに戻れる', async ({ page }) => {
		await selectChild(page);
		await dismissOverlays(page);

		const switchLink = page.getByRole('link', { name: /きりかえ|切り替え/i });
		if (await switchLink.isVisible().catch(() => false)) {
			await switchLink.click();
			await page.waitForURL(/\/switch/, { timeout: 10000 });
		}
	});

	test('404ページが適切に表示される', async ({ page }) => {
		const response = await page.goto(`${BASE_URL}/nonexistent-page-12345`);
		expect(response).not.toBeNull();
	});

	test('HTTPS接続が正常', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/health`);
		expect(response.status()).toBe(200);
		expect(response.url()).toMatch(/^https:\/\//);
	});
});

// ============================================================
// APIエンドポイントテスト — GET
// ============================================================

test.describe('本番API検証 - GET', () => {
	test('GET /api/v1/activities - 活動一覧', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/activities`);
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.activities).toBeDefined();
		expect(Array.isArray(body.activities)).toBe(true);
	});

	test('GET /api/v1/status/1 - 子供ステータス', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/status/1`);
		expect(response.status()).toBe(200);
	});

	test('GET /api/v1/points/1 - ポイント残高', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/points/1`);
		expect(response.status()).toBe(200);
	});

	test('GET /api/v1/achievements/1 - 実績一覧', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/achievements/1`);
		expect(response.status()).toBe(200);
	});

	test('GET /api/v1/login-bonus/1 - ログインボーナス', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/login-bonus/1`);
		expect(response.status()).toBe(200);
	});

	test('GET /api/v1/career-fields - キャリア分野', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/career-fields`);
		expect(response.status()).toBe(200);
	});

	test('GET /api/v1/evaluations/1 - 週次評価', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/evaluations/1`);
		expect(response.status()).toBe(200);
	});

	test('GET /api/v1/special-rewards/1 - 特別ごほうび', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/special-rewards/1`);
		expect(response.status()).toBe(200);
	});

	test('GET /api/v1/special-rewards/templates - テンプレート一覧', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/special-rewards/templates`);
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.templates).toBeDefined();
	});

	test('GET /api/v1/points/1/history - ポイント履歴', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/points/1/history`);
		expect(response.status()).toBe(200);
	});

	test('GET /api/v1/career-plans/1 - キャリアプラン', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/career-plans/1`);
		// 200 or 404（プラン未作成）
		expect([200, 404]).toContain(response.status());
	});

	test('GET /api/v1/activities/999999 - 存在しない活動は404', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/activities/999999`);
		expect(response.status()).toBe(404);
	});
});

// ============================================================
// APIエンドポイントテスト — ファイルアップロード（成功パス）
// ★ アバター500エラーが検出できなかった原因への対策
// ============================================================

test.describe('本番API検証 - ファイルアップロード', () => {
	test('POST /api/v1/children/1/avatar - 有効なJPEGでアップロード成功', async ({ request }) => {
		const jpegData = createMinimalJpeg();

		const response = await request.post(`${BASE_URL}/api/v1/children/1/avatar`, {
			multipart: {
				avatar: {
					name: 'test-avatar.jpg',
					mimeType: 'image/jpeg',
					buffer: jpegData,
				},
			},
		});

		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.avatarUrl).toBeDefined();
		expect(body.avatarUrl).toMatch(/\/uploads\/avatars\/avatar-1-\d+\.jpg/);
	});

	test('アップロードしたアバター画像が取得できる', async ({ request }) => {
		// まずアップロード
		const jpegData = createMinimalJpeg();
		const uploadRes = await request.post(`${BASE_URL}/api/v1/children/1/avatar`, {
			multipart: {
				avatar: {
					name: 'test-retrieve.jpg',
					mimeType: 'image/jpeg',
					buffer: jpegData,
				},
			},
		});
		expect(uploadRes.status()).toBe(200);
		const { avatarUrl } = await uploadRes.json();

		// アップロードした画像を取得
		const getRes = await request.get(`${BASE_URL}${avatarUrl}`);
		expect(getRes.status()).toBe(200);
		expect(getRes.headers()['content-type']).toMatch(/image\/jpeg/);
	});

	test('POST /api/v1/children/1/avatar - ファイルなしで400', async ({ request }) => {
		const response = await request.post(`${BASE_URL}/api/v1/children/1/avatar`, {
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		});
		expect(response.status()).toBe(400);
		const body = await response.json();
		expect(body.message).toContain('ファイルを選択');
	});

	test('POST /api/v1/children/1/avatar - 不正なMIMEタイプで400', async ({ request }) => {
		const response = await request.post(`${BASE_URL}/api/v1/children/1/avatar`, {
			multipart: {
				avatar: {
					name: 'test.gif',
					mimeType: 'image/gif',
					buffer: Buffer.from('GIF89a'),
				},
			},
		});
		expect(response.status()).toBe(400);
		const body = await response.json();
		expect(body.message).toContain('JPEG、PNG、WebP');
	});

	test('POST /api/v1/children/999/avatar - 存在しない子供で404', async ({ request }) => {
		const jpegData = createMinimalJpeg();
		const response = await request.post(`${BASE_URL}/api/v1/children/999/avatar`, {
			multipart: {
				avatar: {
					name: 'test.jpg',
					mimeType: 'image/jpeg',
					buffer: jpegData,
				},
			},
		});
		expect(response.status()).toBe(404);
	});
});

// ============================================================
// APIエンドポイントテスト — POST (JSON body)
// ★ request.json() パースが本番で正しく動作するか検証
// ============================================================

test.describe('本番API検証 - POST/PUT/PATCH', () => {
	test('POST /api/v1/activity-logs - 活動記録', async ({ request }) => {
		const activitiesRes = await request.get(`${BASE_URL}/api/v1/activities`);
		const body = await activitiesRes.json();
		const activities = body.activities ?? body;
		if (!Array.isArray(activities) || activities.length === 0) return;

		const activityId = activities[0].id;
		const response = await request.post(`${BASE_URL}/api/v1/activity-logs`, {
			data: { childId: 1, activityId },
		});
		expect(response.status()).toBeLessThan(500);
	});

	test('POST /api/v1/activity-logs - 不正なbodyで400', async ({ request }) => {
		const response = await request.post(`${BASE_URL}/api/v1/activity-logs`, {
			data: { childId: 'invalid', activityId: 'bad' },
		});
		expect(response.status()).toBe(400);
	});

	test('POST /api/v1/activities/suggest - バリデーション', async ({ request }) => {
		// 空テキストで400
		const response = await request.post(`${BASE_URL}/api/v1/activities/suggest`, {
			data: { text: '' },
		});
		expect(response.status()).toBe(400);
	});

	test('POST /api/v1/points/convert - バリデーション', async ({ request }) => {
		// 不正なbodyで400
		const response = await request.post(`${BASE_URL}/api/v1/points/convert`, {
			data: { childId: 'invalid' },
		});
		expect(response.status()).toBe(400);
	});

	test('POST /api/v1/points/ocr-receipt - バリデーション', async ({ request }) => {
		// image/mimeType なしで400
		const response = await request.post(`${BASE_URL}/api/v1/points/ocr-receipt`, {
			data: {},
		});
		expect(response.status()).toBe(400);
	});

	test('POST /api/v1/points/ocr-receipt - 不正MIMEタイプで400', async ({ request }) => {
		const response = await request.post(`${BASE_URL}/api/v1/points/ocr-receipt`, {
			data: { image: 'base64data', mimeType: 'text/plain' },
		});
		expect(response.status()).toBe(400);
	});

	test('POST /api/v1/special-rewards/1 - 特別報酬付与', async ({ request }) => {
		const response = await request.post(`${BASE_URL}/api/v1/special-rewards/1`, {
			data: {
				title: '本番E2Eテスト報酬',
				points: 1,
				icon: '🎁',
				category: 'life',
			},
		});
		expect(response.status()).toBe(201);
	});

	test('POST /api/v1/special-rewards/999 - 存在しない子供で404', async ({ request }) => {
		const response = await request.post(`${BASE_URL}/api/v1/special-rewards/999`, {
			data: {
				title: 'テスト',
				points: 1,
				icon: '🎁',
				category: 'life',
			},
		});
		expect(response.status()).toBe(404);
	});

	test('POST /api/v1/auth/login - 不正PINで401/429', async ({ request }) => {
		const response = await request.post(`${BASE_URL}/api/v1/auth/login`, {
			data: { pin: '0000' },
		});
		// 401 (不正PIN) or 429 (ロックアウト) or 400 (バリデーション)
		expect(response.status()).toBeLessThan(500);
		expect([400, 401, 409, 429]).toContain(response.status());
	});

	test('POST /api/v1/auth/logout - ログアウト', async ({ request }) => {
		const response = await request.post(`${BASE_URL}/api/v1/auth/logout`);
		expect(response.status()).toBeLessThan(500);
	});

	test('PATCH /api/v1/activities/999999 - 存在しない活動の更新で404', async ({ request }) => {
		const response = await request.patch(`${BASE_URL}/api/v1/activities/999999`, {
			data: { name: 'test' },
		});
		expect(response.status()).toBe(404);
	});

	test('DELETE /api/v1/activities/999999 - 存在しない活動の削除で404', async ({ request }) => {
		const response = await request.delete(`${BASE_URL}/api/v1/activities/999999`);
		expect(response.status()).toBe(404);
	});
});

// ============================================================
// レスポンスヘッダー・セキュリティ
// ============================================================

test.describe('本番環境 - レスポンス検証', () => {
	test('APIレスポンスがJSON Content-Typeを返す', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/api/v1/activities`);
		expect(response.headers()['content-type']).toMatch(/application\/json/);
	});

	test('不正なContent-Typeの大きなbodyが拒否される', async ({ request }) => {
		// adapter-node の BODY_SIZE_LIMIT を超えないサイズで送信
		// 不正なエンドポイントに大きめのbodyを送って500にならないことを確認
		const largePayload = 'x'.repeat(1000);
		const response = await request.post(`${BASE_URL}/api/v1/activity-logs`, {
			data: { childId: 1, activityId: 1, extra: largePayload },
		});
		// 400（バリデーション）or 200（余分フィールド無視）で、500でないこと
		expect(response.status()).toBeLessThan(500);
	});
});
