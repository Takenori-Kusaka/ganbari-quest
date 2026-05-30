// tests/e2e/child-shop-tabs-filter.spec.ts
// #2157 + #2160: ごほうびショップ 3 系統タブ + カテゴリ・フィルタ E2E
//
// AC マッピング:
//   #2157 AC1: 4 タブ (すべて/もの/おこづかい/とくべつ) が Ark UI Tabs primitive で描画される
//   #2157 AC2: shopCategory ('physical' / 'money' / 'privilege') で reward が振り分けられる
//   #2157 AC3: 該当タブ 0 件時の empty state 表示
//   #2160 AC1: ポイント範囲フィルタ (low / mid / high) が機能する
//   #2160 AC2: 「いまこうかんできる」フィルタが残高比較で機能する
//   #2160 AC3: フィルタ適用中はバッジ表示 + リセットボタン

import { expect, type Page, test } from './fixtures';
import { dismissOverlays, selectKinderChild } from './helpers';

/**
 * Ark UI Tabs (lazyMount + unmountOnExit) のアクティブ panel に scope したロケータを返す。
 *
 * tab 切替直後は「旧 panel が unmount 中」「新 panel が mount 済」の 2 panel が
 * 一瞬同時に DOM に存在し、`page.getByTestId('filter-points-range-low')` が
 * strict mode violation (2 elements) で flake する (#2520 PR #2524 で再現確認)。
 * フィルタ系の testid は全 panel が同名で持つため、アクティブ panel のみに scope
 * することで tab 遷移の race に依存しない決定的クリックにする
 * (Playwright がロケータ解決を auto-retry し、遷移完了まで待つ。waitForTimeout 不使用)。
 *
 * Ark UI / zag-js の Tabs.Content は `data-scope="tabs"` + `data-part="content"` +
 * 選択中のみ `data-selected` 属性を付与する (`tabs.connect.js` getContentProps:
 * `"data-selected": dataAttr(selected)` / 非選択は `hidden`)。`data-state` は付かない
 * ため `[data-selected]` で active panel を選ぶ。
 */
function activeTabPanel(page: Page) {
	return page.locator('[data-scope="tabs"][data-part="content"][data-selected]');
}

/**
 * #2157 / #2160 用に 3 系統 × ポイント帯のテストデータを seed する。
 * 既存 child-shop-exchange.spec.ts のシードを汚さないように
 * 専用 category='shop_tabs_e2e' でマーキング。
 *
 * #2648 Phase A Round 15 (H-9 fix): template DB 直接 seed を `workerDbPath` fixture
 * 経由に置換。Phase A Step A-4 で webServer が worker DB を見る設計に変えたため。
 */
async function seedThreeCategoryRewards(
	workerDbPath: string,
): Promise<{ childId: number; balance: number }> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const child = db
			.prepare('SELECT id FROM children WHERE nickname = ? LIMIT 1')
			.get('たろうくん') as { id: number } | undefined;
		if (!child) throw new Error('たろうくん not found in DB');
		const cId = child.id;

		// バランスを 200pt に固定 (low=50 / mid=300 / high=800 の判定境界を踏む)
		db.prepare("DELETE FROM point_ledger WHERE child_id = ? AND type = 'shop_tabs_test_seed'").run(
			cId,
		);
		db.prepare("DELETE FROM point_ledger WHERE child_id = ? AND type = 'shop_test_seed'").run(cId);
		const current = db
			.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM point_ledger WHERE child_id = ?')
			.get(cId) as { total: number };
		const balanceTarget = 200;
		db.prepare(
			"INSERT INTO point_ledger (child_id, amount, type, description) VALUES (?, ?, 'shop_tabs_test_seed', 'tabs-filter E2E')",
		).run(cId, balanceTarget - current.total);

		// 既存 shop_tabs_e2e seed があれば削除して seed のクリーン化
		db.prepare("DELETE FROM special_rewards WHERE child_id = ? AND category = 'shop_tabs_e2e'").run(
			cId,
		);

		// 3 系統 × ポイント帯 (low <=100 / mid 100..500 / high >=500) の reward を 6 件 seed
		const seeds = [
			// physical (絵文字 + title なし → physical 派生)
			{ title: 'E2E TAB すきなシール', points: 50, icon: '⭐' }, // physical / low
			{ title: 'E2E TAB すきなおもちゃ', points: 500, icon: '🧸' }, // physical / high
			// money (おこづかい語彙で money 派生)
			{ title: 'E2E TAB おこづかい 100', points: 200, icon: '🪙' }, // money / mid
			{ title: 'E2E TAB おこづかい 500', points: 600, icon: '💴' }, // money / high
			// privilege (時間 / けん 語彙で privilege 派生)
			{ title: 'E2E TAB ゲーム時間 +30分', points: 80, icon: '🎮' }, // privilege / low
			{ title: 'E2E TAB よふかしけん', points: 300, icon: '🌙' }, // privilege / mid
		];
		for (const s of seeds) {
			db.prepare(
				"INSERT INTO special_rewards (child_id, title, points, icon, category, shown_at) VALUES (?, ?, ?, ?, 'shop_tabs_e2e', CURRENT_TIMESTAMP)",
			).run(cId, s.title, s.points, s.icon);
		}

		// pending 申請をクリーンアップ
		db.prepare(
			"DELETE FROM reward_redemption_requests WHERE child_id = ? AND status = 'pending_parent_approval'",
		).run(cId);

		return { childId: cId, balance: balanceTarget };
	} finally {
		db.close();
	}
}

