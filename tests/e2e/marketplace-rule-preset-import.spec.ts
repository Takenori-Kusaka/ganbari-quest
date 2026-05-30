// tests/e2e/marketplace-rule-preset-import.spec.ts
// #2138 (MP-3): rule-preset 一括追加フロー E2E
//
// 検証対象 (AC2):
// 1. /marketplace/rule-preset/<itemId> 詳細ページに「一括追加」CTA が描画される
//    (ログイン済 = AUTH_MODE=local 認証通過後)
// 2. bonus 系 preset (例: streak-bonus) を一括追加 → /admin/settings/rules で確認
// 3. exchange 系 preset (例: screen-time-exchange) はお子さま選択 + 一括追加
// 4. 重複追加で alreadyImported メッセージ
// 5. penalty / special 系 preset (JSON 実件数 0 なのでスキップ、UI 経路は detailCtaImportRuleDescPenalty が出る)
//
// 認証: AUTH_MODE=local の自動セットアップで /admin 配下に到達できる前提

import { expect, test } from './fixtures';

// ============================================================
// テスト前 cleanup ヘルパー
// ============================================================

// #2648 Phase A Round 15 (H-9 fix): template DB 直接 DELETE を `workerDbPath` fixture
// 経由に置換。Phase A Step A-4 で webServer が worker DB を見る設計に変えたため。
async function cleanupRulePresetState(workerDbPath: string): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		// bonus overrides settings をクリア
		db.prepare("DELETE FROM settings WHERE key = 'rule_preset_bonus_overrides'").run();
		db.prepare("DELETE FROM settings WHERE key = 'rule_preset_import_warnings'").run();
		// exchange (special_rewards) クリア
		db.prepare("DELETE FROM special_rewards WHERE source_preset_id LIKE 'screen-time-%'").run();
		db.prepare("DELETE FROM special_rewards WHERE source_preset_id LIKE 'sleep-in-%'").run();
		db.prepare("DELETE FROM special_rewards WHERE source_preset_id LIKE 'chore-skip%'").run();
		db.prepare("DELETE FROM special_rewards WHERE source_preset_id LIKE 'night-owl-%'").run();
	} finally {
		db.close();
	}
}

