/**
 * scripts/capture-specs/flows/import-loading-indicator-2632.mjs
 *
 * PR #2632 (CX-DoR #9 NN/G #1 visibility of system status): marketplace 取込
 * ChildSelectionDialog の取込実行中 loading indicator SS。
 *
 * 撮影目的:
 *   Before/After で「取込確定ボタンの実行中 feedback」を視覚的に対比する。
 *   - Before: `?import=<presetId>` で ChildSelectionDialog auto-open した素の状態。
 *     confirm ボタンは「追加」表示 (loading なし = 旧挙動の visible feedback ゼロ起点)。
 *   - After: confirm click 直後の loading 状態。confirm ボタンが spinner + disabled +
 *     「追加しています…」表示になり、cancel も disabled 化する (#2632 NN/G #1 充足)。
 *
 *   loading window は通常ミリ秒で消えるため、`?/importPresetToChildren` POST を
 *   route interception で意図的に遅延させ、loading 状態を保持してから撮影する
 *   (撮影専用の人工遅延、実機挙動は変えない)。demo Lambda では POST が
 *   DEMO_WRITE_ALLOWLIST 外で fail し得るが、loading 表示は POST 発火直後に
 *   client 側 state で出るため、fulfill を遅延させれば確実に捕捉できる。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 AUTH_MODE=anonymous DATA_SOURCE=demo BASE_URL=http://localhost:5267 \
 *     node scripts/capture.mjs \
 *     --flow import-loading-indicator-2632 \
 *     --url /admin/checklists?screenshot=all \
 *     --actions scripts/capture-specs/flows/import-loading-indicator-2632.mjs \
 *     --presets mobile,desktop \
 *     --pr 2632
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5267';

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

	// --- 1) Before: ?import=<presetId> → ChildSelectionDialog auto-open (loading なし) ---
	await page.goto(`${BASE_URL}/admin/checklists?import=event-pool&screenshot=all`);
	await page
		.locator('[data-testid="child-selection-confirm"]')
		.waitFor({ state: 'visible', timeout: 15_000 })
		.catch(() => {});
	await rafSettle();
	await capture('pr2632-before-confirm-idle');

	// --- 2) After: confirm click 直後の loading 状態 ---
	// `?/importPresetToChildren` POST を 8s 遅延させ loading window を保持する
	// (撮影専用、実機挙動は不変)。
	await page.route('**/*importPresetToChildren*', async (route) => {
		await new Promise((r) => setTimeout(r, 8_000));
		// demo 環境想定の最小 ActionResult を返す (loading 解除後の挙動は本 SS 対象外)。
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ type: 'success', status: 200, data: '[{"imported":0}]' }),
		});
	});

	const confirm = page.locator('[data-testid="child-selection-confirm"]');
	await confirm.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
	// click は fulfill 完了 (8s) を待たず即 return させ、loading 中に撮影する。
	await confirm.click({ noWaitAfter: true }).catch(() => {});
	// aria-busy="true" になるまで待ち、loading state を確実に捕捉する。
	await page
		.locator('[data-testid="child-selection-confirm"][aria-busy="true"]')
		.waitFor({ state: 'visible', timeout: 5_000 })
		.catch(() => {});
	await rafSettle();
	await capture('pr2632-after-confirm-loading');
};
