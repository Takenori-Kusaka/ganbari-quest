/**
 * tests/e2e/helpers/goal-flows.ts — goal 完遂を強制する thin wrapper (#2544)
 *
 * 背景 (実害):
 *   初顧客レビュー直前、marketplace 取込ダイアログで「追加ボタン無反応・キャンセル不能」
 *   (機能 dead-end) を実ユーザーが 1 分で発見。一方 E2E `admin-unified-import-hub.spec.ts`
 *   は「ダイアログが render される / testid visible」だけを assert して PASS していた。
 *   = render proxy は緑、goal 完遂は壊れている (#2544 research §1)。
 *
 * 設計原則 (tests/CLAUDE.md §interactive flow):
 *   - 「open → act → 副作用 verify」を 1 関数に固める。expect を内包するため
 *     `playwright/expect-expect` の `assertFunctionNames` に登録 (eslint.config.js)。
 *   - helper は **thin** に保つ (Playwright/Storybook 公式の「helper を厚くしない」整合)。
 *     新規 framework / 独自 DSL は作らない。Playwright web-first assertion の正しい pattern 集。
 *   - 検証すべき「結果」(副作用) = network 発火 / UI 反映 / 永続のいずれか 1 つ以上。
 *
 * 正解 pattern の出典: tests/e2e/marketplace-checklist-import.spec.ts:109-113
 *   (importBtn.click() → imported バッジ visible assert = dead-end なら必ず fail)
 *
 * 関連: #2544 / #2459 / ADR-0007 (EPIC-merge tier)
 */

import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Ark UI Menu trigger を click して menu を開き、指定の menu item が表示されるまで待つ。
 *
 * 成功条件は trigger の `data-state=open` ではなく **menu item (`menu-item-<id>`) の visible** とする。
 * Ark UI Menu の trigger は press 後すぐ `data-state` が安定しない場合があり、
 * `force:true` 連打は逆に menu の open/close をトグルしてしまうため (admin-unified-import-hub.spec.ts
 * が tablet で flake していた原因)。menu content の出現を成功条件にする方が web-first assertion に整合。
 */
export async function openMenu(
	page: Page,
	triggerTestid: string,
	menuItemTestid?: string,
): Promise<void> {
	const trigger = page.getByTestId(triggerTestid);
	await expect(trigger).toBeVisible();
	await expect(trigger).toBeEnabled();

	if (menuItemTestid) {
		const item = page.getByTestId(menuItemTestid);
		// hydration 完了後に click。menu item が出るまで最大数回 retry (open/close トグル耐性)。
		for (let attempt = 0; attempt < 5; attempt++) {
			await trigger.click();
			try {
				await expect(item).toBeVisible({ timeout: 2_000 });
				return;
			} catch {
				// 開けなかった (or トグルで閉じた) → 次の attempt で再 click
			}
		}
		// 最終 attempt は通常 timeout でエラー詳細を出す
		await trigger.click();
		await expect(
			item,
			`menu item ${menuItemTestid} not visible after opening ${triggerTestid}`,
		).toBeVisible({
			timeout: 10_000,
		});
		return;
	}

	// menuItemTestid 未指定時は trigger data-state=open を待つ (後方互換)
	for (let attempt = 0; attempt < 5; attempt++) {
		await trigger.click();
		const state = await trigger.getAttribute('data-state');
		if (state === 'open') return;
	}
	const finalState = await trigger.getAttribute('data-state');
	expect(finalState, `menu trigger ${triggerTestid} not open after 5 attempts`).toBe('open');
}

export interface CompleteImportFlowOpts {
	/** header の `+` dropdown menu trigger testid (例: 'header-add-activity-btn') */
	trigger: string;
	/** menu を開いた後にクリックする import 項目 testid (例: 'menu-item-import') */
	menuItem: string;
	/** import 実行ボタン testid (例: 'marketplace-preset-import-<id>') */
	presetTestid: string;
	/** submit 後に form action が叩く URL の正規表現 (副作用 A: 発火検証)。省略時は network 検証を skip */
	responseUrlPattern?: RegExp;
	/** submit 後に閉じることを期待する dialog testid (副作用 B: dialog close) */
	expectClosedTestid?: string;
	/** submit 後に visible になることを期待する imported バッジ testid (副作用 B: 完了反映) */
	expectImportedTestid?: string;
}

/**
 * import dialog の goal 完遂を強制する。
 * 「menu open → import 項目 click → 追加ボタン enabled 確認 → click →
 *   ① network 発火 (任意) ② imported バッジ visible または dialog close」まで貫通する。
 * dead-end (ボタン無反応) なら ②(expectImported/Closed) のいずれかが必ず fail する。
 *
 * 副作用 B (expectImportedTestid / expectClosedTestid) は最低 1 つの指定を必須とする
 * (render-only に逃げないため)。両方未指定なら assert error を投げる。
 */
