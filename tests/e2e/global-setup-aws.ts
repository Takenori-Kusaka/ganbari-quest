// tests/e2e/global-setup-aws.ts
// AWS 本番環境 E2E テスト用グローバルセットアップ
// 1. Cognito ログイン（e2e テストユーザー）
// 2. 初回のみ: セットアップフロー（PIN + 子供2人登録）
// 3. storageState を保存して全テストで認証状態を共有

import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'https://ganbari-quest.com';
const TEST_EMAIL = process.env.E2E_TEST_EMAIL || 'e2e-test@ganbari-quest.com';
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || '';

export const STORAGE_STATE_PATH = path.resolve('tests/e2e/.auth/aws-storage-state.json');

export default async function globalSetup() {
	if (!TEST_PASSWORD) {
		console.log('[AWS E2E Setup] E2E_TEST_PASSWORD が未設定。認証テストをスキップします。');
		return;
	}

	console.log(`[AWS E2E Setup] ${BASE_URL} に接続中...`);

	const browser = await chromium.launch();
	const context = await browser.newContext({
		baseURL: BASE_URL,
		ignoreHTTPSErrors: true,
	});
	const page = await context.newPage();

	try {
		// ============================================================
		// Step 1: Cognito ログイン
		// ============================================================
		console.log('[AWS E2E Setup] ログイン中...');
		await page.goto('/auth/login');
		await page.waitForLoadState('networkidle');

		// ログイン済みチェック（リダイレクトされた場合）
		if (page.url().includes('/admin') || page.url().includes('/switch')) {
			console.log('[AWS E2E Setup] 既にログイン済み');
		} else if (page.url().includes('/setup')) {
			console.log('[AWS E2E Setup] セットアップ画面にリダイレクト（初回ログイン後）');
			// セットアップへ進む
		} else {
			// ログインフォームに入力
			const emailInput = page.getByLabel('メールアドレス');
			await emailInput.waitFor({ timeout: 15000 });
			await emailInput.fill(TEST_EMAIL);
			await page.getByLabel('パスワード', { exact: true }).fill(TEST_PASSWORD);

			const loginBtn = page.getByRole('button', { name: 'ログイン' });
			await loginBtn.click();

			// ログイン後、ページ遷移 or エラーメッセージを待つ
			try {
				await page.waitForURL(/\/(admin|switch|setup|consent)/, { timeout: 30000 });
			} catch {
				// タイムアウト — 現在のURLとページ内容をログ
				console.log(`[AWS E2E Setup] ログイン後URL: ${page.url()}`);
				const errorEl = page.locator('[role="alert"]');
				if (await errorEl.isVisible().catch(() => false)) {
					console.log(`[AWS E2E Setup] ログインエラー: ${await errorEl.textContent()}`);
				}
				await page.screenshot({ path: 'test-results/aws-login-debug.png' }).catch(() => {});
				throw new Error(`ログイン後のリダイレクト失敗。URL: ${page.url()}`);
			}
			console.log(`[AWS E2E Setup] ログイン成功 → ${page.url()}`);
		}

		// ============================================================
		// Step 1.5: 利用規約同意（/consent にリダイレクトされた場合）
		// ============================================================
		if (page.url().includes('/consent')) {
			console.log('[AWS E2E Setup] 利用規約同意中...');

			// チェックボックスを全てチェック
			const checkboxes = page.locator('input[type="checkbox"]');
			const count = await checkboxes.count();
			for (let i = 0; i < count; i++) {
				await checkboxes.nth(i).check();
			}

			// 「同意して続ける」ボタンを押す
			const agreeBtn = page.getByRole('button', { name: /同意して続ける/ });
			await agreeBtn.click();

			// リダイレクトを待つ
			await page.waitForURL(/\/(admin|switch|setup)/, { timeout: 30000 });
			console.log(`[AWS E2E Setup] 利用規約同意完了 → ${page.url()}`);
		}

		// ============================================================
		// Step 2: 初回セットアップ（/setup にリダイレクトされた場合）
		// ============================================================
		if (page.url().includes('/setup')) {
			console.log('[AWS E2E Setup] 初回セットアップ開始...');

			// Step 2a: PIN 設定
			if (page.url().includes('/setup') && !page.url().includes('/setup/children')) {
				const pinInput = page.locator('input[name="pin"]');
				if (await pinInput.isVisible().catch(() => false)) {
					console.log('[AWS E2E Setup]   PIN 設定中...');
					await pinInput.fill('1234');
					await page.locator('input[name="confirmPin"]').fill('1234');
					await page.getByRole('button', { name: /設定|次へ/ }).click();
					await page.waitForURL(/\/setup\/children/, { timeout: 15000 });
				}
			}

			// Step 2b: 子供登録（ローカルテストと同じ名前・設定を使用）
			if (page.url().includes('/setup/children')) {
				console.log('[AWS E2E Setup]   子供を登録中...');

				// たろうくん（4歳、preschool、pink）
				await addChildViaSetup(page, 'たろうくん', '4', 'preschool', 'pink');

				// はなこちゃん（1歳、baby、blue）
				await addChildViaSetup(page, 'はなこちゃん', '1', 'baby', 'blue');

				// セットアップ完了
				const nextBtn = page.getByRole('button', { name: /完了|次へ/ });
				if (await nextBtn.isVisible().catch(() => false)) {
					await nextBtn.click();
					await page.waitForURL(/\/(admin|switch|setup\/complete)/, { timeout: 15000 });
				}

				console.log('[AWS E2E Setup]   子供登録完了');
			}
		}

		// ============================================================
		// Step 3: 子供がいなければ管理画面から追加
		// ============================================================
		{
			// /switch に行って子供がいるか確認
			await page.goto(`${BASE_URL}/switch`);
			await page.waitForLoadState('networkidle');

			const childButtons = page.locator('[data-testid^="child-select-"]');
			const childCount = await childButtons.count();

			if (childCount === 0) {
				console.log('[AWS E2E Setup] 子供が未登録。管理画面から追加中...');
				await page.goto(`${BASE_URL}/admin/children`);
				await page.waitForLoadState('networkidle');

				// たろうくん（4歳、preschool、pink）
				await addChildViaAdmin(page, 'たろうくん', '4', 'preschool', 'pink');

				// はなこちゃん（1歳、baby、blue）
				await addChildViaAdmin(page, 'はなこちゃん', '1', 'baby', 'blue');

				console.log('[AWS E2E Setup] 子供登録完了');
			} else {
				console.log(`[AWS E2E Setup] 子供が ${childCount} 人登録済み`);
			}
		}

		// ============================================================
		// Step 3.5: ログインボーナスを事前に請求（テスト中のオーバーレイ防止）
		// ============================================================
		{
			console.log('[AWS E2E Setup] ログインボーナスを事前請求中...');
			const apiContext = await context.request;

			// /switch で子供IDを確認
			await page.goto(`${BASE_URL}/switch`);
			await page.waitForLoadState('networkidle');
			const childButtons = page.locator('[data-testid^="child-select-"]');
			const childCount = await childButtons.count();

			for (let i = 0; i < childCount; i++) {
				const childId = i + 1;
				try {
					const res = await apiContext.post(`${BASE_URL}/api/v1/login-bonus/${childId}/claim`);
					const status = res.status();
					console.log(
						`[AWS E2E Setup]   子供${childId}: ${status === 201 ? '請求成功' : status === 409 ? '既に請求済み' : `status=${status}`}`,
					);
				} catch (e) {
					console.log(`[AWS E2E Setup]   子供${childId}: エラー ${e}`);
				}
			}
		}

		// ============================================================
		// Step 3.6: 活動マスタデータを API 経由で投入
		// ============================================================
		{
			console.log('[AWS E2E Setup] 活動マスタデータを確認中...');
			const apiContext = await context.request;

			// 既存活動数を確認
			const checkRes = await apiContext.get(`${BASE_URL}/api/v1/activities`);
			const checkBody = await checkRes.json().catch(() => ({ activities: [] }));
			const existingCount = checkBody.activities?.length ?? 0;

			if (existingCount < 10) {
				console.log(`[AWS E2E Setup] 活動が ${existingCount} 件のみ。テスト用活動を投入中...`);
				await seedActivities(apiContext, BASE_URL);
			} else {
				console.log(`[AWS E2E Setup] 活動が ${existingCount} 件登録済み`);
			}
		}

		// ============================================================
		// Step 4: storageState を保存
		// ============================================================
		const fs = await import('node:fs');
		const dir = path.dirname(STORAGE_STATE_PATH);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		await context.storageState({ path: STORAGE_STATE_PATH });
		console.log(`[AWS E2E Setup] storageState 保存完了: ${STORAGE_STATE_PATH}`);
	} catch (error) {
		console.error('[AWS E2E Setup] セットアップ失敗:', error);
		// スクリーンショットを保存してデバッグ
		await page.screenshot({ path: 'test-results/aws-setup-failure.png' }).catch(() => {});
		throw error;
	} finally {
		await browser.close();
	}
}

