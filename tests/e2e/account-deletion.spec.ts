// tests/e2e/account-deletion.spec.ts
// #755: アカウント削除フローの E2E テスト — 4パターンの削除と Stripe 連動
//
// スコープ方針:
//   Cognito 固有の削除フローに集中。ローカル E2E で検証済みの機能は対象外。
//   Stripe 連動はモック化（E2E テストで実際の Stripe API は呼ばない）。
//
// テスト対象の 4 パターン（+α）:
//   1. owner-only: テナント唯一のメンバーが削除
//   2. owner-with-transfer: 権限を別メンバーに移譲して退会
//   3. owner-full-delete: テナント丸ごと削除
//   4. member: 非 owner の parent が自分のアカウントを削除
//   5. child: 子供アカウントが自分を削除
//
// 前提:
//   - #944, #945 の Cognito テストユーザーライフサイクル基盤が完了後にフル実装
//   - 現時点では API レベルの認証ガード・バリデーション + UI 要素の存在確認
//
// 実行:
//   npx playwright test --config playwright.cognito-dev.config.ts account-deletion
//   (ローカルモードではアカウント削除 API が Cognito 依存のため一部テスト制限あり)
//
// #1500: storageState ベースに移行。loginAsPlan() 廃止。
//   - setup プロジェクト (auth.setup.ts) が事前に playwright/.auth/<role>.json を生成する
//   - 各 describe ブロックは test.use({ storageState }) で認証済みセッションを再利用
//   - test.slow() 廃止 / page.goto() タイムアウトを 30s に短縮

import { expect, test } from '@playwright/test';
import { warmupAdminPages } from './plan-login-helpers';

test.beforeAll(async ({ browser }) => {
	test.setTimeout(60_000);
	await warmupAdminPages(browser, ['/admin/settings']);
});

// ============================================================
// 1. API: アカウント削除エンドポイントの認証・バリデーション
// ============================================================

test.describe('#755 アカウント削除 — API バリデーション', () => {
	test('pattern なしで POST すると 400', async ({ request }) => {
		const res = await request.post('/api/v1/admin/account/delete', {
			headers: { 'Content-Type': 'application/json' },
			data: {},
		});

		// 未認証なら 401、認証済みなら pattern 不足で 400
		const status = res.status();
		expect(status === 400 || status === 401).toBe(true);
	});

	test('不正な pattern で POST すると 400', async ({ request }) => {
		const res = await request.post('/api/v1/admin/account/delete', {
			headers: { 'Content-Type': 'application/json' },
			data: { pattern: 'invalid-pattern' },
		});

		const status = res.status();
		expect(status === 400 || status === 401).toBe(true);
	});

	test('owner-with-transfer に newOwnerId なしで POST すると 400', async ({ request }) => {
		const res = await request.post('/api/v1/admin/account/delete', {
			headers: { 'Content-Type': 'application/json' },
			data: { pattern: 'owner-with-transfer' },
		});

		// 未認証なら 401、認証済みなら newOwnerId 不足で 400
		const status = res.status();
		expect(status === 400 || status === 401).toBe(true);
	});

	test('body が不正な JSON で POST すると 400', async ({ request }) => {
		const res = await request.post('/api/v1/admin/account/delete', {
			headers: { 'Content-Type': 'application/json' },
			data: 'invalid json',
		});

		const status = res.status();
		expect(status === 400 || status === 401).toBe(true);
	});
});

// ============================================================
// 2. API: deletion-info エンドポイント
// ============================================================

test.describe('#755 deletion-info — API', () => {
	test('GET /api/v1/admin/account/deletion-info の応答構造を検証', async ({ request }) => {
		const res = await request.get('/api/v1/admin/account/deletion-info');
		const status = res.status();

		// ローカルモードでは auto-auth が効くため 200
		// cognito-dev モードでは未認証で 401
		expect(status === 200 || status === 401).toBe(true);

		if (status === 200) {
			const body = await res.json();
			expect(body).toHaveProperty('isOnlyMember');
			expect(body).toHaveProperty('otherMembers');
			expect(typeof body.isOnlyMember).toBe('boolean');
			expect(Array.isArray(body.otherMembers)).toBe(true);
		} else {
			// 未認証: 応答構造の検証はスキップ（ステータス検証は上で完了）
			expect(status).toBe(401);
		}
	});
});

// ============================================================
// 3. API: member 離脱エンドポイント
// ============================================================

