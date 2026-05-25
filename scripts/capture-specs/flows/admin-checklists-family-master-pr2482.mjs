/**
 * scripts/capture-specs/flows/admin-checklists-family-master-pr2482.mjs
 *
 * PR #2482 (#2362 PR-5 Phase 2): admin/checklists family master UX 全面刷新 SS フロー
 *
 * PR-4 #2474 admin-rewards-per-child-pr2474.mjs / PR-7 #2479 admin-challenges-per-child-pr2479.mjs
 * と同型 pattern。`.catch(() => {})` で失敗を握りつぶさない (SS 偽装防止)。
 *
 * 撮影 4 状態 (mobile + desktop = 8 SS):
 *   1. default state (family templates 一覧 + per-child progress + OverflowMenu top-right)
 *   2. ChecklistDistributionDialog open (per-template 配信先 children 選択 UI)
 *   3. per-child progress section scroll-into-view (template 別の child 進捗 row 強調)
 *   4. OverflowMenu open (4 menu items: marketplace / AI / restore / export / help)
 *
 * 起動前提 (ADR-0048 demo Lambda 同型 env):
 *   AUTH_MODE=anonymous DATA_SOURCE=demo npx vite dev --host 127.0.0.1 --port 5173 --strictPort
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://127.0.0.1:5173 node scripts/capture.mjs \
 *     --flow admin-checklists-family-master-pr2482 \
 *     --url /admin/checklists?screenshot=all \
 *     --actions scripts/capture-specs/flows/admin-checklists-family-master-pr2482.mjs \
 *     --presets desktop,mobile \
 *     --pr 2482
 *
 * Note: demo fixture (DEMO_CHILDREN 901-906) で以下を提供
 *   - family scope: 全 child が同一 tenant に属し family checklists を共有
 *   - per-child progress: distribution 経由で割当られた child ごとに log がある場合 progress 表示
 *   - AUTH_MODE=anonymous により resolvePlanTier=family を強制
 */

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';

/**
 * open dialog 待ち (Ark UI Dialog Portal — data-state="open" polling、hidden 解除も待つ)
 * 失敗時は throw → capture 全体 fail (SS 偽装防止、PR #2474 Round 2 must-3)
 */
async function waitForDialogOpen(page, testid) {
	await page.waitForFunction(
		(t) => {
			const el = document.querySelector(`[data-testid="${t}"]`);
			if (!el) return false;
			const state = el.getAttribute('data-state');
			const hidden = el.hasAttribute('hidden');
			return state === 'open' && !hidden;
		},
		testid,
		{ timeout: 15_000, polling: 100 },
	);
	// transition 完了待ち
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/**
 * admin/checklists page が render 完了するまで待つ。
 * data.familyTemplates が無くても admin-checklists-page container は出る。
 */
async function waitForChecklistsPage(page) {
	await page
		.locator('[data-testid="admin-checklists-page"]')
		.waitFor({ state: 'visible', timeout: 15_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) default state: family templates 一覧 + OverflowMenu top-right ---
	await page.goto(`${BASE_URL}/admin/checklists?screenshot=all`);
	await page.waitForLoadState('networkidle');
	await waitForChecklistsPage(page);
	// OverflowMenu trigger button が render 完了するまで明示待ち
	await page
		.locator('[data-testid="checklists-overflow-menu"]')
		.waitFor({ state: 'visible', timeout: 10_000 });
	await capture('pr2482-admin-checklists-default');

	// --- 2) ChecklistDistributionDialog open ---
	// PR-5 Phase 2 で新規導入された per-template 配信先 children 選択 UI を撮影。
	// 最初の template の「設定」button をクリック → dialog open を必須 wait (失敗時 throw)。
	await page.goto(`${BASE_URL}/admin/checklists?screenshot=all`);
	await page.waitForLoadState('networkidle');
	await waitForChecklistsPage(page);

	// 最初の template の distribution section から configure button を取得
	const configureBtn = page.locator('[data-testid^="checklist-configure-distribution-"]').first();
	const configureBtnCount = await configureBtn.count();
	if (configureBtnCount === 0) {
		throw new Error(
			'[capture] admin-checklists: checklist-configure-distribution-<id> button 未表示 ' +
				'(demo fixture で family templates 0 件、または render 未完了)。',
		);
	}
	await configureBtn.click();
	await waitForDialogOpen(page, 'checklist-distribution-dialog');
	await capture('pr2482-admin-checklists-distribution-dialog-open');
	// Esc で閉じる (後続 step に影響しないように)
	await page.keyboard.press('Escape');

	// --- 3) per-child progress section scroll-into-view ---
	// template 別の child 進捗 row (例: child 902 / 903 / 904 が同一 template に対する完了数表示)
	// を強調撮影。distribution が 1 件以上 ON の template が対象。
	await page.goto(`${BASE_URL}/admin/checklists?screenshot=all`);
	await page.waitForLoadState('networkidle');
	await waitForChecklistsPage(page);
	const progressSection = page.locator('[data-testid^="checklist-per-child-progress-"]').first();
	const progressCount = await progressSection.count();
	if (progressCount === 0) {
		// per-child progress 表示は assignment が必要 (distribution 0 件なら empty message のみ)。
		// demo fixture が legacy childId-bound のため Phase 1 family scope view 変換後に
		// assignments が空のケースが起こりうる。撮影継続せず明確に fail させる
		// (SS-03 が SS-01 と同一になる SS 偽装を防止、PR-4/7 教訓)。
		throw new Error(
			'[capture] admin-checklists: checklist-per-child-progress-<id> 未表示 ' +
				'(demo fixture で distribution 0 件、Phase 1 family view 変換が未動作の可能性)。',
		);
	}
	await progressSection.scrollIntoViewIfNeeded();
	// reactive update 安定化 (svelte 5 hydration + filter recompute)
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('pr2482-admin-checklists-per-child-progress');

	// --- 4) OverflowMenu open: 4 menu items 表示 (marketplace / AI / restore / export / help) ---
	// PR-2 で primitive 化済の OverflowMenu を admin/checklists header に統合した結果を撮影。
	await page.goto(`${BASE_URL}/admin/checklists?screenshot=all`);
	await page.waitForLoadState('networkidle');
	await waitForChecklistsPage(page);
	const overflowMenu = page.locator('[data-testid="checklists-overflow-menu"]');
	await overflowMenu.click();
	// OverflowMenu Ark UI Menu Portal 経由で menu items が出るまで wait。
	// data-testid pattern は OverflowMenu primitive 内部で `overflow-menu-item-<id>` 形式。
	await page.waitForFunction(
		() => document.querySelectorAll('[data-testid^="overflow-menu-item-"]').length >= 3,
		undefined,
		{ timeout: 10_000, polling: 100 },
	);
	// transition 完了待ち
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('pr2482-admin-checklists-overflow-menu-open');
};