async function cleanupSeeds(workerDbPath: string): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		db.prepare("DELETE FROM special_rewards WHERE category = 'shop_tabs_e2e'").run();
		db.prepare("DELETE FROM point_ledger WHERE type = 'shop_tabs_test_seed'").run();
	} finally {
		db.close();
	}
}

test.describe.configure({ mode: 'serial' });

test.describe('#2157 / #2160: ごほうびショップ 3 系統タブ + カテゴリ・フィルタ', () => {
	test.beforeEach(async ({ workerDbPath }) => {
		await seedThreeCategoryRewards(workerDbPath);
	});

	// #2648 Round 15: afterAll は workerInfo 経由で worker DB path を生成して cleanup する
	// (afterAll 内では test fixture が直接使えないため、playwright の workerInfo を経由)。
	test.afterAll(async ({ browser: _browser }, testInfo) => {
		const path = await import('node:path');
		const workerDbPath = path.resolve(`data/e2e-worker-${testInfo.parallelIndex}.db`);
		await cleanupSeeds(workerDbPath);
	});

	test('#2157 AC1: 4 タブ (すべて/もの/おこづかい/とくべつ) が描画される', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');

		await expect(page.getByTestId('shop-page')).toBeVisible();

		// Tabs primitive は data-testid="tab-<value>" を付与する (Tabs.svelte L32)
		await expect(page.getByTestId('tab-all')).toBeVisible();
		await expect(page.getByTestId('tab-physical')).toBeVisible();
		await expect(page.getByTestId('tab-money')).toBeVisible();
		await expect(page.getByTestId('tab-privilege')).toBeVisible();
	});

	test('#2157 AC2: shopCategory で reward が振り分けられる', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');
		await expect(page.getByTestId('shop-page')).toBeVisible();

		// physical タブ: もの系のみ表示される
		await page.getByTestId('tab-physical').click();
		// すべての可視 reward-card が data-shop-category="physical" になっている
		await expect(page.locator('[data-testid^="reward-card-"]:visible').first()).toBeVisible();
		const visibleCategoriesPhysical = await page
			.locator('[data-testid^="reward-card-"]:visible')
			.evaluateAll((els) => els.map((e) => (e as HTMLElement).getAttribute('data-shop-category')));
		// E2E TAB seed の physical 2 件 (シール / おもちゃ) + 既存 shop_e2e seed 3 件 (全 physical) が含まれる
		expect(visibleCategoriesPhysical.length).toBeGreaterThan(0);
		for (const c of visibleCategoriesPhysical) {
			expect(c).toBe('physical');
		}

		// money タブ: お小遣い系のみ
		await page.getByTestId('tab-money').click();
		await expect(page.getByText('E2E TAB おこづかい 100')).toBeVisible();
		const visibleCategoriesMoney = await page
			.locator('[data-testid^="reward-card-"]:visible')
			.evaluateAll((els) => els.map((e) => (e as HTMLElement).getAttribute('data-shop-category')));
		for (const c of visibleCategoriesMoney) {
			expect(c).toBe('money');
		}

		// privilege タブ: 特権系のみ
		await page.getByTestId('tab-privilege').click();
		await expect(page.getByText('E2E TAB ゲーム時間 +30分')).toBeVisible();
		const visibleCategoriesPrivilege = await page
			.locator('[data-testid^="reward-card-"]:visible')
			.evaluateAll((els) => els.map((e) => (e as HTMLElement).getAttribute('data-shop-category')));
		for (const c of visibleCategoriesPrivilege) {
			expect(c).toBe('privilege');
		}
	});

	test('#2160 AC1: ポイント範囲フィルタ (low) が機能する', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');
		await expect(page.getByTestId('shop-page')).toBeVisible();

		// 「すべて」タブで low filter (〜100ポイント) 適用
		await page.getByTestId('filter-points-range-low').click();

		// low (<=100) 範囲の reward が見える
		await expect(page.getByText('E2E TAB すきなシール')).toBeVisible(); // 50pt
		await expect(page.getByText('E2E TAB ゲーム時間 +30分')).toBeVisible(); // 80pt

		// high (>=500) は隠れる
		await expect(page.getByText('E2E TAB すきなおもちゃ')).not.toBeVisible(); // 500pt
		await expect(page.getByText('E2E TAB おこづかい 500')).not.toBeVisible(); // 600pt
	});

	test('#2160 AC2: 「いまこうかんできる」フィルタが残高比較で機能する', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');
		await expect(page.getByTestId('shop-page')).toBeVisible();

		// バランス 200pt + ポイント残高調整 (parallel workers が +すれば変動するが、
		// 残高 >= 200pt は維持される)。available filter で 100/80/200pt 以下の reward のみ可視。
		await page.getByTestId('filter-available').check();

		// 200pt 以下 → 可視
		await expect(page.getByText('E2E TAB すきなシール')).toBeVisible(); // 50pt
		await expect(page.getByText('E2E TAB ゲーム時間 +30分')).toBeVisible(); // 80pt

		// 300/500/600pt → 不可視 (残高 200 未満)
		await expect(page.getByText('E2E TAB すきなおもちゃ')).not.toBeVisible(); // 500pt
		await expect(page.getByText('E2E TAB よふかしけん')).not.toBeVisible(); // 300pt
	});

	test('#2160 AC3: フィルタ適用中はバッジ + リセットボタンが表示される', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');
		await expect(page.getByTestId('shop-page')).toBeVisible();

		// 初期状態 ではバッジもリセットボタンも非表示
		await expect(page.getByTestId('filter-badge')).not.toBeVisible();
		await expect(page.getByTestId('filter-reset')).not.toBeVisible();

		// low filter 適用 → バッジ + リセット表示
		await page.getByTestId('filter-points-range-low').click();
		await expect(page.getByTestId('filter-badge')).toBeVisible();
		await expect(page.getByTestId('filter-reset')).toBeVisible();

		// リセット → バッジ + リセット非表示
		await page.getByTestId('filter-reset').click();
		await expect(page.getByTestId('filter-badge')).not.toBeVisible();
		await expect(page.getByTestId('filter-reset')).not.toBeVisible();
	});

	test('#2157 AC3 + #2160: タブ + filter 組合せ動作', async ({ page }) => {
		await selectKinderChild(page);
		await dismissOverlays(page);
		await page.goto('/preschool/shop');
		await expect(page.getByTestId('shop-page')).toBeVisible();

		// money タブで low filter 適用 → money かつ <=100pt の reward なし → filter-empty
		await page.getByTestId('tab-money').click();
		// tab 切替直後の旧 panel unmount / 新 panel mount の重複を避けるため
		// アクティブ panel に scope してクリック (strict mode violation 回避、#2524)
		const moneyPanel = activeTabPanel(page);
		await moneyPanel.getByTestId('filter-points-range-low').click();

		await expect(moneyPanel.getByTestId('filter-empty')).toBeVisible();
	});
});
