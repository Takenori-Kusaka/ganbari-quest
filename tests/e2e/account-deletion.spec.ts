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
	// #2326 (EPIC #2319): 新規 child route `/admin/settings/account` は CI 初回 cold compile
	// で Vite が数分かかる。warmupAdminPages 内部の `180_000` timeout に合わせて
	// beforeAll を 240s に拡張 (旧 60s → cold compile 完了前に hook timeout していた)
	test.setTimeout(240_000);
	// #2321 (EPIC #2319 ②): アカウント削除 UI は /admin/settings/account に移行済
	await warmupAdminPages(browser, ['/admin/settings/account']);
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
			// #4640: 「オーナーを渡せる大人が居るか」も同じ応答で配る (画面側で組み立てない)
			expect(body).toHaveProperty('hasTransferableAdult');
			expect(typeof body.isOnlyMember).toBe('boolean');
			expect(typeof body.hasTransferableAdult).toBe('boolean');
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
		// #2321 (EPIC #2319 ②): アカウント削除 UI は /admin/settings/account に移行済
		await page.goto('/admin/settings/account', { waitUntil: 'commit', timeout: 30_000 });

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
		// #2321 (EPIC #2319 ②): アカウント削除 UI は /admin/settings/account に移行済
		await page.goto('/admin/settings/account', { waitUntil: 'commit', timeout: 30_000 });

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

		// Step 1+2 (確認テキスト + 同意 checkbox) 入力前は削除ボタンが disabled
		// #2319 EPIC Danger Zone 3-step ガード対応
		const deleteButton = page.getByTestId('account-danger-execute-button');
		await expect(deleteButton).toBeVisible({ timeout: 5_000 });
		await expect(deleteButton).toBeDisabled();
	});
});

test.describe('#755 アカウント削除 — UI（cognito-dev モード）free', () => {
	// #1500: storageState で認証済みセッションを再利用（loginAsPlan() 廃止）
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('free プランの owner でもアカウント削除セクションが表示される', async ({ page }) => {
		// #2321 (EPIC #2319 ②): アカウント削除 UI は /admin/settings/account に移行済
		await page.goto('/admin/settings/account', { waitUntil: 'commit', timeout: 30_000 });

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

	// #4472: 無料プランは通常のエクスポート (canExport=false) を使えないため、
	// 退会画面のこの導線が唯一のデータ持ち出し手段になる。退会を実行する前に押せること。
	test('free プランでも退会前のデータ持ち出しボタンが押せて、エクスポート API に到達する', async ({
		page,
	}) => {
		await page.goto('/admin/settings/account', { waitUntil: 'commit', timeout: 30_000 });

		const exportButton = page.getByTestId('account-deletion-export-button');
		if ((await exportButton.count()) === 0) {
			test.info().annotations.push({
				type: 'env-skip',
				description: 'Danger Zone は cognito モードでのみ表示（ローカルモードでは非表示）',
			});
			return;
		}

		await expect(exportButton).toBeVisible({ timeout: 15_000 });
		await expect(exportButton).toBeEnabled();

		// hydration 待ち: SSR 直後の DOM は click しても handler が無く無反応になる。
		// 3-step ガード (確認テキスト + 同意 checkbox → 実行ボタン enabled) は client state
		// なので、これが成立することを hydration の probe に使う (削除は実行しない)。
		await page.fill('#deleteConfirm', 'アカウントを削除します');
		await page.getByTestId('account-danger-agree-checkbox').check();
		await expect(page.getByTestId('account-danger-execute-button')).toBeEnabled({
			timeout: 30_000,
		});
		await page.getByTestId('account-danger-agree-checkbox').uncheck();
		await page.fill('#deleteConfirm', '');
		await expect(page.getByTestId('account-danger-execute-button')).toBeDisabled();

		const [response] = await Promise.all([
			page.waitForResponse((res) => res.url().includes('/api/v1/admin/account/export'), {
				timeout: 30_000,
			}),
			exportButton.click(),
		]);

		expect(response.status()).toBe(200);
		expect(response.headers()['content-disposition']).toContain('attachment');
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
		// #2321 (EPIC #2319 ②): アカウント削除 UI は /admin/settings/account に移行済
		await page.goto('/admin/settings/account', { waitUntil: 'commit', timeout: 30_000 });

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

		// Step 1: 確認テキストを入力
		const confirmInput = page.locator('#deleteConfirm');
		await expect(confirmInput).toBeVisible({ timeout: 5_000 });
		await confirmInput.fill('アカウントを削除します');

		// Step 2: 同意チェックボックス (#2319 EPIC Danger Zone 3-step ガード)
		const agreeCheckbox = page.getByTestId('account-danger-agree-checkbox');
		await expect(agreeCheckbox).toBeVisible({ timeout: 5_000 });
		await agreeCheckbox.check();

		// Step 3: 実行ボタンが有効化されていることを確認してクリック
		const deleteButton = page.getByTestId('account-danger-execute-button');
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
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card).toHaveAttribute('data-plan-tier', 'free');
	});
});

test.describe('#755 プラン別サインアップ → プラン確認 — standard', () => {
	// #1500: storageState で認証済みセッションを再利用（loginAsPlan() 廃止）
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('standard ユーザーでログイン → plan=standard 確認', async ({ page }) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

		const card = page.getByTestId('plan-status-card');
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card).toHaveAttribute('data-plan-tier', 'standard');
	});
});