export async function completeImportFlow(page: Page, opts: CompleteImportFlowOpts): Promise<void> {
	expect(
		opts.expectImportedTestid !== undefined || opts.expectClosedTestid !== undefined,
		'completeImportFlow: expectImportedTestid または expectClosedTestid のいずれかが必須 (render-only 禁止)',
	).toBe(true);

	await openMenu(page, opts.trigger, opts.menuItem);
	await page.getByTestId(opts.menuItem).click();

	const btn = page.getByTestId(opts.presetTestid);
	// dead-end の前提: ボタンが押下可能であること
	await expect(btn).toBeEnabled();

	if (opts.responseUrlPattern) {
		// 副作用 A: form action / API が実際に発火したか
		const pattern = opts.responseUrlPattern;
		const [resp] = await Promise.all([
			page.waitForResponse((r) => pattern.test(r.url())),
			btn.click(),
		]);
		expect(resp.ok(), `import response not OK (status ${resp.status()})`).toBeTruthy();
	} else {
		await btn.click();
	}

	// 副作用 B: imported バッジ visible または dialog close (dead-end なら fail)
	if (opts.expectImportedTestid) {
		await expect(page.getByTestId(opts.expectImportedTestid)).toBeVisible({ timeout: 30_000 });
	}
	if (opts.expectClosedTestid) {
		await expect(page.getByTestId(opts.expectClosedTestid)).toHaveCount(0, { timeout: 30_000 });
	}
}

/**
 * 一覧の件数が期待どおり増えた (永続反映された) ことを assert する。
 * 副作用 C: dead-end / 無反応なら件数が変わらず fail する。
 */
export async function expectListGrew(rows: Locator, before: number, delta = 1): Promise<void> {
	await expect(rows).toHaveCount(before + delta, { timeout: 30_000 });
}

export interface ExpectImportSucceedsOpts {
	/** import 実行ボタン testid (例: 'marketplace-preset-import-<id>') */
	presetTestid: string;
	/** import 成功後に visible になる imported バッジ testid (例: 'marketplace-preset-imported-<id>') */
	importedTestid: string;
}

/**
 * menu を介さず画面に直接表示された import ボタン (admin/checklists 等) の goal 完遂を強制する。
 * 「ボタン enabled 確認 → click → imported バッジ visible + ボタン disabled」まで貫通する。
 * dead-end (無反応) なら imported バッジが出ず必ず fail する。
 * 既に取込済 (alreadyImported) の fixture 状態にも対応 (バッジ visible + disabled を確認して return)。
 *
 * 正解 pattern の出典: tests/e2e/marketplace-checklist-import.spec.ts:84-117
 */
export async function expectImportSucceeds(
	page: Page,
	opts: ExpectImportSucceedsOpts,
): Promise<void> {
	const importBtn = page.getByTestId(opts.presetTestid);
	await expect(importBtn).toBeVisible({ timeout: 30_000 });

	const importedBadge = page.getByTestId(opts.importedTestid);
	// 既に取込済 (fixture / 再実行) → バッジ visible + ボタン disabled を確認して return
	if ((await importedBadge.count()) > 0) {
		await expect(importedBadge).toBeVisible();
		await expect(importBtn).toBeDisabled();
		return;
	}

	// 取込前: ボタンが enabled (dead-end でない前提)
	await expect(importBtn).toBeEnabled();
	await importBtn.click();

	// 副作用: 取込済バッジ visible + ボタン disabled (dead-end なら fail)
	await expect(importedBadge).toBeVisible({ timeout: 30_000 });
	await expect(importBtn).toBeDisabled();
}

/**
 * dialog が閉じている (= 操作後 / cancel 後に dead-end でない) ことを assert する。
 */
export async function expectDialogClosed(page: Page, dialogTestid: string): Promise<void> {
	await expect(page.getByTestId(dialogTestid)).toHaveCount(0, { timeout: 30_000 });
}

export interface ExpectDialogCancellableOpts {
	/** dialog を開く header trigger testid */
	trigger: string;
	/** menu を開いた後にクリックする項目 testid (dialog を開く) */
	menuItem: string;
	/** 表示された dialog testid (cancel 前に visible 確認) */
	dialogTestid: string;
	/**
	 * cancel / close ボタンの取得方法 (いずれか 1 つ指定):
	 *   - cancelTestid: testid で取得
	 *   - cancelLabel: aria-label / role name で取得 (getByRole 優先、Testing Library 原則)
	 */
	cancelTestid?: string;
	cancelLabel?: string;
}

/**
 * 「dialog を開く → cancel / close を押す → dialog が閉じる」を貫通検証する。
 * cancel 不能 (今回 bug の 1 つ) なら最後の toBeHidden が必ず fail する。
 * cancel ボタンは Testing Library 原則に従い cancelLabel (role) を優先し、
 * testid しか無い場合は cancelTestid を使う。
 */
export async function expectDialogCancellable(
	page: Page,
	opts: ExpectDialogCancellableOpts,
): Promise<void> {
	expect(
		opts.cancelTestid !== undefined || opts.cancelLabel !== undefined,
		'expectDialogCancellable: cancelTestid または cancelLabel のいずれかが必須',
	).toBe(true);

	await openMenu(page, opts.trigger, opts.menuItem);
	await page.getByTestId(opts.menuItem).click();
	const dialog = page.getByTestId(opts.dialogTestid);
	await expect(dialog).toBeVisible();
	const cancelBtn = opts.cancelLabel
		? page.getByRole('button', { name: opts.cancelLabel })
		: page.getByTestId(opts.cancelTestid as string);
	await cancelBtn.click();
	await expect(dialog).toBeHidden({ timeout: 30_000 });
}