/** セットアップ画面で子供を追加するヘルパー */
async function addChildViaSetup(
	page: import('@playwright/test').Page,
	nickname: string,
	age: string,
	uiMode: string,
	theme: string,
) {
	await page.locator('input[name="nickname"]').fill(nickname);
	await page.locator('input[name="age"], select[name="age"]').fill(age);

	// uiMode セレクトがあれば設定
	const uiModeSelect = page.locator('select[name="uiMode"]');
	if (await uiModeSelect.isVisible().catch(() => false)) {
		await uiModeSelect.selectOption(uiMode);
	}

	// theme セレクトがあれば設定
	const themeSelect = page.locator('select[name="theme"], input[name="theme"]');
	if (await themeSelect.isVisible().catch(() => false)) {
		const tag = await themeSelect.evaluate((el) => el.tagName.toLowerCase());
		if (tag === 'select') {
			await themeSelect.selectOption(theme);
		} else {
			await themeSelect.fill(theme);
		}
	}

	// 追加ボタンを押す
	const addBtn = page.getByRole('button', { name: /追加|登録/ });
	await addBtn.click();

	// 成功メッセージまたは登録済みリストの更新を待つ
	await page.waitForTimeout(1000);
}

/** API 経由で E2E テスト用の活動マスタデータを投入する */
async function seedActivities(
	apiContext: import('@playwright/test').APIRequestContext,
	baseUrl: string,
) {
	// テストで参照される活動を含む、最低限のシードデータ
	// カテゴリ: 1=うんどう, 2=せいかつ, 3=がくしゅう, 4=そうぞう, 5=しぜん
	const activities = [
		// カテゴリ1: うんどう（baby + kinder）
		{ name: 'たいそう', icon: '🤸', basePoints: 10, categoryId: 1, ageMin: 0, ageMax: 5 },
		{ name: 'おさんぽ', icon: '🚶', basePoints: 10, categoryId: 1, ageMin: 0, ageMax: 5 },
		{ name: 'ボールあそび', icon: '⚽', basePoints: 10, categoryId: 1, ageMin: 3, ageMax: 5 },
		{ name: 'なわとび', icon: '🤾', basePoints: 15, categoryId: 1, ageMin: 3, ageMax: 5 },
		// カテゴリ2: せいかつ
		{
			name: 'おさらあらい',
			icon: '🍽️💧',
			basePoints: 15,
			categoryId: 2,
			ageMin: 3,
			ageMax: 5,
			dailyLimit: 3,
		},
		{ name: 'はみがき', icon: '🪥', basePoints: 10, categoryId: 2, ageMin: 0, ageMax: 5 },
		{
			name: 'おきがえ',
			icon: '👕',
			basePoints: 10,
			categoryId: 2,
			ageMin: 0,
			ageMax: 5,
			dailyLimit: 2,
		},
		{ name: 'おかたづけ', icon: '📦', basePoints: 10, categoryId: 2, ageMin: 3, ageMax: 5 },
		// カテゴリ3: がくしゅう
		{ name: 'えほんをよむ', icon: '📖', basePoints: 15, categoryId: 3, ageMin: 0, ageMax: 5 },
		{ name: 'おえかき', icon: '🎨', basePoints: 10, categoryId: 3, ageMin: 0, ageMax: 5 },
		{ name: 'すうじ', icon: '🔢', basePoints: 15, categoryId: 3, ageMin: 3, ageMax: 5 },
		// カテゴリ4: そうぞう
		{ name: 'ねんど', icon: '🏺', basePoints: 10, categoryId: 4, ageMin: 0, ageMax: 5 },
		{ name: 'おうた', icon: '🎵', basePoints: 10, categoryId: 4, ageMin: 0, ageMax: 5 },
		// カテゴリ5: しぜん
		{
			name: '水やりをする',
			icon: '🌱💧',
			basePoints: 10,
			categoryId: 5,
			ageMin: 3,
			ageMax: 5,
		},
		{ name: 'むしをみつける', icon: '🐛', basePoints: 10, categoryId: 5, ageMin: 0, ageMax: 5 },
	];

	let created = 0;
	for (const activity of activities) {
		try {
			const res = await apiContext.post(`${baseUrl}/api/v1/activities`, { data: activity });
			if (res.status() === 201) created++;
		} catch {
			// 個別の失敗は無視して続行
		}
	}
	console.log(`[AWS E2E Setup] 活動 ${created}/${activities.length} 件を投入しました`);
}

