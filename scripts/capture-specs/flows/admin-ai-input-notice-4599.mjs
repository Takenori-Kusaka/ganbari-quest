/**
 * scripts/capture-specs/flows/admin-ai-input-notice-4599.mjs (#4599 / EPIC #4495)
 *
 * 生成 AI に送信される 4 経路 (AI 提案 活動 / チェックリスト / ごほうび + 領収書 OCR) の
 * 入力欄に注意書きが出ることを撮る。AI 提案は有料プラン限定のため demo env では検証にならず、
 * `AUTH_MODE=cognito` (`npm run dev:cognito`、#1026) の DEV_USERS (family) を使う。
 *
 * Before / After は同一 flow を **コードの状態を変えて 2 回**回して撮る (#2059 手順)。
 * label prefix は環境変数 `SS_LABEL_PREFIX` で与える (`before-` / `after-`)。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 SS_LABEL_PREFIX=after- node scripts/capture.mjs --pr 4599 \
 *     --flow admin-ai-input-notice-4599 \
 *     --url /admin/activities \
 *     --actions scripts/capture-specs/flows/admin-ai-input-notice-4599.mjs \
 *     --server-mode cognito --presets desktop
 *
 * helper (login / waitFrames / waitForMenuOpen) は admin-checklists-ai-gate-4506.mjs と同型。
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PREFIX = process.env.SS_LABEL_PREFIX || '';

/** 描画 frame を n 回待つ (`waitForTimeout` は scripts/ 配下で禁止、#1208)。 */
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

/** Ark UI Menu の hydration 完了 + open 状態確立を待つ (#4506 flow と同型)。 */
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
	const isOpen = async () => (await btn.getAttribute('aria-expanded')) === 'true';
	for (let attempt = 1; attempt <= 3 && !(await isOpen()); attempt++) {
		const box = await btn.boundingBox();
		if (!box) throw new Error(`${triggerTestId} の boundingBox が取れません`);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
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
		if (!(await isOpen())) await waitFrames(page, 2);
	}
	if (!(await isOpen())) {
		throw new Error(`${triggerTestId} が 3 回の pointer 操作で開きませんでした`);
	}
	await waitFrames(page);
}

/** 「+ 追加 → AI で提案」で AI 提案ダイアログを開く */
async function openAiDialog(page, { path, pageTestid, addMenuTestid, dialogTestid }) {
	await page.goto(`${BASE_URL}${path}`);
	await page.getByTestId(pageTestid).waitFor({ state: 'visible', timeout: 20_000 });
	await dismissOverlays(page);
	await waitForMenuOpen(page, addMenuTestid);
	const ai = page.getByTestId('menu-item-ai');
	await ai.waitFor({ state: 'visible', timeout: 10_000 });
	await ai.click();
	await page.getByTestId(dialogTestid).waitFor({ state: 'visible', timeout: 10_000 });
	await waitFrames(page);
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// 領収書 OCR はポイント残高を持つお子さまが要る。cognito dev の DEV_USERS には残高データが
	// 無く convert form 自体が描画されないため、この経路だけ demo 環境
	// (`AUTH_MODE=anonymous DATA_SOURCE=demo`、ADR-0048) で撮る。
	// SS_FLOW_SCOPE=ai (既定、cognito) / receipt (demo) で切り替える。
	const scope = process.env.SS_FLOW_SCOPE || 'ai';

	if (scope === 'receipt') {
		await page.goto(`${BASE_URL}/admin/points`);
		await dismissOverlays(page);
		const receiptTab = page.getByRole('button', { name: '領収書', exact: true });
		await receiptTab.waitFor({ state: 'visible', timeout: 20_000 });
		await receiptTab.click();
		await waitFrames(page, 2);
		// 変換フォームは残高カードの下にあり viewport 外なので、撮影前に見える位置まで送る。
		// アンカーは注意書き自身ではなく **Before / After 双方に存在する** 見出しにする
		// (注意書きを基準にすると before 側で要素が無く scroll が no-op になり、
		//  領収書 UI が写らない画像で「変化なし」に見えてしまう)。
		await page
			.getByText('領収書を撮影して金額を読み取り')
			.scrollIntoViewIfNeeded({ timeout: 10_000 });
		await waitFrames(page, 2);
		await capture(`${PREFIX}ai-notice-receipt`);
		return;
	}

	await login(page, 'family@example.com', 'Gq!Dev#Fam2026xyz');

	// --- 経路 1: AI 提案 (活動) ---
	await openAiDialog(page, {
		path: '/admin/activities',
		pageTestid: 'admin-activities-page',
		addMenuTestid: 'header-add-activity-btn',
		dialogTestid: 'add-activity-dialog',
	});
	await capture(`${PREFIX}ai-notice-activities`);

	// --- 経路 2: AI 提案 (チェックリスト) ---
	await openAiDialog(page, {
		path: '/admin/checklists',
		pageTestid: 'admin-checklists-page',
		addMenuTestid: 'checklists-add-menu',
		dialogTestid: 'checklists-ai-dialog',
	});
	await capture(`${PREFIX}ai-notice-checklists`);

	// --- 経路 3: AI 提案 (ごほうび) ---
	await openAiDialog(page, {
		path: '/admin/rewards',
		pageTestid: 'admin-rewards-search',
		addMenuTestid: 'rewards-add-menu',
		dialogTestid: 'rewards-add-dialog',
	});
	await capture(`${PREFIX}ai-notice-rewards`);
};
