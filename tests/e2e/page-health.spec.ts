// tests/e2e/page-health.spec.ts
// 全ページヘルスチェック — 全ルートが 500 エラーなく表示されることを保証する
// このテストは「ページが開けること」のみを検証する最低限のスモークテスト。
// 機能テストは smoke.spec.ts / features.spec.ts が担う。

import { expect, test } from '@playwright/test';
import { selectChildByName, selectKinderChildAndDismiss } from './helpers';

// ============================================================
// Public pages — 認証不要
// ============================================================
test.describe('ページヘルス: Public', () => {
	const publicPages = [
		{ path: '/switch', name: '子供選択' },
		{ path: '/login', name: 'ログイン' },
	];

	for (const { path, name } of publicPages) {
		test(`${name} (${path}) が 500 にならない`, async ({ page }) => {
			const response = await page.goto(path);
			expect(response?.status(), `${path} returned ${response?.status()}`).not.toBe(500);
		});
	}
});

// ============================================================
// Auth pages — 認証関連（cognito モードではフォーム表示、local モードではリダイレクト）
// ============================================================
test.describe('ページヘルス: Auth', () => {
	const authPages = [
		{ path: '/auth/login', name: 'ログイン (auth)' },
		{ path: '/auth/signup', name: 'サインアップ' },
	];

	for (const { path, name } of authPages) {
		test(`${name} (${path}) が 500 にならない`, async ({ page }) => {
			const response = await page.goto(path);
			expect(response?.status(), `${path} returned ${response?.status()}`).not.toBe(500);
		});
	}
});

// ============================================================
// Legal redirects — 法的ページリダイレクト
// ============================================================
test.describe('ページヘルス: Legal', () => {
	const legalPages = [
		{ path: '/legal/terms', name: '利用規約' },
		{ path: '/legal/privacy', name: 'プライバシーポリシー' },
		{ path: '/legal/tokushoho', name: '特定商取引法' },
	];

	for (const { path, name } of legalPages) {
		test(`${name} (${path}) がリダイレクト or 200 を返す`, async ({ page }) => {
			const response = await page.goto(path);
			const status = response?.status() ?? 0;
			// 301 redirect to external LP, or 200 if served directly
			expect(status, `${path} returned ${status}`).not.toBe(500);
		});
	}
});

// ============================================================
// Admin pages — 親管理画面（local モードでは認証不要）
// ============================================================
test.describe('ページヘルス: Admin', () => {
	const adminPages = [
		{ path: '/admin', name: 'ダッシュボード' },
		{ path: '/admin/children', name: 'こども管理' },
		{ path: '/admin/activities', name: '活動管理' },
		{ path: '/admin/activities/introduce', name: '活動紹介' },
		{ path: '/admin/points', name: 'ポイント管理' },
		{ path: '/admin/rewards', name: 'ごほうび管理' },
		{ path: '/admin/achievements', name: 'チャレンジ管理' },
		{ path: '/admin/checklists', name: 'チェックリスト管理' },
		{ path: '/admin/messages', name: 'メッセージ管理' },
		{ path: '/admin/status', name: 'ステータス管理' },
		{ path: '/admin/settings', name: '設定' },
		{ path: '/admin/members', name: 'メンバー管理' },
		{ path: '/admin/license', name: 'ライセンス' },
	];

	for (const { path, name } of adminPages) {
		test(`${name} (${path}) が 500 にならない`, async ({ page }) => {
			const response = await page.goto(path);
			expect(response?.status(), `${path} returned ${response?.status()}`).not.toBe(500);
		});
	}
});

// ============================================================
// Preschool child pages — 子供画面（たろうくん = preschool）
// ============================================================
test.describe('ページヘルス: Preschool 子供画面', () => {
	test.beforeEach(async ({ page }) => {
		await selectKinderChildAndDismiss(page);
	});

	const kinderPages = [
		{ path: '/preschool/home', name: 'ホーム' },
		{ path: '/preschool/history', name: '履歴' },
		{ path: '/preschool/status', name: 'ステータス' },
	];

	for (const { path, name } of kinderPages) {
		test(`${name} (${path}) が 500 にならない`, async ({ page }) => {
			const response = await page.goto(path);
			expect(response?.status(), `${path} returned ${response?.status()}`).not.toBe(500);
		});
	}

	test('チェックリスト (/checklist) が 500 にならない', async ({ page }) => {
		const response = await page.goto('/checklist');
		expect(response?.status(), `/checklist returned ${response?.status()}`).not.toBe(500);
	});
});

// ============================================================
// Baby child pages — 子供画面（はなこちゃん = baby）
// ============================================================
test.describe('ページヘルス: Baby 子供画面', () => {
	test.beforeEach(async ({ page }) => {
		await selectChildByName(page, 'はなこちゃん');
	});

	const babyPages = [
		{ path: '/baby/home', name: 'ホーム' },
		{ path: '/baby/history', name: '履歴' },
		{ path: '/baby/status', name: 'ステータス' },
	];

	for (const { path, name } of babyPages) {
		test(`${name} (${path}) が 500 にならない`, async ({ page }) => {
			const response = await page.goto(path);
			expect(response?.status(), `${path} returned ${response?.status()}`).not.toBe(500);
		});
	}
});

// ============================================================
// API health — 主要 API エンドポイント
// ============================================================
test.describe('ページヘルス: API', () => {
	const apiEndpoints = [
		{ path: '/api/health', name: 'ヘルスチェック' },
		{ path: '/api/v1/activities', name: '活動一覧' },
		{ path: '/api/v1/points/1', name: 'ポイント残高' },
		{ path: '/api/v1/status/1', name: 'ステータス' },
		{ path: '/api/v1/login-bonus/1', name: 'ログインボーナス' },
	];

	for (const { path, name } of apiEndpoints) {
		test(`${name} (${path}) が 500 にならない`, async ({ request }) => {
			const response = await request.get(path);
			expect(response.status(), `${path} returned ${response.status()}`).not.toBe(500);
		});
	}
});