/** 管理画面（/admin/children）から子供を追加するヘルパー */
async function addChildViaAdmin(
	page: import('@playwright/test').Page,
	nickname: string,
	age: string,
	_uiMode: string,
	theme: string,
) {
	// 「+ こどもを追加」トグルボタンを押してフォームを開く
	const addToggle = page.getByRole('button', { name: /こどもを追加/ });
	await addToggle.waitFor({ timeout: 10000 });
	await addToggle.click();
	await page.waitForTimeout(500);

	// フォームが表示されるのを待つ
	const nicknameInput = page.locator('input[name="nickname"]');
	await nicknameInput.waitFor({ timeout: 5000 });
	await nicknameInput.fill(nickname);

	// 年齢入力
	const ageInput = page.locator('input[name="age"]');
	await ageInput.fill(age);

	// theme セレクト
	const themeSelect = page.locator('select[name="theme"]');
	if (await themeSelect.isVisible().catch(() => false)) {
		await themeSelect.selectOption(theme);
	}

	// 「追加する」送信ボタンを押す
	const submitBtn = page.getByRole('button', { name: '追加する' });
	await submitBtn.click();

	// フォームが閉じる（成功時に showAddForm = false になる）のを待つ
	await nicknameInput.waitFor({ state: 'hidden', timeout: 10000 });
	console.log(`[AWS E2E Setup]     ${nickname} を追加しました`);
}