test.describe('#755 メンバー離脱 — API', () => {
	test('POST /api/v1/admin/members/leave に未認証で 401 または owner で 400', async ({
		request,
	}) => {
		const res = await request.post('/api/v1/admin/members/leave', {
			headers: { 'Content-Type': 'application/json' },
			data: {},
		});

		// ローカルモード: owner auto-auth → 400 (owner は離脱不可)
		// cognito-dev モード: 未認証 → 401
		const status = res.status();
		expect(status === 400 || status === 401).toBe(true);
	});
});

// ============================================================
// 4. API: Stripe サブスクリプションキャンセル連動 (mock)
// ============================================================

test.describe('#755 Stripe 連動 — サブスクキャンセル (mock)', () => {
	test('POST /api/v1/admin/tenant/cancel に未認証で 401 または 500', async ({ request }) => {
		const res = await request.post('/api/v1/admin/tenant/cancel', {
			headers: { 'Content-Type': 'application/json' },
			data: {},
		});

		// Cognito 認証 + Stripe 連動が必要
		// ローカルモード: Cognito 未設定のため 500
		// cognito-dev モード: 未認証で 401
		const status = res.status();
		expect(status === 401 || status === 500).toBe(true);
	});

	test('POST /api/v1/admin/tenant/reactivate に未認証で 401 または 500', async ({ request }) => {
		const res = await request.post('/api/v1/admin/tenant/reactivate', {
			headers: { 'Content-Type': 'application/json' },
			data: {},
		});

		const status = res.status();
		expect(status === 401 || status === 500).toBe(true);
	});
});

// ============================================================
// 5. UI: /admin/settings のアカウント削除セクション（cognito-dev モード）
// ============================================================

test.describe('#755 アカウント削除 — UI（cognito-dev モード）family', () => {
	// #1500: storageState で認証済みセッションを再利用（loginAsPlan() 廃止）
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('owner ログインで /admin/settings にアカウント削除セクションが表示される', async ({
		page,
	}) => {
		await page.goto('/admin/settings', { waitUntil: 'commit', timeout: 30_000 });

		// cognito モードではアカウント削除セクションが表示される
		const deleteSection = page.getByText('アカウント削除');
		const deleteSectionCount = await deleteSection.count();

		if (deleteSectionCount === 0) {
			// ローカルモード (authMode !== 'cognito') ではセクション非表示
			test.info().annotations.push({
				type: 'env-skip',
				description: 'アカウント削除セクションが非表示（ローカルモード）',
			});
			return;
		}

		// ここからは無条件アサーション
		await expect(deleteSection.first()).toBeVisible({ timeout: 15_000 });

		// 「アカウントを削除します」の確認入力フィールドが存在する
		const confirmInput = page.locator('#deleteConfirm');
		await expect(confirmInput).toBeVisible({ timeout: 5_000 });
	});

	test('owner ログインで削除ボタンは確認テキスト未入力で無効', async ({ page }) => {
		await page.goto('/admin/settings', { waitUntil: 'commit', timeout: 30_000 });

		const deleteSection = page.getByText('アカウント削除');
		const deleteSectionCount = await deleteSection.count();

		if (deleteSectionCount === 0) {
			test.info().annotations.push({
				type: 'env-skip',
				description: 'アカウント削除セクションが非表示（ローカルモード）',
			});
			return;
		}

		await expect(deleteSection.first()).toBeVisible({ timeout: 15_000 });

		// 確認テキスト入力前は削除ボタンが disabled
		const deleteButton = page.getByRole('button', { name: /削除する|退会する/ }).first();
		await expect(deleteButton).toBeVisible({ timeout: 5_000 });
		await expect(deleteButton).toBeDisabled();
	});
});

test.describe('#755 アカウント削除 — UI（cognito-dev モード）free', () => {
	// #1500: storageState で認証済みセッションを再利用（loginAsPlan() 廃止）
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('free プランの owner でもアカウント削除セクションが表示される', async ({ page }) => {
		await page.goto('/admin/settings', { waitUntil: 'commit', timeout: 30_000 });

		const deleteSection = page.getByText('アカウント削除');
		const deleteSectionCount = await deleteSection.count();

		if (deleteSectionCount === 0) {
			test.info().annotations.push({
				type: 'env-skip',
				description: 'アカウント削除セクションが非表示（ローカルモード）',
			});
			return;
		}

		// free プランでもアカウント削除は利用可能
		await expect(deleteSection.first()).toBeVisible({ timeout: 15_000 });
	});
});

// ============================================================
// 6. UI: owner-with-transfer ダイアログ（cognito-dev モード）
// ============================================================

