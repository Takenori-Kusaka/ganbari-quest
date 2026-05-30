// tests/e2e/admin-rules-family-scope.spec.ts
// #2362 PR-6: rule bonus 管理画面 (admin/settings/rules) family-scope UX 検証
//
// 検証範囲:
//   1. admin/settings/rules は family-wide 一覧 (per-child タブなし)
//   2. OverflowMenu (top-right ⋮) 配置 + marketplace / restore / export / help 4 項目
//   3. `?import=<presetId>` で auto-import + 一覧反映 (dialog 不要)
//   4. CWE-598: marketplace bonus CTA は childId URL/body を含まない
//   5. exchange 系 preset CTA の入力 form には childId が含まれる (PR-6 scope 外、回帰確認のみ)
//
// 認証: AUTH_MODE=local の自動セットアップで /admin 配下に到達できる前提

import { expect, type Page, test } from './fixtures';

// #2648 Phase A Round 15 (H-9 fix): template DB 直接 DELETE を `workerDbPath` fixture
// 経由に置換。Phase A Step A-4 で webServer が worker DB を見る設計に変えたため。
async function cleanupRulePresetState(workerDbPath: string): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		db.prepare("DELETE FROM settings WHERE key = 'rule_preset_bonus_overrides'").run();
		db.prepare("DELETE FROM settings WHERE key = 'rule_preset_import_warnings'").run();
	} finally {
		db.close();
	}
}

/**
 * Ark UI Menu trigger を確実に開く helper (admin-activities-add-ux.spec.ts #2260 Fix-6 と同パターン)。
 *
 * 根本原因: Ark UI Menu の Trigger は client-side hydration 完了後に
 * pointerdown / click listener を attach する。Playwright の `locator.click()` は
 * `waitForLoadState('domcontentloaded')` 直後に発火可能だが、その時点では
 * hydration が間に合っていない場合があり、初回 click は DOM event として通る
 * (`data-state` は `"closed"` のまま) が menu は開かない。
 *
 * 対策: click が menu を実際に開くまで rAF 間隔で retry (max 30 ~0.5s)。
 * ADR-0006 適合: assertion 強化 (`data-state="open"` を hard assert)、interaction の
 * retry のみで安定化、skip / weakening ではない。
 */
async function openMenu(page: Page, triggerTestid: string): Promise<void> {
	const trigger = page.getByTestId(triggerTestid);
	await expect(trigger).toBeVisible();
	// 2 段階の hydration wait: load + 2 rAF で Ark UI の listener attach を確実に待つ
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				const waitRaf = () => requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				if (document.readyState === 'complete') {
					waitRaf();
				} else {
					window.addEventListener('load', waitRaf, { once: true });
				}
			}),
	);
	// Retry click until Ark UI Menu transitions to `data-state="open"`.
	// Up to 60 attempts (~1s) — production hydration / network 揺らぎを吸収。
	const MAX_ATTEMPTS = 60;
	for (let i = 0; i < MAX_ATTEMPTS; i++) {
		await trigger.click();
		const state = await trigger.evaluate((el) => el.getAttribute('data-state'));
		if (state === 'open') return;
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
		);
	}
	await expect(trigger).toHaveAttribute('data-state', 'open');
}

