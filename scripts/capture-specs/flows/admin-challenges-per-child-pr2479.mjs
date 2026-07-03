/**
 * scripts/capture-specs/flows/admin-challenges-per-child-pr2479.mjs
 *
 * PR #2479 (#2362 PR-7): admin/challenges per-child UX + 兄弟連動 UI SS フロー
 *
 * 撮影 3 状態 (mobile + desktop = 6 SS):
 *   1. default state (子供別タブ + 兄弟連動 group + 個別 challenge group)
 *   2. 2nd child タブ切替後 (childId=903 けんたくん / 兄弟連動 + 個別 instance)
 *   3. SiblingChallengeComparison scroll-into-view (兄弟連動 UI focus)
 *
 * #3344: 旧「3. 作成フォーム展開」は #3195/#3231 のチャレンジ自動生成一本化 + 読取専用ビュー化で
 *   「＋ 新規チャレンジ」ボタン / create-form が削除されたため撤去済 (本体 step も除去、L82 付近参照)。
 *
 * 起動前提 (ADR-0048 demo Lambda 同型 env):
 *   AUTH_MODE=anonymous DATA_SOURCE=demo npx vite dev --port 5173 --strictPort
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5173 node scripts/capture.mjs \
 *     --flow admin-challenges-per-child-pr2479 \
 *     --url /admin/challenges?screenshot=all \
 *     --actions scripts/capture-specs/flows/admin-challenges-per-child-pr2479.mjs \
 *     --presets desktop,mobile \
 *     --pr 2479
 *
 * Note: demo fixture (DEMO_CHILD_CHALLENGES) で以下を提供
 *   - 兄弟連動 group: 902/903/904 が sourceTemplateId 'challenge-100pt' を共有
 *   - 個別 group: 903 のみ「うんどう週間チャレンジ」(sourceTemplateId=null)
 *   - AUTH_MODE=anonymous により resolvePlanTier=family を強制 (family-only gate を通過)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/**
 * 子供別タブが render 完了するまで待つ。data.children >= 2 のとき表示される。
 */
async function waitForChildTabs(page) {
	await page
		.locator('[data-testid="admin-challenges-child-tabs"]')
		.waitFor({ state: 'visible', timeout: 15_000 })
		.catch(() => {
			// children < 2 の fixture では子供別タブが現れない (per-child UI が活性化しない)。
			// この場合は撮影継続 (empty state や single child UI を撮る)。
		});
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) default state: 子供別タブ + 兄弟連動 group + 個別 group ---
	await page.goto(`${BASE_URL}/admin/challenges?screenshot=all`);
	await page.waitForLoadState('networkidle');
	await waitForChildTabs(page);
	// 兄弟連動 UI (SiblingChallengeComparison) が render 完了するまで明示待ち
	await page
		.locator('[data-testid="sibling-challenge-comparison"]')
		.first()
		.waitFor({ state: 'attached', timeout: 10_000 })
		.catch(() => {
			// 兄弟連動 group が無い (empty fixture / single child) ケースでは silent skip
		});
	await capture('pr2479-admin-challenges-default-all-tab');

	// --- 2) 2 child 目に切替 (childId=903 けんたくん / per-child filter) ---
	// 兄弟連動 instance + 個別 instance 両方を持つ 903 にフォーカスし、
	// per-child filter 後も SiblingChallengeComparison が出ることを示す。
	await page.goto(`${BASE_URL}/admin/challenges?childId=903&screenshot=all`);
	await page.waitForLoadState('networkidle');
	await waitForChildTabs(page);
	await page
		.locator('[data-testid="admin-challenges-child-tab-903"]')
		.waitFor({ state: 'visible', timeout: 10_000 })
		.catch(() => {});
	// reactive update 安定化 (svelte 5 hydration + filter recompute)
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('pr2479-admin-challenges-child-tab-903');

	// #3344: 旧「3) 作成フォーム展開」step は撤去。チャレンジは #3195/#3231 で自動生成一本化 +
	// 読取専用ビュー化され「＋ 新規チャレンジ」ボタン / create-form (testid
	// `admin-challenges-create-form`) は削除済。dead な click → catch 握りつぶしで空 SS を量産する
	// だけのため step ごと除去した (撮影対象は 兄弟連動 group の閲覧表示に限定)。

	// --- 3) SiblingChallengeComparison focus: 兄弟連動 group の scroll-into-view ---
	// 兄弟連動 UI 単体を強調撮影 (903/902/904 progress bar の 3 行を強調)
	await page.goto(`${BASE_URL}/admin/challenges?screenshot=all`);
	await page.waitForLoadState('networkidle');
	await waitForChildTabs(page);
	const siblingComparison = page.locator('[data-testid="sibling-challenge-comparison"]').first();
	await siblingComparison.scrollIntoViewIfNeeded().catch(() => {});
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('pr2479-admin-challenges-sibling-comparison-focus');
};
