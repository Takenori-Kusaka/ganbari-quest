/**
 * scripts/capture-specs/flows/admin-activities-import-toast-2745.mjs
 *
 * PR #2748 (Issue #2745, CX bug-5): activity-pack 取込フロー SS。
 *
 * 撮影目的:
 *   Before/After で PR の対象スコープ (取込完了動線の UI) を視覚的に対比する。
 *
 *   - Before: admin/activities default 一覧画面 — POC #2693 / Issue #2745 が指摘した
 *     「取込完了後の feedback 欠落」の起点となる admin 画面。`?import=` クエリなし
 *     で表示した素の状態 (Toast / banner 不在の本来状態)。
 *   - After: `?import=elementary-boy` で ChildSelectionDialog auto-open した状態 —
 *     PR #2748 の SSOT (`+page.svelte` `$effect` で `?import=` query 検出 → dialog auto-open
 *     → 確定 → `showToast()` + `actionMessage` 2 重防御) の対象動線。
 *
 *   注: Toast actually 表示時の SS は demo Lambda (AUTH_MODE=anonymous +
 *   DATA_SOURCE=demo) では `importPackToChildren` POST が DEMO_WRITE_ALLOWLIST 外
 *   で 403 fail するため取得不可。E2E spec (`admin-activities-import-marketplace.spec.ts`
 *   #2745 test) が cognito-dev 環境で Toast `role="alert"` visible を正規 verify する。
 *   本 SS は **取込動線の UI Surface (admin → dialog)** を実機で対比する補強証跡。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 AUTH_MODE=anonymous DATA_SOURCE=demo BASE_URL=http://localhost:5180 \
 *     node scripts/capture.mjs \
 *     --flow admin-activities-import-toast-2745 \
 *     --url /admin/activities?screenshot=all \
 *     --actions scripts/capture-specs/flows/admin-activities-import-toast-2745.mjs \
 *     --presets desktop \
 *     --pr 2748
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5180';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) Before: admin/activities default 一覧 (Toast / banner 不在の素の状態) ---
	await page.goto(`${BASE_URL}/admin/activities?screenshot=all`);
	await page
		.locator('[data-testid="admin-activities-child-tabs"]')
		.waitFor({ state: 'visible', timeout: 15_000 })
		.catch(() => {});
	// transition / hydration 完了待ち
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('pr2748-before-default-no-feedback');

	// --- 2) After: ?import=<presetId> → ChildSelectionDialog auto-open ---
	// PR #2748 が触る動線の入口。確定後に Toast + banner が出る scope を視覚的に提示。
	await page.goto(`${BASE_URL}/admin/activities?import=elementary-boy&screenshot=all`);
	await page
		.locator('[data-testid="child-selection-confirm"]')
		.waitFor({ state: 'visible', timeout: 15_000 })
		.catch(() => {});
	// transition / hydration 完了待ち
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('pr2748-after-import-dialog-open');
};
