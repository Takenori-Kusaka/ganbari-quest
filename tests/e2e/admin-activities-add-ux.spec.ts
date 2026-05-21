/**
 * EPIC #2253 admin/activities add UX 構造的整理 — E2E 回帰テスト
 *
 * 子 ② (#2255): header + dropdown menu (manual / ai / import)
 * 子 ③ (#2256): empty state secondary import link (bulk import bridge)
 * 子 ④ (#2257): ︙ overflow menu (introduce / export / clear-all)
 *
 * #2260 Fix-3: 弱い assertion (`add-activity-dialog` の visible のみ) を、
 *              `activity-import-panel` / `activity-create-form` / `ai-suggest-panel` の
 *              panel 固有 testid 直接 assertion に強化 (ADR-0006)。
 * #2260 Fix-5: AC #2256 `empty-state-import-link` の visibility / click 検証は
 *              SvelteKit SSR + `__data.json` route stub の構造的非互換で E2E 化が
 *              不可能であったため、`tests/unit/components/activity-empty-state.test.ts`
 *              + Storybook stories による単体 / 視覚回帰 SSOT に移行。詳細は本ファイル末尾。
 * #2260 Fix-6: Ark UI Menu (`ArkMenu.Trigger`) の click が hydration 直後に
 *              `data-state="open"` に遷移しない問題を `openMenu` helper の rAF retry で吸収。
 */

import { expect, type Page, test } from '@playwright/test';

/**
 * #2260 Fix-6: Ark UI Menu trigger を開く helper。
 *
 * **根本原因**: Ark UI Menu (`ArkMenu.Trigger`) は client-side hydration 完了後に
 * pointerdown / click listener を attach する。Playwright の `locator.click()` は
 * `waitForLoadState('domcontentloaded')` 完了直後に発火可能だが、その時点では
 * SvelteKit + Ark UI 5.x の event handler attach が間に合っていない場合があり、
 * 初回 click は DOM event として通る (`data-state` は `"closed"` のまま) が
 * menu は開かない。実調査では 3 回目の click で初めて `data-state="open"` に遷移した。
 *
 * **対策**: click が menu を実際に開くまで rAF 間隔で retry する。各 retry は
 * Playwright web-first assertion `toHaveAttribute` ではなく即時 attribute 確認で判定し、
 * 開いていなければ次の rAF 後に再 click を試みる。上限 30 attempts (約 0.5s で完了)。
 *
 * ADR-0006 適合: assertion 自体は強化 (`data-state="open"` の hard signal を assert)、
 * interaction の retry のみで安定化。Skip / weakening ではない。
 */
async function openMenu(page: Page, triggerTestid: string): Promise<void> {
	const trigger = page.getByTestId(triggerTestid);
	await expect(trigger).toBeVisible();
	// hydration wait: window.load 後の最初の rAF まで待ち、Ark UI listener attach を促進
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				if (document.readyState === 'complete') {
					requestAnimationFrame(() => resolve());
				} else {
					window.addEventListener('load', () => requestAnimationFrame(() => resolve()), {
						once: true,
					});
				}
			}),
	);
	// Retry click until Ark UI Menu transitions to `data-state="open"`.
	// Up to 30 attempts (~0.5s) — production hydration / network 揺らぎを吸収する範囲。
	const MAX_ATTEMPTS = 30;
	for (let i = 0; i < MAX_ATTEMPTS; i++) {
		await trigger.click();
		const state = await trigger.evaluate((el) => el.getAttribute('data-state'));
		if (state === 'open') return;
		// rAF 間隔で次の attempt (waitForTimeout は ESLint で禁止)
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
		);
	}
	// fallback: 最終 assertion で hard fail (timeout 5s 内に open になっていない場合)
	await expect(trigger).toHaveAttribute('data-state', 'open');
}

