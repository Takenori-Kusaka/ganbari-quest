/**
 * scripts/capture-specs/flows/admin-checklists-ai-gate-4506.mjs (#4506 / EPIC #4495)
 *
 * `/admin/checklists` の AI 提案ダイアログのプランゲート表示を、**実プランの account でログインして**
 * 撮影する。プラン別の表示差そのものが本 Issue の主題なので、demo env (`DATA_SOURCE=demo`) では
 * 検証にならず、`AUTH_MODE=cognito` (`npm run dev:cognito`、#1026) の DEV_USERS を使う。
 *
 * - premium (`family@example.com`)  … 修正後はロック無しで入力できる（#4506 本丸）
 * - standard (`standard@example.com`) … ロック + アップグレード CTA（本 PR で変更なしの対照）
 *
 * Before / After は同一 flow を **コードの状態を変えて 2 回**回して撮る (#2059 手順)。
 * label prefix は環境変数 `SS_LABEL_PREFIX` で与える (`before-` / `after-`)。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 SS_LABEL_PREFIX=after- node scripts/capture.mjs --pr 4523 \
 *     --flow admin-checklists-ai-gate-4506 \
 *     --url /admin/checklists \
 *     --actions scripts/capture-specs/flows/admin-checklists-ai-gate-4506.mjs \
 *     --server-mode cognito --presets desktop
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PREFIX = process.env.SS_LABEL_PREFIX || '';

/**
 * 描画 frame を n 回待つ。
 *
 * `page.waitForTimeout()` は scripts/ 配下で禁止 (#1208 — 任意の sleep は flaky の温床)。
 * ここで必要なのは「ブラウザに 1 度描画させる」ことなので、rAF 2 回 = 1 frame 完了を待つ。
 */
async function waitFrames(page, frames = 1) {
	for (let i = 0; i < frames; i++) {
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
				),
		);
	}
}

/** cognito-dev のログインフォームを通す (cancel-period-end-3991.mjs と同型) */
async function login(page, email, password) {
	await page.goto(`${BASE_URL}/auth/login`);
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(
		() => document.querySelector('input[name="email"]')?.getAttribute('type') === 'email',
		{ timeout: 15_000 },
	);

	await page.getByLabel('メールアドレス').click();
	await page.keyboard.type(email, { delay: 20 });
	await page.getByLabel('パスワード', { exact: true }).click();
	await page.keyboard.type(password, { delay: 20 });

	await page
		.locator('button[type="submit"]:not([disabled])')
		.first()
		.waitFor({ state: 'visible', timeout: 30_000 });
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child)/, { timeout: 30_000 });
}

async function logout(page) {
	await page.goto(`${BASE_URL}/auth/logout`).catch(() => {});
	await page.context().clearCookies();
}

/** 初回 welcome overlay / ページガイドが被る場合は閉じる */
async function dismissOverlays(page) {
	const welcome = page.locator('.welcome-overlay');
	if (await welcome.isVisible({ timeout: 1500 }).catch(() => false)) {
		await welcome
			.locator('.welcome-cta')
			.click()
			.catch(() => {});
		await welcome.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
	}
}

/**
 * Ark UI Menu の hydration 完了 + open 状態確立を待つ。
 *
 * `admin-checklists-add-ux-2903.mjs` の helper は「`aria-expanded` が `'false'` である」ことを
 * hydration 完了の指標にしているが、SSR 直後の未 hydration な trigger も `'false'` を持つため
 * **hydration 前に click してメニューが開かない**（cognito 実データ経路で実測。click は
 * `element is not enabled` で 30s リトライし続ける）。trigger が **enabled になること**を待つ。
 */
async function waitForMenuOpen(page, triggerTestId) {
	const btn = page.getByTestId(triggerTestId);
	await btn.waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(
		(testid) => {
			const el = document.querySelector(`[data-testid="${testid}"]`);
			return !!el && !el.disabled;
		},
		triggerTestId,
		{ timeout: 30_000 },
	);
	await page.waitForFunction(
		(testid) =>
			document.querySelector(`[data-testid="${testid}"]`)?.getAttribute('aria-expanded') ===
			'false',
		triggerTestId,
		{ timeout: 10_000 },
	);
	// `locator.click()` / `press('Enter')` では **開かない** (実測)。Ark UI Menu の trigger は
	// pointerdown / pointerup の間隔を要求するため、明示的な mouse down → 待機 → up で開く。
	// hydration 直後は 1 回目の pointer 列を取りこぼすことがあるため 3 回まで再試行する。
	const isOpen = async () => (await btn.getAttribute('aria-expanded')) === 'true';
	for (let attempt = 1; attempt <= 3 && !(await isOpen()); attempt++) {
		const box = await btn.boundingBox();
		if (!box) throw new Error(`${triggerTestId} の boundingBox が取れません`);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		// pointerdown → pointerup を同一 frame に詰めると Ark UI が open を取りこぼす。1 frame 挟む。
		await waitFrames(page, 2);
		await page.mouse.up();
		await page
			.waitForFunction(
				(testid) =>
					document.querySelector(`[data-testid="${testid}"]`)?.getAttribute('aria-expanded') ===
					'true',
				triggerTestId,
				{ timeout: 5_000 },
			)
			.catch(() => {});
		// 再試行前に 1 frame 空ける (hydration 直後の再入を避ける)
		if (!(await isOpen())) await waitFrames(page, 2);
	}
	if (!(await isOpen())) {
		throw new Error(`${triggerTestId} が 3 回の pointer 操作で開きませんでした`);
	}
	await waitFrames(page);
}

/** `/admin/checklists` を開き「+ 追加 → AI で提案」で AI 提案ダイアログを開いた状態にする */
async function openAiDialog(page) {
	await page.goto(`${BASE_URL}/admin/checklists`);
	await page.getByTestId('admin-checklists-page').waitFor({ state: 'visible', timeout: 20_000 });
	await dismissOverlays(page);
	await waitForMenuOpen(page, 'checklists-add-menu');
	const ai = page.getByTestId('menu-item-ai');
	await ai.waitFor({ state: 'visible', timeout: 10_000 });
	await ai.click();
	await page.getByTestId('checklists-ai-dialog').waitFor({ state: 'visible', timeout: 10_000 });
	await waitFrames(page);
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- premium (family) : #4506 本丸。修正後はロック無しで入力可能 ---
	await login(page, 'family@example.com', 'Gq!Dev#Fam2026xyz');
	await openAiDialog(page);
	await capture(`${PREFIX}checklists-ai-premium`);
	await logout(page);

	// --- standard : 本 PR で変更なしの対照 (ロック + アップグレード CTA が正しい状態) ---
	// **before 側では撮らない**。standard の表示は本 PR で不変なので before / after を撮ると
	// 1 byte 違わない画像ペアになり、capture の sha256 同一ガード (#2059) が正しく exit 1 する。
	// 「変わらないこと」は 1 枚 (after) + マトリクス test で示す。
	if (PREFIX !== 'before-') {
		await logout(page);
		await login(page, 'standard@example.com', 'Gq!Dev#Std2026xyz');
		await openAiDialog(page);
		await capture(`${PREFIX}checklists-ai-standard-unchanged`);
	}
};
