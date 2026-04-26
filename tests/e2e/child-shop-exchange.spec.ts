// tests/e2e/child-shop-exchange.spec.ts
// #1335/#1541: ごほうびショップ 交換フロー E2E テスト（AC1〜AC4）
//
// テスト前提:
//   - global-setup.ts でたろうくん(preschool)に以下のシードデータが投入済み:
//     - ポイント残高: 100pt（beforeEach で再調整するため parallel workers の汚染を防ぐ）
//     - 交換可能なごほうび（交換可）: 50pt — 交換フローテスト専用
//     - 交換可能なごほうび（キャンセル確認用）: 50pt — キャンセルテスト専用（独立）
//     - 交換不可なごほうび: 99999pt（並行ワーカーがどれだけポイントを積んでも届かない閾値）
//
// AC マッピング:
//   AC1: 交換フロー全体（子が申請 → 申請中バッジ確認）
//   AC2: 親が承認（ポイント減算確認）
//   AC3: 親が却下（ポイント変動なし確認）
//   AC4: ポイント不足時は交換ボタンが disabled

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { dismissOverlays, selectKinderChild } from './helpers';

// ============================================================
// ポイント残高リセットヘルパー（DB 直接操作）
// ============================================================
// workers: 2 の並列実行環境では他テストが point_ledger を汚染するため、
// 各テスト実行前に残高を 100pt に強制リセットする（beforeAll では不十分）
async function resetKinderChildBalance(): Promise<void> {
	const DB_PATH = path.resolve('data/ganbari-quest.db');
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(DB_PATH);
	try {
		const child = db
			.prepare('SELECT id FROM children WHERE nickname = ? LIMIT 1')
			.get('たろうくん') as { id: number } | undefined;
		if (!child) return;
		const cId = child.id;

		// 既存の shop_test_seed エントリを削除
		db.prepare("DELETE FROM point_ledger WHERE child_id = ? AND type = 'shop_test_seed'").run(cId);

		// 現在の残高を取得して 100pt になるよう調整
		const { total } = db
			.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM point_ledger WHERE child_id = ?')
			.get(cId) as { total: number };
		const adjustment = 100 - total;
		db.prepare(
			"INSERT INTO point_ledger (child_id, amount, type, description) VALUES (?, ?, 'shop_test_seed', 'E2Eテスト用残高再調整')",
		).run(cId, adjustment);

		// pending 申請をクリーンアップ（交換フローテストが申請を作成した後のリトライ・次テスト安定化）
		// latestRequestStatus が 'pending_parent_approval' だと交換ボタンが非表示になるため
		try {
			db.prepare(
				"DELETE FROM reward_redemption_requests WHERE child_id = ? AND status = 'pending_parent_approval'",
			).run(cId);
		} catch {
			// reward_redemption_requests テーブルが存在しない場合は無視
		}
	} finally {
		db.close();
	}
}

// ============================================================
// 申請直接挿入ヘルパー（DB 直接操作）
// ============================================================
// AC2/AC3 テスト: 子供側 UI フローを経由せず DB に pending 申請を直接挿入し、
// 親側（admin）の承認・却下フローのみを E2E 検証する
async function insertPendingRedemption(
	rewardTitle: string,
): Promise<{ childId: number; rewardId: number; requestId: number; rewardPoints: number }> {
	const DB_PATH = path.resolve('data/ganbari-quest.db');
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(DB_PATH);
	try {
		const child = db
			.prepare('SELECT id FROM children WHERE nickname = ? LIMIT 1')
			.get('たろうくん') as { id: number } | undefined;
		if (!child) throw new Error('たろうくん not found in DB');
		const cId = child.id;

		// 指定タイトルのごほうびを取得
		const reward = db
			.prepare('SELECT id, points FROM special_rewards WHERE child_id = ? AND title = ? LIMIT 1')
			.get(cId, rewardTitle) as { id: number; points: number } | undefined;
		if (!reward) throw new Error(`Reward not found: ${rewardTitle}`);

		// pending 申請を挿入（requested_at は Unix タイムスタンプ）
		const result = db
			.prepare(
				"INSERT INTO reward_redemption_requests (child_id, reward_id, requested_at, status) VALUES (?, ?, ?, 'pending_parent_approval')",
			)
			.run(cId, reward.id, Math.floor(Date.now() / 1000));

		return {
			childId: cId,
			rewardId: reward.id,
			requestId: Number(result.lastInsertRowid),
			rewardPoints: reward.points,
		};
	} finally {
		db.close();
	}
}

