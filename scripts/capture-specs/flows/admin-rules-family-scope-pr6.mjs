/**
 * scripts/capture-specs/flows/admin-rules-family-scope-pr6.mjs
 *
 * #2362 PR-6: admin/settings/rules family-scope UX SS フロー
 *
 * 撮影 4 状態:
 *   1. default state (empty + family-wide 一覧、per-child タブなし)
 *   2. OverflowMenu (top-right ⋮) open 状態
 *   3. ?import=<presetId> auto-import 完了後 (一覧に追加 + toast 表示)
 *   4. help dialog open 状態
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5180 node scripts/capture.mjs \
 *     --flow admin-rules-family-scope-pr6 \
 *     --url /admin/settings/rules?screenshot=all \
 *     --actions scripts/capture-specs/flows/admin-rules-family-scope-pr6.mjs \
 *     --presets desktop,mobile \
 *     --pr <PR_NUMBER>
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5180';

/** Ark UI Dialog open 完了 polling (data-state + hidden 解除) */
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
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/** Ark UI Menu open 完了 polling: item が DOM に attached されたら open とみなす。
 * Portal 内の Positioner は Headless で display:none のまま残るため、
 * SS 撮影前に <head> へ強制 visibility 用 CSS を注入する。 */
async function waitForMenuOpen(page, itemTestid) {
	await page.waitForSelector(`[data-testid="${itemTestid}"]`, {
		state: 'attached',
		timeout: 15_000,
	});
	// Portal Positioner / Content を !important で visible 化する CSS を 1 度だけ注入
	await page.evaluate(() => {
		if (document.getElementById('capture-menu-force-visible')) return;
		const style = document.createElement('style');
		style.id = 'capture-menu-force-visible';
		style.textContent = `
			[data-part="positioner"][data-scope="menu"],
			[data-part="content"][data-scope="menu"] {
				display: block !important;
				visibility: visible !important;
				opacity: 1 !important;
				pointer-events: auto !important;
			}
		`;
		document.head.appendChild(style);
	});
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/** Trigger click - Ark UI Menu trigger は通常クリックで反応する
 * Headless 環境では pointer event の伝播タイミングで open イベントが取り損ねるケースがあるため、
 * 数度クリックリトライ + force / キーボード操作 fallback を用意する。
 * toast 等が trigger 上に visible で pointer 干渉している場合に備え、retry 過程で force click も試す。 */
async function openOverflowMenu(page, triggerTestid, itemTestid) {
	const trigger = page.getByTestId(triggerTestid);
	await trigger.waitFor({ state: 'visible', timeout: 10_000 });
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await trigger.click({ delay: 30, timeout: 4_000 });
		} catch {
			await trigger.click({ force: true });
		}
		try {
			await page.waitForSelector(`[data-testid="${itemTestid}"]`, {
				state: 'attached',
				timeout: 3_000,
			});
			return;
		} catch {
			// retry
		}
	}
	// Fallback: focus + Enter
	await trigger.focus();
	await page.keyboard.press('Enter');
	await page.waitForSelector(`[data-testid="${itemTestid}"]`, {
		state: 'attached',
		timeout: 5_000,
	});
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
/**
 * Step を try-catch して失敗しても残ステップを継続する wrapper。
 * Ark UI Menu の Portal が headless で安定しないため、step 4 等が失敗しても
 * 既に撮影した step を screenshots branch に push できるようにする。
 */
async function tryStep(label, fn) {
	try {
		await fn();
	} catch (err) {
		console.error(`[WARN] step "${label}" failed: ${err.message}`);
	}
}

export default async (page, capture) => {
	// --- 1) default state: family-wide 一覧 (per-child タブなし) ---
	await page.goto(`${BASE_URL}/admin/settings/rules?screenshot=all`);
	await page.getByTestId('admin-rules-page').waitFor({ state: 'visible', timeout: 15_000 });
	await capture('pr6-admin-rules-default');

	// --- 2) OverflowMenu ⋮ open ---
	await openOverflowMenu(page, 'rules-overflow-menu', 'overflow-menu-item-marketplace');
	await waitForMenuOpen(page, 'overflow-menu-item-marketplace');
	await capture('pr6-admin-rules-overflow-open');

	// menu 閉じる (Escape) — ArkMenu Content の data-state="closed" を待つ
	await page.keyboard.press('Escape');
	await page
		.locator('[data-testid="overflow-menu-item-marketplace"]')
		.waitFor({ state: 'hidden', timeout: 5_000 });

	// --- 3) ?import=<presetId> auto-import: streak-bonus 取込 ---
	await page.goto(`${BASE_URL}/admin/settings/rules?import=streak-bonus&screenshot=all`);
	await page.getByTestId('admin-rules-page').waitFor({ state: 'visible', timeout: 15_000 });
	// auto-import 完了で preset が一覧に追加されるのを待つ
	await page
		.getByTestId('rules-bonus-preset-streak-bonus')
		.waitFor({ state: 'visible', timeout: 30_000 });
	await capture('pr6-admin-rules-after-import');

	// Step 3 で auto-import 成功 toast (role="alert") が visible 状態のまま残り、
	// trigger click を pointer 干渉でブロックするため、消滅または force click で抜ける。
	try {
		await page.waitForSelector('[role="alert"]', { state: 'detached', timeout: 4_000 });
	} catch {
		// toast が timeout 内に消えない場合は force click で進める
	}

	// --- 4) help dialog open ---
	// Ark UI Menu の Portal は headless で安定しないため、複数の click 経路を順次試行する。
	// Step 4 が失敗しても step 1-3 の SS は composite + screenshots branch に残せるよう、
	// tryStep で包んで例外を握りつぶす。
	await tryStep('help dialog', async () => {
		await openOverflowMenu(page, 'rules-overflow-menu', 'overflow-menu-item-help');
		await waitForMenuOpen(page, 'overflow-menu-item-help');
		await page
			.getByTestId('overflow-menu-item-help')
			.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))),
		);
		const helpBox = await page.getByTestId('overflow-menu-item-help').evaluate((el) => {
			const r = el.getBoundingClientRect();
			return {
				x: r.left + r.width / 2,
				y: r.top + r.height / 2,
				width: r.width,
				height: r.height,
			};
		});
		// 座標が画面外の場合、help item を fixed で中央寄せに強制配置する。
		if (helpBox.x < 50 || helpBox.y < 50 || helpBox.width === 0) {
			await page.evaluate(() => {
				const el = document.querySelector('[data-testid="overflow-menu-item-help"]');
				if (el) {
					el.style.position = 'fixed';
					el.style.top = '40%';
					el.style.left = '40%';
					el.style.zIndex = '99999';
					el.style.minWidth = '200px';
					el.style.minHeight = '40px';
					el.style.background = 'white';
					el.style.padding = '8px';
					el.style.border = '1px solid #ccc';
				}
			});
			await page.evaluate(
				() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))),
			);
		}
		const finalBox = await page.getByTestId('overflow-menu-item-help').evaluate((el) => {
			const r = el.getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		});
		await page.mouse.move(finalBox.x, finalBox.y);
		await page.mouse.down();
		await page.mouse.up();
		await waitForDialogOpen(page, 'rules-help-dialog');
		await capture('pr6-admin-rules-help-dialog');
	});
};
