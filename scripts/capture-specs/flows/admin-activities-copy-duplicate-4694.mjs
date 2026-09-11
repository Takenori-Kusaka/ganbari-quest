/**
 * scripts/capture-specs/flows/admin-activities-copy-duplicate-4694.mjs
 *
 * Issue #4694: 「別のお子さまからコピー」の結果表示の before / after SS。
 *
 * 撮影する 1 コマ (どちらの build でも同じ操作列):
 *   2 人目の子タブを選択 → 「+ 追加」→「別のお子さまからコピー」→ 先頭の候補を選んで実行
 *   → 結果表示 (`admin-activities-action-message`)
 *     - 修正前 (origin/develop, SS_PHASE=before-*): 実際には 1 件も書き込まれていないのに
 *       「コピーが完了しました」。何件入ったか / 何件が重複だったかを読む手段が無い
 *     - 修正後 (本 PR, SS_PHASE=after-*): 結果を読んで出す。demo は write no-op なので
 *       「デモではお試し用です（実際の活動のコピーは行われません）」= 成功偽装しない
 *
 * 撮影環境の注記 (ADR-0048): demo 環境は form action の write を hooks で no-op に
 * 差し替える (`src/lib/server/demo/demo-mode.ts`) ため、実件数入りの結果文
 * 「📋 N 件の活動をコピーしました（M 件はすでにあるためスキップ）」は demo では出せない。
 * 件数と重複 skip の検証は `tests/unit/services/child-activity-copy-service.test.ts` /
 * `tests/unit/domain/child-copy-result-labels.test.ts` /
 * `tests/e2e/admin-activities-per-child.spec.ts` (#4694) が担う。本 SS は
 * 「同じ操作で顧客が読む結果表示が、事実と無関係な固定文から実結果ベースに変わった」ことを示す。
 *
 * 使用例 (demo 決定的環境で dev server を起動してから):
 *   MSYS_NO_PATHCONV=1 SS_PHASE=after BASE_URL=http://localhost:5173 \
 *     node scripts/capture.mjs \
 *     --flow copy-result \
 *     --url /admin/activities \
 *     --actions scripts/capture-specs/flows/admin-activities-copy-duplicate-4694.mjs \
 *     --presets desktop --pr 4797
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const PHASE = process.env.SS_PHASE || 'after';
const VIEWPORT = process.env.SS_VIEWPORT || 'desktop';

/** 修正前の固定文言 (件数を持たない)。修正後 build でこれが出たら撮影を失敗させる。 */
const LEGACY_MESSAGE = 'コピーが完了しました';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	const rafSettle = () =>
		page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
				),
		);

	await page.goto(`${BASE_URL}/admin/activities`, { waitUntil: 'domcontentloaded' });

	// hydration gate: 子供タブ / Ark UI menu は client mount 後にしか反応しない。
	const tabs = page.locator('[data-testid^="child-tab-"]');
	await tabs.first().waitFor({ state: 'visible', timeout: 60_000 });
	await page
		.locator('[data-testid="header-add-activity-btn"][data-state]')
		.waitFor({ state: 'visible', timeout: 90_000 });

	// 「最初の子ではない子」をコピー先にする (最初の子 fallback と区別が付く)。
	const tabCount = await tabs.count();
	if (tabCount >= 2) {
		const second = tabs.nth(1);
		for (let attempt = 0; attempt < 20; attempt++) {
			await second.click().catch(() => {});
			if ((await second.getAttribute('aria-selected')) === 'true') break;
			await rafSettle();
		}
		await rafSettle();
	}

	const addBtn = page.getByTestId('header-add-activity-btn');
	const copyItem = page.getByTestId('menu-item-copy');
	const confirm = page.getByTestId('copy-from-child-confirm');
	const message = page.getByTestId('admin-activities-action-message');

	// menu は client mount 後にしか開かない。即時判定で再 click するとトグルで閉じるため
	// waitFor で可視待ちしてから次へ進む (4692 flow と同じ retry 形)。
	for (let attempt = 0; attempt < 10; attempt++) {
		await addBtn.click().catch(() => {});
		const opened = await copyItem
			.waitFor({ state: 'visible', timeout: 3_000 })
			.then(() => true)
			.catch(() => false);
		if (opened) break;
		await rafSettle();
	}
	await copyItem.waitFor({ state: 'visible', timeout: 30_000 });
	await copyItem.click();

	const source = page.locator('[data-testid^="copy-source-"]').first();
	await source.waitFor({ state: 'visible', timeout: 30_000 });
	await source.check();
	await confirm.waitFor({ state: 'visible', timeout: 30_000 });
	await confirm.click();

	// dialog が閉じる = action 完了。閉じない場合 (失敗表示) も進めて結果行を撮る。
	await page
		.getByTestId('copy-from-child-dialog')
		.waitFor({ state: 'hidden', timeout: 30_000 })
		.catch(() => {});
	await message.waitFor({ state: 'visible', timeout: 30_000 });
	await rafSettle();

	const text = (await message.innerText()).trim();

	// 修正後 build なのに旧文言が出ているなら、旧表示を「修正後」として貼ることになる。
	// 握りつぶさず throw して撮影自体を失敗させる (SS 捏造の構造的防止)。
	if (PHASE.startsWith('after') && text.includes(LEGACY_MESSAGE)) {
		throw new Error(`[flow] 修正後 build なのに旧文言が出ている ("${text}")。撮影を中止する。`);
	}
	// demo は write no-op なので、修正後は「デモ」と明示する文でなければならない
	// (件数 0 を実結果として出したら、それは demo 分岐の実装漏れ)。
	if (PHASE.startsWith('after') && !text.includes('デモ')) {
		throw new Error(
			`[flow] 修正後 build なのに demo 明示の文言が出ていない ("${text}")。撮影を中止する。`,
		);
	}
	if (PHASE.startsWith('before') && !text.includes(LEGACY_MESSAGE)) {
		throw new Error(`[flow] 修正前 build のはずが旧文言ではない ("${text}")。撮影を中止する。`);
	}

	await capture(`${PHASE}-copy-result-${VIEWPORT}`);
};