test.describe('EPIC #2253 — admin/activities add UX', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/admin/activities');
		await page.waitForLoadState('domcontentloaded');
	});

	// --- 子 ② / 子 ⑤: AddActivityFab が撤去され FeedbackFab のみが残る ---
	test('AddActivityFab が撤去され、画面 FAB は FeedbackFab のみ (M3 単一 FAB / DESIGN §10)', async ({
		page,
	}) => {
		// 旧 add-activity-fab は撤去済
		await expect(page.getByTestId('add-activity-fab')).toHaveCount(0);
		// header の + 追加 ボタンが代替経路
		const addBtn = page.getByTestId('header-add-activity-btn');
		await expect(addBtn).toBeVisible();
	});

	// --- 子 ②: header + dropdown menu の 3 経路 ---
	test('header + ボタンで manual / ai / import 3 menu item が出現', async ({ page }) => {
		await openMenu(page, 'header-add-activity-btn');
		await expect(page.getByTestId('menu-item-manual')).toBeVisible();
		await expect(page.getByTestId('menu-item-ai')).toBeVisible();
		await expect(page.getByTestId('menu-item-import')).toBeVisible();
	});

	test('menu-item-manual click で manual Dialog + ActivityCreateForm が直接起動 (#2260 Fix-3)', async ({
		page,
	}) => {
		await openMenu(page, 'header-add-activity-btn');
		await page.getByTestId('menu-item-manual').click();
		// Fix-3: Dialog の generic visibility ではなく ActivityCreateForm 固有 testid を assert
		await expect(page.getByTestId('add-activity-dialog')).toBeVisible();
		await expect(page.getByTestId('activity-create-form')).toBeVisible();
		// AddActivityModeSelector の card UI は撤去済 (撤去確認)
		await expect(page.locator('.add-mode-grid')).toHaveCount(0);
		// import panel / ai panel は同時表示されない
		await expect(page.getByTestId('activity-import-panel')).toHaveCount(0);
		await expect(page.getByTestId('ai-suggest-panel')).toHaveCount(0);
	});

	test('menu-item-import click で ActivityImportPanel が直接起動 (#2260 Fix-3)', async ({
		page,
	}) => {
		await openMenu(page, 'header-add-activity-btn');
		await page.getByTestId('menu-item-import').click();
		// Fix-3: ActivityImportPanel 固有 testid を assert (Dialog 一般可視性のみだと
		//        manual / ai / import の区別が付かず ADR-0006 assertion 弱体に該当)
		await expect(page.getByTestId('add-activity-dialog')).toBeVisible();
		await expect(page.getByTestId('activity-import-panel')).toBeVisible();
		// 他 panel は同時表示されない
		await expect(page.getByTestId('activity-create-form')).toHaveCount(0);
		await expect(page.getByTestId('ai-suggest-panel')).toHaveCount(0);
	});

	test('menu-item-ai click で AiSuggestPanel が直接起動 (#2260 Fix-3)', async ({ page }) => {
		await openMenu(page, 'header-add-activity-btn');
		await page.getByTestId('menu-item-ai').click();
		await expect(page.getByTestId('add-activity-dialog')).toBeVisible();
		await expect(page.getByTestId('ai-suggest-panel')).toBeVisible();
		await expect(page.getByTestId('activity-create-form')).toHaveCount(0);
		await expect(page.getByTestId('activity-import-panel')).toHaveCount(0);
	});

	// --- 子 ④: ︙ overflow menu ---
	// #2371 (EPIC #2362 PO 指摘 ③): `introduce` 項目を撤去。`?` page-guide-btn (v2 PageGuideOverlay、PR #2388) に統一
	test('header ︙ ボタンで export / clear-all overflow menu が出現 (introduce は撤去済)', async ({
		page,
	}) => {
		await openMenu(page, 'header-overflow-menu-btn');
		await expect(page.getByTestId('menu-item-introduce')).toHaveCount(0);
		await expect(page.getByTestId('menu-item-export')).toBeVisible();
		await expect(page.getByTestId('menu-item-clear-all')).toBeVisible();
	});

	// #2371 BLOCK-5: assertion 強化 — `?` ボタンが表示されるだけでなく、クリックで PageGuideOverlay
	// (v2) が起動し最初の step タイトルが表示されることまで検証 (ガイド経路の SSOT 検証)。
	test('ヘッダー ? ボタン (page-guide-btn) クリックで PageGuideOverlay が起動する', async ({
		page,
	}) => {
		const helpBtn = page.locator('[data-tutorial="page-guide-btn"]').first();
		await expect(helpBtn).toBeVisible();
		await helpBtn.click();
		// PageGuideOverlay (v2) は role="dialog" + aria-modal で表示される (#2388 AC-V2-7)
		const overlay = page.getByRole('dialog').filter({ has: page.locator('[data-step-id]') });
		await expect(overlay).toBeVisible({ timeout: 5000 });
		// 最初の step title が画面内に存在することで「正しいガイドが起動した」ことを担保
		await expect(overlay.locator('[data-step-id]').first()).toBeVisible();
	});
});

/**
 * #2260 Fix-5 (AC #2256 — ActivityEmptyState 検証移行):
 *
 * **設計判断**: 当初 Fix-4 で SvelteKit `__data.json` route stub 経由で `data.activities = []`
 * を強制し E2E で `empty-state-import-link` の visibility を検証する方針を採ったが、
 * 以下 2 つの構造的理由で実装不可能と判明した:
 *
 * 1. `__data.json` は **client-side navigation** でしか fetch されない。初期 SSR の
 *    `page.goto('/admin/activities')` では HTML payload に dehydrated data が直接埋め込まれ、
 *    route stub の正規表現は素通りされる
 * 2. 代替として「別 admin route → anchor click でクライアント遷移」を試行したが、
 *    SvelteKit 2 の hydration / client router 起動タイミングが flake source となり、
 *    かつ ESLint `playwright/no-wait-for-timeout` でハンドリング選択肢が狭い
 *
 * **採用方針**: `ActivityEmptyState.svelte` の visibility matrix (canAdd × hasFilter の 4 状態)
 * を `tests/unit/components/activity-empty-state.test.ts` で @testing-library/svelte 経由の
 * 単体 component test として SSOT 検証する。Storybook stories
 * (`ActivityEmptyState.stories.svelte`) も 3 visibility 状態を視覚回帰でカバー済。
 * E2E では `/admin/activities` 既存 fixture が真の empty 状態を作らない (170 件 seed) ため、
 * 本 import bridge AC の E2E 単独確認は割に合わない (ROI 過剰)。
 *
 * AC マッピング:
 * - AC1 (empty で link visible): unit test "AC1: canAdd=true, hasFilter=false" でカバー
 * - AC2 (click で onAdd('import') 起動): unit test "AC2: secondary import link click で onAdd('import')" でカバー
 * - AC3 (hasFilter で link 非表示): unit test "AC3: hasFilter=true" でカバー
 * - AC4 (canAdd=false で全非表示): unit test "AC4: canAdd=false" でカバー
 */