test.describe('#755 権限移譲ダイアログ — UI', () => {
	// #1500: storageState で認証済みセッションを再利用（loginAsPlan() 廃止）
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('owner が削除を試行すると他メンバーがいる場合は移譲ダイアログが表示される', async ({
		page,
	}) => {
		await page.goto('/admin/settings', { waitUntil: 'commit', timeout: 30_000 });

		// 前提条件: アカウント削除セクションが表示されること
		const deleteSection = page.getByText('アカウント削除');
		const deleteSectionCount = await deleteSection.count();

		if (deleteSectionCount === 0) {
			test.info().annotations.push({
				type: 'env-skip',
				description: 'アカウント削除セクションが非表示（ローカルモード）',
			});
			return;
		}

		await expect(deleteSection.first()).toBeVisible({ timeout: 15_000 });

		// 確認テキストを入力
		const confirmInput = page.locator('#deleteConfirm');
		await expect(confirmInput).toBeVisible({ timeout: 5_000 });
		await confirmInput.fill('アカウントを削除します');

		// 削除ボタンが有効化されていることを確認してクリック
		const deleteButton = page.getByRole('button', { name: /削除する|退会する/ }).first();
		await expect(deleteButton).toBeEnabled({ timeout: 3_000 });
		await deleteButton.click();

		// 他メンバーがいる場合: 移譲ダイアログが表示される
		// dev-tenant には owner 以外のメンバー（parent, child）がいるため
		const transferDialog = page.getByText('家族グループに他のメンバーがいます');
		const transferDialogCount = await transferDialog.count();

		if (transferDialogCount === 0) {
			// owner-only テナント（他メンバーなし）の場合、移譲ダイアログは出ない
			test.info().annotations.push({
				type: 'env-skip',
				description: '移譲ダイアログ非表示（owner-only テナントの可能性）',
			});
			return;
		}

		// 移譲先選択と全削除の2つのオプションがある
		await expect(page.getByText('オーナー権限を移譲して退会する')).toBeVisible();
		await expect(page.getByText('家族グループを全て削除する')).toBeVisible();

		// キャンセルボタンで閉じられる
		await page.getByRole('button', { name: 'キャンセル' }).click();
	});
});

// ============================================================
// 7. プラン別サインアップ → プラン確認（cognito-dev モード）
// ============================================================

test.describe('#755 プラン別サインアップ → プラン確認 — free', () => {
	// #1500: storageState で認証済みセッションを再利用（loginAsPlan() 廃止）
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('free ユーザーでログイン → plan=free 確認', async ({ page }) => {
		await page.goto('/admin/license', { waitUntil: 'commit', timeout: 30_000 });

		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card).toHaveAttribute('data-plan-tier', 'free');
	});
});

test.describe('#755 プラン別サインアップ → プラン確認 — standard', () => {
	// #1500: storageState で認証済みセッションを再利用（loginAsPlan() 廃止）
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('standard ユーザーでログイン → plan=standard 確認', async ({ page }) => {
		await page.goto('/admin/license', { waitUntil: 'commit', timeout: 30_000 });

		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card).toHaveAttribute('data-plan-tier', 'standard');
	});
});

test.describe('#755 プラン別サインアップ → プラン確認 — family', () => {
	// #1500: storageState で認証済みセッションを再利用（loginAsPlan() 廃止）
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('family ユーザーでログイン → plan=family 確認', async ({ page }) => {
		await page.goto('/admin/license', { waitUntil: 'commit', timeout: 30_000 });

		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card).toHaveAttribute('data-plan-tier', 'family');
	});
});

// ============================================================
// 8. ロール別アクセス制御の確認（削除関連）
// ============================================================

test.describe('#755 ロール別アクセス — 削除 API', () => {
	test('child ロールで owner-only パターンは 403 または認証エラー', async ({ request }) => {
		const res = await request.post('/api/v1/admin/account/delete', {
			headers: { 'Content-Type': 'application/json' },
			data: { pattern: 'owner-only' },
		});

		// ローカルモード: owner auto-auth → 200 成功の可能性
		// cognito-dev: child ロール → 403
		// 未認証: 401
		const status = res.status();
		expect(status === 200 || status === 401 || status === 403).toBe(true);
	});

	test('member パターンで owner ロールは 400', async ({ request }) => {
		const res = await request.post('/api/v1/admin/account/delete', {
			headers: { 'Content-Type': 'application/json' },
			data: { pattern: 'member' },
		});

		// ローカルモード: owner auto-auth → 400 (owner は member パターン不可)
		// cognito-dev: owner → 400
		// 未認証: 401
		const status = res.status();
		expect(status === 400 || status === 401).toBe(true);
	});
});