test.describe('#2362 PR-6 admin/settings/rules family-scope UX', () => {
	test.setTimeout(180_000);

	test.beforeEach(async ({ workerDbPath }) => {
		await cleanupRulePresetState(workerDbPath);
	});

	test('admin/settings/rules: family-wide 一覧、per-child タブ非表示', async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings/rules', { waitUntil: 'domcontentloaded' });

		await expect(page.getByTestId('admin-rules-page')).toBeVisible();

		// rule bonus は family scope なので child-tab は存在しない (per-child UX は activity / reward 系のみ)
		const childTabRow = page.locator('[data-testid="child-tab-row"]');
		expect(await childTabRow.count()).toBe(0);
	});

	test('OverflowMenu: 4 items (marketplace / restore / export / help) が表示される', async ({
		page,
	}) => {
		test.slow();
		await page.goto('/admin/settings/rules', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('admin-rules-page')).toBeVisible();

		// #2260 Fix-6 pattern: Ark UI Menu hydration race を rAF retry で吸収
		await openMenu(page, 'rules-overflow-menu');

		// 4 items 順序: marketplace / restore / export / help (PR-2 OVERFLOW_MENU_LABELS 整合)
		await expect(page.getByTestId('overflow-menu-item-marketplace')).toBeVisible();
		await expect(page.getByTestId('overflow-menu-item-restore')).toBeVisible();
		await expect(page.getByTestId('overflow-menu-item-export')).toBeVisible();
		await expect(page.getByTestId('overflow-menu-item-help')).toBeVisible();

		// rule bonus は family scope のため AI 提案は不要 (個別 child 最適化不可)
		expect(await page.getByTestId('overflow-menu-item-ai-suggest').count()).toBe(0);
	});

	test('OverflowMenu help → Dialog 表示', async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings/rules', { waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('admin-rules-page')).toBeVisible();

		// #2260 Fix-6 pattern: Ark UI Menu hydration race を rAF retry で吸収
		await openMenu(page, 'rules-overflow-menu');
		await page.getByTestId('overflow-menu-item-help').click();

		await expect(page.getByTestId('rules-help-dialog')).toBeVisible({ timeout: 10_000 });
	});

	test('?import=<presetId> auto-import: streak-bonus が一覧に追加される', async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings/rules?import=streak-bonus', {
			waitUntil: 'domcontentloaded',
		});
		await expect(page.getByTestId('admin-rules-page')).toBeVisible();

		// auto-import 完了で preset が一覧に現れる
		await expect(page.getByTestId('rules-bonus-preset-streak-bonus')).toBeVisible({
			timeout: 30_000,
		});

		// URL から ?import=streak-bonus が cleanup されている
		await page.waitForFunction(() => !window.location.search.includes('import='), undefined, {
			timeout: 10_000,
		});
	});

	test('?import=<presetId> with invalid id: error toast 表示 + 一覧変化なし', async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings/rules?import=nonexistent-preset-12345', {
			waitUntil: 'domcontentloaded',
		});
		await expect(page.getByTestId('admin-rules-page')).toBeVisible();

		// 不正 presetId は load 側で wrong-type / not-found 扱い → toast error 表示後 URL cleanup
		await page.waitForFunction(() => !window.location.search.includes('import='), undefined, {
			timeout: 10_000,
		});

		// 一覧に該当 preset は出現しない
		expect(await page.getByTestId('rules-bonus-preset-nonexistent-preset-12345').count()).toBe(0);
	});

	test('CWE-598: marketplace bonus CTA は childId を URL / form に含まない (privacy)', async ({
		page,
	}) => {
		test.slow();
		await page.goto('/marketplace/rule-preset/streak-bonus', { waitUntil: 'domcontentloaded' });

		const bonusRedirect = page.getByTestId('rule-import-bonus-redirect');
		const signupRedirect = page.getByTestId('rule-import-signup-redirect');
		const isLoggedIn = (await bonusRedirect.count()) > 0;

		if (!isLoggedIn) {
			// 未ログイン環境: signup redirect link も childId を含まない (CWE-598 整合)
			await expect(signupRedirect).toBeVisible();
			const href = await signupRedirect.getAttribute('href');
			expect(href).not.toContain('childId');
			expect(href).not.toContain('child=');
			expect(href).not.toContain('child_id');
			return;
		}

		// ログイン環境: bonus link の href が /admin/settings/rules?import=streak-bonus のみで childId を含まない
		const href = await bonusRedirect.getAttribute('href');
		expect(href).toBe('/admin/settings/rules?import=streak-bonus');
		expect(href).not.toContain('childId');
		expect(href).not.toContain('child=');
		expect(href).not.toContain('child_id');

		// marketplace bonus 詳細ページに input[name="childId"] が 0 件
		// (exchange 系では存在しうるので、bonus 限定検証)
		const childIdInputs = page.locator('input[name="childId"]');
		expect(await childIdInputs.count()).toBe(0);
	});

	test('marketplace bonus link click → admin/settings/rules?import=<id> 遷移 → auto-import', async ({
		page,
	}) => {
		test.slow();
		await page.goto('/marketplace/rule-preset/weekend-special', { waitUntil: 'domcontentloaded' });

		const bonusRedirect = page.getByTestId('rule-import-bonus-redirect');
		const signupRedirect = page.getByTestId('rule-import-signup-redirect');
		const isLoggedIn = (await bonusRedirect.count()) > 0;

		if (!isLoggedIn) {
			// 未ログイン環境: signup redirect が見える (回帰防止の最小 assertion)
			await expect(signupRedirect).toBeVisible();
			return;
		}

		await bonusRedirect.click();
		await page.waitForURL(/\/admin\/settings\/rules/);
		await expect(page.getByTestId('admin-rules-page')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('rules-bonus-preset-weekend-special')).toBeVisible({
			timeout: 30_000,
		});
	});
});
