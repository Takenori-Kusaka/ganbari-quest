// tests/e2e/child-shop-exchange.spec.ts
// #1335/#1541: ごほうびショップ 交換フロー E2E テスト（AC1〜AC4）
//
// テスト前提:
//   - global-setup.ts でたろうくん(preschool)に以下のシードデータが投入済み:
//     - ポイント残高: 100pt（beforeEach で再調整するため parallel workers の汚染を防ぐ）
//     - 交換可能なごほうび（交換可）: 50pt — 交換フローテスト専用
//     - 交換可能なごほうび（キャンセル確認用）: 50pt — キャンセルテスト専用（独立）
//     - 交換不可なごほうび: 10000pt（special-reward ドメイン上限 = reward-set export schema 上限。
//       テスト child の残高 ~100pt を遥かに超え交換不可を維持。#3132 で旧 99999pt = out-of-domain を是正）
//
// AC マッピング:
//   AC1: 交換フロー全体（子が申請 → 申請中バッジ確認）
//   AC2: 親が承認（ポイント減算確認）
//   AC3: 親が却下（ポイント変動なし確認）
//   AC4: ポイント不足時は交換ボタンが disabled

import { expect, test } from './fixtures';
import { dismissOverlays, selectKinderChild } from './helpers';

// ============================================================
// ポイント残高リセットヘルパー（DB 直接操作）
// ============================================================
// workers: 2 の並列実行環境では他テストが point_ledger を汚染するため、
// 各テスト実行前に残高を 100pt に強制リセットする（beforeAll では不十分）
//
// #2648 Phase A Round 15 (H-9 fix): `path.resolve('data/ganbari-quest.db')` (template DB)
// 直接 seed を `workerDbPath` fixture 経由に置換。
// Phase A Step A-4 で webServer が `DATABASE_URL=./data/e2e-worker-<i>.db` を使う設計に
// 変えたため、template DB に seed しても preview server (worker DB を見る) からは
// 不可視 = 5 spec で flake (Round 14 §0.1 / §3.1)。
async function resetKinderChildBalance(workerDbPath: string): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
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
	workerDbPath: string,
	rewardTitle: string,
): Promise<{ childId: number; rewardId: number; requestId: number; rewardPoints: number }> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
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

/**
 * 特定の申請に紐づく reward_redemption 台帳エントリを取得する。
 *
 * AC2/AC3 では「承認/却下によってポイントが正しく変動したか」を検証する必要がある。
 * しかし total balance を直接比較すると、並行ワーカーで実行される
 * `child-shop-tabs-filter.spec.ts` 等が `たろうくん` の `point_ledger` を
 * 同時に書き換えるため (shop_test_seed 削除 + 200pt 再 seed)、
 * balanceBefore と balanceAfter の差分が予測不能になる (#2292 BLOCK の根本原因)。
 *
 * そこで「申請単位の因果関係」を直接検証する: 承認時は `insertPointEntry` で
 * `type='reward_redemption'` + `reference_id=requestId` のエントリが 1 件挿入される
 * (`reward-redemption-service.ts:163`)。却下時は同エントリが挿入されない。
 * 並行テストは異なる `type` (shop_test_seed / shop_tabs_test_seed / `null` reference_id) を使うため、
 * `reference_id = ?` で完全分離できる。
 */
async function getRedemptionLedgerEntries(
	workerDbPath: string,
	requestId: number,
): Promise<Array<{ amount: number; type: string }>> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		return db
			.prepare(
				"SELECT amount, type FROM point_ledger WHERE reference_id = ? AND type = 'reward_redemption'",
			)
			.all(requestId) as Array<{ amount: number; type: string }>;
	} finally {
		db.close();
	}
}

// 交換フローで DB を変更するため直列実行
test.describe.configure({ mode: 'serial' });