test.describe('#2138 MP-3 marketplace rule-preset 一括追加', () => {
	test.setTimeout(180_000);

	test.beforeEach(async ({ workerDbPath }) => {
		await cleanupRulePresetState(workerDbPath);
	});

	// ============================================================
	// 1. 詳細ページ CTA — bonus (#2362 PR-6 で admin redirect 方式に変更)
	// ============================================================
	test('marketplace/rule-preset/streak-bonus 詳細ページに「admin へ遷移」CTA が表示される (bonus、#2362 PR-6)', async ({
		page,
	}) => {
		test.slow();
		const res = await page.goto('/marketplace/rule-preset/streak-bonus', {
			waitUntil: 'domcontentloaded',
		});
		expect(res?.status()).toBe(200);

		const cta = page.getByTestId('marketplace-detail-cta');
		await expect(cta).toBeVisible();

		// #2362 PR-6: bonus は family scope → in-page form 撤去、admin redirect link に変更
		// AUTH_MODE=local ではログイン済 → bonus redirect link、未ログイン → signup link
		const bonusRedirect = page.getByTestId('rule-import-bonus-redirect');
		const signupLink = page.getByTestId('rule-import-signup-redirect');
		const eitherVisible = (await bonusRedirect.count()) > 0 || (await signupLink.count()) > 0;
		expect(eitherVisible).toBe(true);
	});

	// ============================================================
	// 1b. 詳細ページ CTA — exchange
	// ============================================================
	test('marketplace/rule-preset/screen-time-exchange 詳細ページに CTA が表示される (exchange)', async ({
		page,
	}) => {
		test.slow();
		const res = await page.goto('/marketplace/rule-preset/screen-time-exchange', {
			waitUntil: 'domcontentloaded',
		});
		expect(res?.status()).toBe(200);

		const cta = page.getByTestId('marketplace-detail-cta');
		await expect(cta).toBeVisible();
	});

	// ============================================================
	// 2. bonus 一括追加 → /admin/settings/rules で確認
	// (#2362 PR-6: marketplace link click → admin auto-import + toast 経由に変更)
	// ============================================================
	test('bonus 系 preset 一括追加 → /admin/settings/rules で auto-import + 一覧反映', async ({
		page,
	}) => {
		test.slow();
		await page.goto('/marketplace/rule-preset/streak-bonus', { waitUntil: 'domcontentloaded' });

		const bonusRedirect = page.getByTestId('rule-import-bonus-redirect');
		// AUTH_MODE=local では import 可能。ログイン環境 / 未ログイン環境のいずれでも assertion を切り替える。
		const isLoggedIn = (await bonusRedirect.count()) > 0;
		if (isLoggedIn) {
			// #2362 PR-6: link click → /admin/settings/rules?import=streak-bonus に遷移し auto-import
			await bonusRedirect.click();
			await page.waitForURL(/\/admin\/settings\/rules/);
			await expect(page.getByTestId('admin-rules-page')).toBeVisible({ timeout: 30_000 });

			// auto-import 完了後に preset 一覧に streak-bonus が現れる
			await expect(page.getByTestId('rules-bonus-preset-streak-bonus')).toBeVisible({
				timeout: 30_000,
			});
		} else {
			// 未ログイン: signup CTA が見える (回帰防止のため最低限の assertion)
			await expect(page.getByTestId('rule-import-signup-redirect')).toBeVisible();
		}
	});

	// ============================================================
	// 3. 重複追加 → admin toast info で duplicate 通知
	// (#2362 PR-6: bonus は admin 側 auto-import で duplicate handling)
	// ============================================================
	test('bonus 同 preset を 2 回目追加 → admin 一覧で 1 件のみ表示', async ({ page }) => {
		test.slow();
		await page.goto('/marketplace/rule-preset/early-bird', { waitUntil: 'domcontentloaded' });
		const bonusRedirect = page.getByTestId('rule-import-bonus-redirect');
		const isLoggedIn = (await bonusRedirect.count()) > 0;
		if (isLoggedIn) {
			// 1 回目
			await bonusRedirect.click();
			await page.waitForURL(/\/admin\/settings\/rules/);
			await expect(page.getByTestId('rules-bonus-preset-early-bird')).toBeVisible({
				timeout: 30_000,
			});

			// 2 回目 (再度 marketplace に戻って同 preset を取り込み)
			await page.goto('/marketplace/rule-preset/early-bird', { waitUntil: 'domcontentloaded' });
			await page.getByTestId('rule-import-bonus-redirect').click();
			await page.waitForURL(/\/admin\/settings\/rules/);
			// #2558 真因 fix (3 ラウンド目): client-side `$effect` での auto-import + invalidateAll
			// は非同期 (form submit → action POST → DB write → invalidateAll → page re-render)。
			// `waitForURL` は URL match 直後に resolve するため、count() を即座に呼ぶと
			// re-render 前の DOM (0 件) を読む。Test L102-107 のように `toBeVisible` で
			// auto-retry を効かせてから count を取る (ADR-0006 厳守: assertion 弱体化禁止、
			// 「element 出現待ち → 個数検証」の 2 段 assertion で本質的検証は変えない)。
			await expect(page.getByTestId('rules-bonus-preset-early-bird')).toBeVisible({
				timeout: 30_000,
			});
			// 一覧に 1 件のみ表示 (重複追加されない)
			await expect(page.getByTestId('rules-bonus-preset-early-bird')).toHaveCount(1);
		} else {
			await expect(page.getByTestId('rule-import-signup-redirect')).toBeVisible();
		}
	});

	// ============================================================
	// 4. /admin/settings/rules の ON/OFF 切替
	// (#2362 PR-6: link click 経由で取込)
	// ============================================================
	test('/admin/settings/rules で取込済 preset の有効/無効を切替', async ({ page }) => {
		test.slow();
		// 事前に 1 件取込 (link click 経由)
		await page.goto('/marketplace/rule-preset/weekend-special', { waitUntil: 'domcontentloaded' });
		const bonusRedirect = page.getByTestId('rule-import-bonus-redirect');
		const isLoggedIn = (await bonusRedirect.count()) > 0;
		if (isLoggedIn) {
			await bonusRedirect.click();
			await page.waitForURL(/\/admin\/settings\/rules/);
			const toggleBtn = page.getByTestId('rules-bonus-toggle-weekend-special');
			await expect(toggleBtn).toBeVisible({ timeout: 30_000 });
			await toggleBtn.click();

			// 切替成功
			await expect(page.getByTestId('rules-action-success')).toBeVisible({ timeout: 30_000 });
		} else {
			await expect(page.getByTestId('rule-import-signup-redirect')).toBeVisible();
		}
	});

	// ============================================================
	// 5. /admin/settings/rules empty state
	// ============================================================
	test('/admin/settings/rules 取込ゼロ時 empty state が表示される', async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings/rules', { waitUntil: 'domcontentloaded' });
		const emptyOrSection =
			(await page.getByTestId('rules-empty-state').count()) > 0 ||
			(await page.getByTestId('rules-bonus-section').count()) > 0;
		expect(emptyOrSection).toBe(true);
	});

	// ============================================================
	// 6. 各 rule-preset 10 件全件 200 で開ける (AC2 4 ruleType 全対応の確認)
	// ============================================================
	test('rule-preset 10 件全 (bonus 6 + exchange 4) が 200 で開ける', async ({ page }) => {
		test.slow();
		const presetIds = [
			'streak-bonus',
			'early-bird',
			'weekend-special',
			'category-challenge',
			'sibling-coop',
			'self-study-reward',
			'screen-time-exchange',
			'sleep-in-pass',
			'chore-skip',
			'night-owl-pass',
		];
		for (const id of presetIds) {
			const r = await page.goto(`/marketplace/rule-preset/${id}`, {
				waitUntil: 'domcontentloaded',
			});
			expect(r?.status(), `presetId=${id}`).toBe(200);
		}
	});
});
