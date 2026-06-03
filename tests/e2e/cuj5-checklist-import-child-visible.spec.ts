/**
 * tests/e2e/cuj5-checklist-import-child-visible.spec.ts
 *
 * CX-DoR 条件 #1 (機能 goal 完遂 / dead-end ゼロ) + #7 (実機貫通証跡) — CUJ-5 terminal verify。
 *
 * 背景 (C-3 / #2544 再発 risk):
 *   既存 `marketplace-checklist-import.spec.ts` は admin 側で「取込済バッジ visible」までを
 *   verify するが、**admin の success message ≠ child 側で実際に表示される** という
 *   gap (dead-end #2544 と同型) を検証していなかった。「admin で取込 → child のチェックリストに
 *   届く」という end-to-end goal の完遂 (= 親が期待する成果) が未担保だった。
 *
 *   本 spec は CUJ-5 (tests/CLAUDE.md §CUJ 5「チェックリスト import → child で表示」) の
 *   terminal goal を貫通する:
 *     1. admin で event-pool checklist を `?import=` auto-open ChildSelectionDialog から
 *        「全員に追加」で配信 (importPresetToChildren, childIds='all')
 *     2. /switch で elementary 子供 (けんたくん) を選択 → /checklist へ遷移
 *     3. 取込した checklist テンプレート (プールの もちもの) とその item が child 画面に visible
 *   配信が壊れていれば child の /checklist に出ず、最終 assert が必ず fail する (dead-end 検出)。
 *
 * video record (C-7):
 *   critical CUJ の顧客レビュー証跡を補完するため、本 spec のみ
 *   `video: 'retain-on-failure'` を有効化する (trace は playwright.config.ts で
 *   `on-first-retry` 全 config 統一済)。全 spec video=on は CI 負荷過大のため
 *   (Pre-PMF / ADR-0010)、critical CUJ spec に限定して fail 時のみ保存する。
 *
 * 設計 (tests/CLAUDE.md §interactive flow act → outcome / ADR-0006 厳守):
 *   - 副作用 A (network 発火): importPresetToChildren response OK を Promise.all で assert
 *   - 副作用 C (永続 + 越境配信反映): child /checklist 上で template + item が visible
 *   - assertion 弱体化なし / waitForTimeout 新規なし / dialog ghost cleanup helper 不採用
 *
 * 関連: #2544 / #2554 follow-up / ADR-0007 (EPIC-merge tier) /
 *        marketplace-checklist-import.spec.ts (admin 側 exemplar)
 */

import { expect, test } from '@playwright/test';

// C-7: critical CUJ の顧客レビュー証跡。fail 時のみ video を保存 (CI 負荷を抑える)。
test.use({ video: 'retain-on-failure' });

const PRESET_ID = 'event-pool';
const PRESET_TEMPLATE_NAME = 'プールの もちもの'; // src/lib/data/marketplace/checklists/event-pool.json
const PRESET_FIRST_ITEM_LABEL = 'みずぎ・ラッシュガード'; // 同 preset payload.items[0].label
// elementary 子供 (age 8、event-pool の targetAge 4-12 内)。global-setup.ts TEST_CHILDREN 参照。
const CHILD_NICKNAME = 'けんたくん';

test.describe('CUJ-5: チェックリスト import → child で表示 (admin→child terminal verify)', () => {
	// child 配信 (DB write) を伴うため直列実行
	test.describe.configure({ mode: 'serial' });
	test.setTimeout(180_000); // Vite dev コールドコンパイル耐性

	test('admin で event-pool を全員に配信 → 子供の /checklist に取込テンプレート + item が visible', async ({
		page,
	}) => {
		test.slow();

		// ============================================================
		// Step 1: admin で `?import=event-pool` → ChildSelectionDialog auto-open →
		//         「全員に追加」→ 確定 (importPresetToChildren, childIds='all')
		// ============================================================
		await page.goto(`/admin/checklists?import=${PRESET_ID}`, {
			waitUntil: 'domcontentloaded',
		});

		const dialog = page.getByTestId('checklist-import-child-selection-dialog');
		await expect(dialog, '?import= で ChildSelectionDialog が auto-open する').toBeVisible({
			timeout: 30_000,
		});

		// 「全員に追加」option を選択 (ChildSelectionDialog primitive の testid)
		const allOption = page.getByTestId('child-selection-all');
		await expect(allOption).toBeVisible();
		await allOption.check();

		// 確定 button enabled (dead-end でない前提) → click → form action 発火 (副作用 A)
		const confirm = page.getByTestId('child-selection-confirm');
		await expect(confirm).toBeEnabled();
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/importPresetToChildren/.test(r.url())),
			confirm.click(),
		]);
		expect(
			resp.ok(),
			`importPresetToChildren response not OK (status ${resp.status()})`,
		).toBeTruthy();

		// ============================================================
		// Step 2: /switch で elementary 子供を選択 → /checklist へ遷移
		//   `?/select` form は use:enhance のため click 後に client redirect される。
		//   Vite dev のコールド compile で enhance hydration が間に合わず click が
		//   失われる場合があるため (admin import 直後の cold path)、既存
		//   child-tutorial-verification.spec.ts の gotoChildHome と同じ「再 /switch →
		//   再 click」retry で home 到達を確実化する (waitForTimeout 不使用)。
		// ============================================================
		const childButton = page
			.locator('[data-testid^="child-select-"]')
			.filter({ hasText: CHILD_NICKNAME });
		let arrivedHome = false;
		for (let attempt = 0; attempt < 4; attempt++) {
			await page.goto('/switch', { waitUntil: 'domcontentloaded' });
			await expect(
				childButton,
				`${CHILD_NICKNAME} の child-select ボタンが seed されていること`,
			).toBeVisible({ timeout: 30_000 });
			await childButton.click();
			try {
				// 選択後 server-side が selectedChildId cookie を set + /elementary/home へ redirect
				await page.waitForURL(/\/elementary\/home/, { timeout: 10_000 });
				arrivedHome = true;
				break;
			} catch {
				// cold-compile で click が失われた → 次の attempt で再 /switch + 再 click
			}
		}
		expect(arrivedHome, `${CHILD_NICKNAME} 選択後 /elementary/home に到達すること`).toBe(true);

		await page.goto('/checklist', { waitUntil: 'domcontentloaded' });

		// ============================================================
		// Step 3 (terminal goal): 取込テンプレート + item が child 画面に visible
		//   配信が壊れていれば /checklist に出ず、ここで必ず fail する (dead-end 検出)。
		// ============================================================
		await expect(
			page.getByText(PRESET_TEMPLATE_NAME, { exact: false }),
			`取込した checklist テンプレート「${PRESET_TEMPLATE_NAME}」が子供の /checklist に表示される`,
		).toBeVisible({ timeout: 30_000 });

		await expect(
			page.getByText(PRESET_FIRST_ITEM_LABEL, { exact: false }),
			`取込した checklist の item「${PRESET_FIRST_ITEM_LABEL}」が子供の /checklist に表示される`,
		).toBeVisible({ timeout: 30_000 });
	});
});