/** 現在のポイント残高を DB から取得する */
async function getPointBalance(childId: number): Promise<number> {
	const DB_PATH = path.resolve('data/ganbari-quest.db');
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(DB_PATH);
	try {
		const { total } = db
			.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM point_ledger WHERE child_id = ?')
			.get(childId) as { total: number };
		return total;
	} finally {
		db.close();
	}
}

// 交換フローで DB を変更するため直列実行
test.describe.configure({ mode: 'serial' });

test.describe('#1335: ごほうびショップ 交換フロー', () => {
	// workers: 2 の並列実行で他テストが point_ledger を汚染するため、
	// 各テスト実行前に残高を 100pt に強制リセットする（beforeAll では不十分）
	test.beforeEach(async () => {
		await resetKinderChildBalance();
	});

	test('ショップページが表示される', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');

		const shopPage = page.getByTestId('shop-page');
		await expect(shopPage).toBeVisible();
	});

	test('ポイント残高が表示される', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');

		const balance = page.getByTestId('point-balance');
		await expect(balance).toBeVisible();

		// 残高が数値（ゼロ以上）として表示される
		const balanceText = await balance.textContent();
		const balanceNum = Number.parseInt(balanceText?.replace(/[^\d]/g, '') ?? '', 10);
		expect(balanceNum).toBeGreaterThanOrEqual(0);
	});

	test('ポイント不足のごほうびは交換ボタンが disabled', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');

		await expect(page.getByTestId('shop-page')).toBeVisible();

		// 99999pt のごほうびカードを探す（E2Eテスト用ごほうび（交換不可））
		const expensiveCard = page.locator('[data-testid^="reward-card-"]').filter({
			hasText: 'E2Eテスト用ごほうび（交換不可）',
		});
		await expect(expensiveCard).toBeVisible();

		// そのカード内の交換ボタンが disabled であることを確認
		const disabledBtn = expensiveCard.locator('button[data-testid^="exchange-btn-"]');
		await expect(disabledBtn).toBeDisabled();
	});

	test('交換フロー全体: 確認 → 申請作成 → 申請中バッジ表示', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');

		await expect(page.getByTestId('shop-page')).toBeVisible();

		// 50pt の交換可能なごほうびカードを探す（E2Eテスト用ごほうび（交換可））
		// hasText で部分一致（「交換可）」が「交換不可）」に含まれないことを前提）
		const affordableCard = page.locator('[data-testid^="reward-card-"]').filter({
			hasText: 'E2Eテスト用ごほうび（交換可）',
		});
		await expect(affordableCard).toBeVisible();

		// 交換ボタン（enabled）をクリック
		const exchangeBtn = affordableCard.locator('button[data-testid^="exchange-btn-"]');
		await expect(exchangeBtn).toBeEnabled();
		await exchangeBtn.click();

		// 確認ダイアログが表示される（Ark UI が Portal 経由で描画するため page 全体で探す）
		const confirmYes = page.getByTestId('confirm-exchange-yes');
		await expect(confirmYes).toBeVisible({ timeout: 10000 });

		// 「はい」をクリックして申請
		await confirmYes.click();

		// ダイアログが閉じるのを待つ
		await expect(confirmYes).not.toBeVisible();

		// 申請後は「申請中」バッジが表示されるか、交換ボタンが非表示になる
		// どちらかの状態になることを確認（UIの実装に応じて）
		const pendingBadge = affordableCard.getByText('申請中');
		const exchangeBtnAfter = affordableCard.locator('button[data-testid^="exchange-btn-"]');

		const hasPendingBadge = await pendingBadge.isVisible().catch(() => false);
		const hasExchangeBtn = await exchangeBtnAfter.isVisible().catch(() => false);

		// 申請後は「申請中」バッジが表示されるか交換ボタンが消えるかのどちらか
		expect(hasPendingBadge || !hasExchangeBtn).toBe(true);
	});

	test('キャンセルでダイアログが閉じる', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');

		await expect(page.getByTestId('shop-page')).toBeVisible();

		// キャンセル確認用ごほうびを直接ターゲット（交換フローテストとは独立したシードデータ）
		const cancelTestCard = page.locator('[data-testid^="reward-card-"]').filter({
			hasText: 'E2Eテスト用ごほうび（キャンセル確認用）',
		});
		await expect(cancelTestCard).toBeVisible();

		const exchangeBtn = cancelTestCard.locator('button[data-testid^="exchange-btn-"]');
		await expect(exchangeBtn).toBeEnabled();
		await exchangeBtn.click();

		// 確認ダイアログが表示される
		const confirmCancel = page.getByTestId('confirm-exchange-cancel');
		await expect(confirmCancel).toBeVisible();

		// キャンセルをクリック
		await confirmCancel.click();

		// ダイアログが閉じる
		await expect(confirmCancel).not.toBeVisible();

		// ショップページは引き続き表示されている
		await expect(page.getByTestId('shop-page')).toBeVisible();
	});

	// ============================================================
	// AC2: 親が申請を承認 → ポイント減算確認
	// ============================================================
	test('AC2: 親が申請を承認するとポイントが減算される', async ({ page }) => {
		// DB に pending 申請を直接挿入（交換可 = 50pt）
		const { childId, requestId, rewardPoints } = await insertPendingRedemption(
			'E2Eテスト用ごほうび（交換可）',
		);

		// 承認前のポイント残高を記録
		const balanceBefore = await getPointBalance(childId);

		// 管理者として /admin/rewards へアクセス
		await page.goto('/admin/rewards');

		// 申請タブに切り替え
		await page.getByTestId('tab-requests').click();

		// 承認ボタンが表示されるのを待つ
		const approveBtn = page.getByTestId(`approve-btn-${requestId}`);
		await expect(approveBtn).toBeVisible({ timeout: 10000 });

		// 承認ボタンをクリック
		await approveBtn.click();

		// 承認後: 承認ボタンが消えること（申請が処理済みになる）を確認
		await expect(approveBtn).not.toBeVisible({ timeout: 10000 });

		// ポイント残高がごほうびのポイント分だけ減算されていることを DB で確認
		const balanceAfter = await getPointBalance(childId);
		expect(balanceAfter).toBe(balanceBefore - rewardPoints);
	});

	// ============================================================
	// AC3: 親が申請を却下 → ポイント変動なし確認
	// ============================================================
	test('AC3: 親が申請を却下してもポイントは変動しない', async ({ page }) => {
		// DB に pending 申請を直接挿入（キャンセル確認用 = 50pt）
		const { childId, requestId } = await insertPendingRedemption(
			'E2Eテスト用ごほうび（キャンセル確認用）',
		);

		// 却下前のポイント残高を記録
		const balanceBefore = await getPointBalance(childId);

		// 管理者として /admin/rewards へアクセス
		await page.goto('/admin/rewards');

		// 申請タブに切り替え
		await page.getByTestId('tab-requests').click();

		// 却下ボタンが表示されるのを待つ
		const rejectBtn = page.getByTestId(`reject-btn-${requestId}`);
		await expect(rejectBtn).toBeVisible({ timeout: 10000 });

		// 却下ボタンをクリック（フォームが展開される）
		await rejectBtn.click();

		// 却下確認フォームの「却下する」ボタンをクリック
		// rejectRedemption action に送信するフォーム内の submit ボタン
		const rejectConfirmBtn = page.locator(
			'form[action="?/rejectRedemption"] button[type="submit"]',
		);
		await expect(rejectConfirmBtn).toBeVisible({ timeout: 5000 });
		await rejectConfirmBtn.click();

		// 却下後: 却下ボタンが消えること（申請が処理済みになる）を確認
		await expect(rejectBtn).not.toBeVisible({ timeout: 10000 });

		// ポイント残高が変動していないことを DB で確認（却下なのでポイントは減らない）
		const balanceAfter = await getPointBalance(childId);
		expect(balanceAfter).toBe(balanceBefore);
	});
});