test.describe('#1335: ごほうびショップ 交換フロー', () => {
	// workers: 2 の並列実行で他テストが point_ledger を汚染するため、
	// 各テスト実行前に残高を 100pt に強制リセットする（beforeAll では不十分）
	test.beforeEach(async ({ workerDbPath }) => {
		await resetKinderChildBalance(workerDbPath);
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

		// 10000pt のごほうびカードを探す（E2Eテスト用ごほうび（交換不可）。#3132 で 99999→10000）
		const expensiveCard = page.locator('[data-testid^="reward-card-"]').filter({
			hasText: 'E2Eテスト用ごほうび（交換不可）',
		});
		// #3163: 重複なし不変条件を明示。共有 worker DB が backup/restore 等で汚染され
		// 同一 reward が 2 行になると本 assertion が「2」を報告して原因を即指摘する
		// (toBeVisible 単体の strict-mode violation より診断的)。
		await expect(expensiveCard).toHaveCount(1);
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
		// #3163: 交換可ごほうびも 1 枚のみ (worker DB 汚染で複製されていないこと) を保証
		await expect(affordableCard).toHaveCount(1);
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
		// #1771: isVisible() 同期評価 + 論理合成 (hasA || !hasB).toBe(true) は auto-retry が
		// 効かず flake する (#1768 admin-checklists 同類問題)。expect.poll() で web-first 化する。
		const pendingBadge = affordableCard.getByText('申請中');
		const exchangeBtnAfter = affordableCard.locator('button[data-testid^="exchange-btn-"]');

		// 「申請中バッジが表示される」または「交換ボタンが消える」のどちらかになるまで poll
		// (UI の実装により遷移タイミングが異なるが、いずれにせよ 5s 以内に確定する)
		await expect
			.poll(
				async () => {
					const hasPendingBadge = await pendingBadge.isVisible().catch(() => false);
					const hasExchangeBtn = await exchangeBtnAfter.isVisible().catch(() => false);
					return hasPendingBadge || !hasExchangeBtn;
				},
				{ timeout: 5000 },
			)
			.toBe(true);
	});

	// ============================================================
	// #2155 Dialog UX 改善: アイコン拡大 + 階層化表示 + ボタン強調
	// ============================================================
	test('#2155: 確認 Dialog にアイコン大表示 + 階層化表示 + 強調ボタンが描画される', async ({
		page,
	}) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');

		await expect(page.getByTestId('shop-page')).toBeVisible();

		const affordableCard = page.locator('[data-testid^="reward-card-"]').filter({
			hasText: 'E2Eテスト用ごほうび（交換可）',
		});
		await affordableCard.locator('button[data-testid^="exchange-btn-"]').click();

		// AC1: 確認 Dialog 自体が描画
		const dialog = page.getByTestId('exchange-confirm-dialog');
		await expect(dialog).toBeVisible({ timeout: 10000 });

		// AC2: 階層化表示 — title と points が独立要素で描画される
		await expect(page.getByTestId('confirm-reward-title')).toBeVisible();
		await expect(page.getByTestId('confirm-reward-points')).toBeVisible();

		// AC3: 「はい」/「やめる」両方表示
		await expect(page.getByTestId('confirm-exchange-yes')).toBeVisible();
		await expect(page.getByTestId('confirm-exchange-cancel')).toBeVisible();

		// 「やめる」で閉じて副作用なし
		await page.getByTestId('confirm-exchange-cancel').click();
		await expect(dialog).not.toBeVisible();
	});

	// ============================================================
	// #2156 Grid + レスポンシブ: reward-list の display: grid 化
	// ============================================================
	test('#2156: reward-list が CSS Grid で描画される', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');

		await expect(page.getByTestId('shop-page')).toBeVisible();

		const grid = page.getByTestId('reward-grid');
		await expect(grid).toBeVisible();

		// display: grid が適用されていることを確認
		const displayValue = await grid.evaluate((el) => getComputedStyle(el).display);
		expect(displayValue).toBe('grid');

		// grid-template-columns に minmax が反映されている
		const templateCols = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
		// preschool は --reward-grid-min=320px (minmax 経由で px 値が解決される)
		expect(templateCols).toMatch(/px/);
	});

	test('キャンセルでダイアログが閉じる', async ({ page, workerDbPath }) => {
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
		// #2558 fix: 並列 worker (workers: 2) が point_ledger を同時更新するため、
		// beforeEach の resetKinderChildBalance 完了後でも shop ページ load 時点で残高 < 50pt に
		// 落ちている flake が観察された。残高再 reset + page reload で復旧を試みる (最大 3 回)。
		// 試行ごとに resetKinderChildBalance を再実行することで他 worker の干渉を打ち消す。
		let enabled = await exchangeBtn.isEnabled().catch(() => false);
		for (let attempt = 0; attempt < 3 && !enabled; attempt++) {
			await resetKinderChildBalance(workerDbPath);
			await page.reload();
			await expect(page.getByTestId('shop-page')).toBeVisible();
			await expect(cancelTestCard).toBeVisible();
			enabled = await exchangeBtn.isEnabled().catch(() => false);
		}
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
	// #2292: 並行 worker (workers: 2 + fullyParallel: true) で実行される
	// `child-shop-tabs-filter.spec.ts` が `たろうくん` の point_ledger を同時に
	// 書き換えるため、total balance 比較 (`getPointBalance(childId)`) は flake する。
	// 代わりに「この申請に紐づく reward_redemption 台帳エントリ」を直接検証する
	// (`reference_id = requestId`、ADR-0006: assertion 強化方向)。
	test('AC2: 親が申請を承認するとポイントが減算される', async ({ page, workerDbPath }) => {
		// DB に pending 申請を直接挿入（交換可 = 50pt）
		const { requestId, rewardPoints } = await insertPendingRedemption(
			workerDbPath,
			'E2Eテスト用ごほうび（交換可）',
		);

		// 承認前: この申請に紐づく reward_redemption エントリは 0 件
		const ledgerBefore = await getRedemptionLedgerEntries(workerDbPath, requestId);
		expect(ledgerBefore.length).toBe(0);

		// #2269: 申請承認は /admin/rewards/requests に分離されたため直接遷移
		await page.goto('/admin/rewards/requests');

		// 承認ボタンが表示されるのを待つ
		const approveBtn = page.getByTestId(`approve-btn-${requestId}`);
		await expect(approveBtn).toBeVisible({ timeout: 10000 });

		// 承認ボタンをクリック
		await approveBtn.click();

		// 承認後: 承認ボタンが消えること（申請が処理済みになる）を確認
		await expect(approveBtn).not.toBeVisible({ timeout: 10000 });

		// 承認後: この申請に紐づく reward_redemption エントリが
		// ちょうど 1 件、amount = -rewardPoints で挿入されていることを DB で確認
		// (`reward-redemption-service.ts:163-172` の insertPointEntry 呼び出しと対応)
		const ledgerAfter = await getRedemptionLedgerEntries(workerDbPath, requestId);
		expect(ledgerAfter.length).toBe(1);
		expect(ledgerAfter[0]?.amount).toBe(-rewardPoints);
	});

	// ============================================================
	// AC3: 親が申請を却下 → ポイント変動なし確認
	// ============================================================
	// #2292: AC2 と同じ理由で total balance 比較は使えない。
	// 却下フローは service 層 (`reward-redemption-service.ts:206-240`) で
	// `insertPointEntry` を呼ばないため、この申請に紐づく
	// reward_redemption ledger エントリは 0 件のまま (前後共に 0)。
	test('AC3: 親が申請を却下してもポイントは変動しない', async ({ page, workerDbPath }) => {
		// DB に pending 申請を直接挿入（キャンセル確認用 = 50pt）
		const { requestId } = await insertPendingRedemption(
			workerDbPath,
			'E2Eテスト用ごほうび（キャンセル確認用）',
		);

		// 却下前: この申請に紐づく reward_redemption エントリは 0 件
		const ledgerBefore = await getRedemptionLedgerEntries(workerDbPath, requestId);
		expect(ledgerBefore.length).toBe(0);

		// #2269: 申請承認は /admin/rewards/requests に分離されたため直接遷移
		await page.goto('/admin/rewards/requests');

		// 却下ボタンが表示されるのを待つ
		const rejectBtn = page.getByTestId(`reject-btn-${requestId}`);
		await expect(rejectBtn).toBeVisible({ timeout: 10000 });

		// 却下ボタンをクリック（フォームが展開される）
		// #2292: Svelte 5 hydration timing race のため、フォームが表示されるまで
		// click → re-render を最大数回繰り返す。Locator.click 単体では hydration 前の
		// click が空振りするケースが local dev mode で flake する (CI でも稀に観測)。
		// expect.poll で auto-retry させることで auto-retryable assertion 化する。
		const rejectConfirmBtn = page.locator(
			'form[action="?/rejectRedemption"] button[type="submit"]',
		);
		await expect
			.poll(
				async () => {
					if (await rejectConfirmBtn.isVisible().catch(() => false)) return true;
					// click を idempotent に繰り返す: フォーム展開前は再 click で展開を試みる
					await rejectBtn.click({ timeout: 2000 }).catch(() => {});
					return rejectConfirmBtn.isVisible().catch(() => false);
				},
				{ timeout: 10000, intervals: [500, 1000, 1500] },
			)
			.toBe(true);
		await rejectConfirmBtn.click();

		// 却下後: 却下ボタンが消えること（申請が処理済みになる）を確認
		await expect(rejectBtn).not.toBeVisible({ timeout: 10000 });

		// 却下後: この申請に紐づく reward_redemption エントリは 0 件のままであることを DB で確認
		// (rejectRedemption はステータス更新のみで point_ledger を変更しないため)
		const ledgerAfter = await getRedemptionLedgerEntries(workerDbPath, requestId);
		expect(ledgerAfter.length).toBe(0);
	});
});