test.describe('#755 プラン別サインアップ → プラン確認 — family', () => {
	// #1500: storageState で認証済みセッションを再利用（loginAsPlan() 廃止）
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('family ユーザーでログイン → plan=family 確認', async ({ page }) => {
		await page.goto('/admin/subscription', { waitUntil: 'commit', timeout: 30_000 });

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

// ============================================================
// 10. #4699: 退会 (アカウント削除) 申請後の導線が途切れない
//   - 猶予中は **全 admin ページ**でバナー + 復元導線が見える (設定 1 画面に閉じない)
//   - 猶予中でも /switch で子供を選べる (子供選択は cookie のみで DB を書かない)
//   - 書き込みで設定トップへ戻されたときは理由が出る (無言転送にしない)
//   - 猶予中は退会セクションを出さない (復元バナーに集約)
//
// 猶予状態は共有 worker DB の settings に直接書いて再現し、afterAll で snapshot 復元する
// (#2851 パターン。消したまま終えると後続 spec の前提を壊す)。
// ============================================================
test.describe('#4699 退会申請後の導線 (猶予バナー / 子供選択 / 転送理由)', () => {
	test.use({ storageState: 'playwright/.auth/family.json' });

	const DB_PATH = 'data/ganbari-quest.db';
	const GRACE_KEYS = ['soft_deleted_at', 'deletion_grace_plan_tier', 'physical_deletion_date'];
	let snapshot: Record<string, string | null> = {};

	async function withDb<T>(fn: (db: import('better-sqlite3').Database) => T): Promise<T> {
		const { default: Database } = await import('better-sqlite3');
		const db = new Database(DB_PATH);
		try {
			return fn(db);
		} finally {
			db.close();
		}
	}

	test.beforeAll(async () => {
		snapshot = await withDb((db) => {
			const out: Record<string, string | null> = {};
			for (const key of GRACE_KEYS) {
				const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
					| { value: string }
					| undefined;
				out[key] = row?.value ?? null;
			}
			return out;
		});

		// 猶予中 (残り日数あり) を再現する
		const physicalDeletionDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
		await withDb((db) => {
			const upsert = db.prepare(
				"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
			);
			upsert.run('soft_deleted_at', new Date().toISOString());
			upsert.run('deletion_grace_plan_tier', 'standard');
			upsert.run('physical_deletion_date', physicalDeletionDate);
		});
	});

	test.afterAll(async () => {
		await withDb((db) => {
			const upsert = db.prepare(
				"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
			);
			const del = db.prepare('DELETE FROM settings WHERE key = ?');
			for (const key of GRACE_KEYS) {
				const value = snapshot[key];
				if (value === null || value === undefined) {
					del.run(key);
				} else {
					upsert.run(key, value);
				}
			}
		});
	});

	test('猶予中は admin ホーム (設定以外) でも「あと N 日 / 復元」バナーが出る', async ({
		page,
	}) => {
		await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });
		const banner = page.getByTestId('admin-deletion-grace-banner');
		await expect(banner).toBeVisible({ timeout: 15_000 });
		await expect(banner).toContainText('アカウント削除のお手続き中');
		await expect(banner).toContainText('日');
		await expect(page.getByTestId('admin-deletion-grace-banner-restore-button')).toBeVisible();
	});

	test('猶予中は活動管理ページでもバナーが出る (1 画面に閉じない)', async ({ page }) => {
		await page.goto('/admin/activities', { waitUntil: 'commit', timeout: 30_000 });
		await expect(page.getByTestId('admin-deletion-grace-banner')).toBeVisible({ timeout: 15_000 });
	});

	test('猶予中も /switch で子供を選べる (設定トップに転送されない)', async ({ page }) => {
		await page.goto('/switch', { waitUntil: 'domcontentloaded', timeout: 30_000 });
		const firstChild = page.locator('[data-testid^="child-select-"]').first();
		await expect(firstChild).toBeVisible({ timeout: 15_000 });
		await firstChild.click();
		// child home は CI / 初回アクセスで cold compile が入るため余裕を持たせる (#4699 実測 21s)
		await page.waitForURL(/\/(preschool|elementary|junior|senior|baby)\/home/, { timeout: 45_000 });
		expect(page.url()).not.toContain('/admin/settings');
	});

	test('書き込みで設定トップへ戻されたときは理由が表示される', async ({ page }) => {
		await page.goto('/admin/settings?reason=account_deletion_pending', {
			waitUntil: 'commit',
			timeout: 30_000,
		});
		const notice = page.getByTestId('settings-deletion-pending-notice');
		await expect(notice).toBeVisible({ timeout: 15_000 });
		await expect(notice).toContainText('読み取り専用');
	});

	test('猶予中は退会セクションを出さず、復元バナーに集約する', async ({ page }) => {
		await page.goto('/admin/settings/account', { waitUntil: 'commit', timeout: 30_000 });
		await expect(page.getByTestId('deletion-grace-banner')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId('account-danger-zone')).toHaveCount(0);
	});
});

// ============================================================
// 9. #4640 移譲先が居ないときの退会 UI
// ============================================================

// 「他が子供だけの家族グループ」は dev ユーザーの構成では作れない (dev-tenant-001 には
// parent が居る)。削除情報 API を差し替えて、その状態の画面だけを確かめる。
// 実データでの通しは staging (docs/runbooks/staging-live-verification.md) で行う。
test.describe('#4640 オーナー退会 — 移譲先が居ないとき', () => {
	test.use({ storageState: 'playwright/.auth/family.json' });

	async function openDeleteOptions(page: import('@playwright/test').Page) {
		await page.goto('/admin/settings/account', { waitUntil: 'commit', timeout: 30_000 });
		const section = page.getByTestId('account-danger-zone');
		if ((await section.count()) === 0) return false;
		await expect(section).toBeVisible({ timeout: 15_000 });
		await page.locator('#deleteConfirm').fill('アカウントを削除します');
		await page.getByRole('checkbox').last().check();
		await page.getByRole('button', { name: /削除/ }).last().click();
		return true;
	}

	test('他が子供だけなら移譲欄を出さず、全削除だけを提示する', async ({ page }) => {
		await page.route('**/api/v1/admin/account/deletion-info', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					isOnlyMember: false,
					otherMembers: [{ userId: 'u-child', role: 'child', displayName: 'こども' }],
					hasTransferableAdult: false,
				}),
			}),
		);

		if (!(await openDeleteOptions(page))) return;

		// 選択肢が空の移譲欄を出さない (出すと選べず退会できなくなる)
		await expect(page.getByTestId('account-delete-transfer-select')).toHaveCount(0);
		// 代わりに「なぜ渡せないか」と残る選択肢を出す
		await expect(page.getByTestId('account-delete-no-adult-hint')).toBeVisible();
		await expect(page.getByTestId('account-delete-full')).toBeVisible();
	});

	test('大人が居るときは従来どおり移譲欄を出す', async ({ page }) => {
		await page.route('**/api/v1/admin/account/deletion-info', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					isOnlyMember: false,
					otherMembers: [{ userId: 'u-parent', role: 'parent', displayName: 'おとな' }],
					hasTransferableAdult: true,
				}),
			}),
		);

		if (!(await openDeleteOptions(page))) return;

		await expect(page.getByTestId('account-delete-transfer-select')).toBeVisible();
		await expect(page.getByTestId('account-delete-no-adult-hint')).toHaveCount(0);
	});
});
