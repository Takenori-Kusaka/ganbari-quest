/**
 * scripts/capture-specs/flows/consent-cross-border-4944.mjs (#4944)
 *
 * 規約改定時の再同意画面 `/consent` を **実 account でログインして**撮る。
 * この画面は `AUTH_MODE=cognito` かつ認証済みかつ「最新版に未同意」のときだけ描画されるため、
 * demo env (`DATA_SOURCE=demo`) では再現できず `npm run dev:cognito` (#1026) の DEV_USERS を使う。
 *
 * 本 Issue の主題は 3 項目めの越境移転同意ブロックの構成（第一層 = 何が起きる / 起きない、
 * 事業者名・国名・条番号は第二層 = privacy.html 第10条）なので、ブロック全体が視界に入る
 * 状態で撮る。
 *
 * Before / After は同一 flow を **コードの状態を変えて 2 回**回して撮る (#2059 手順)。
 * label prefix は `SS_LABEL_PREFIX` で与える (`before-` / `after-`)。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 SS_LABEL_PREFIX=after- BASE_URL=http://localhost:5192 \
 *     node scripts/capture.mjs --pr 4945 \
 *     --flow consent-cross-border-4944 \
 *     --url /consent \
 *     --actions scripts/capture-specs/flows/consent-cross-border-4944.mjs \
 *     --presets desktop,mobile
 */

import { devPassword } from '../lib/dev-users.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PREFIX = process.env.SS_LABEL_PREFIX || '';

/** DEV_USERS SSOT: src/lib/server/auth/providers/cognito-dev.ts */
const ACCOUNT = {
	email: 'owner@example.com',
	password: devPassword('owner@example.com'),
};

/**
 * 描画 frame を n 回待つ。`page.waitForTimeout()` は scripts/ 配下で禁止 (#1208)。
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

/** cognito-dev のログインフォームを通す (admin-account-delete-consent-4524.mjs と同型) */
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
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child|consent)/, { timeout: 30_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await login(page, ACCOUNT.email, ACCOUNT.password);

	await page.goto(`${BASE_URL}/consent`);
	// 越境移転同意ブロックが出ていること自体が撮影の前提。出ないなら
	// 「既に最新版に同意済み」= 撮る対象が無い状態なので、silent に別画面を撮らない。
	const checkbox = page.getByTestId('consent-cross-border-checkbox');
	await checkbox.waitFor({ state: 'visible', timeout: 20_000 });

	// ページ本体は min-h-dvh + 内側 div の overflow-y-auto でスクロールするため、
	// --full-page ではブロック全体が写らない。
	// 停止位置を Before / After で揃えるため、ブロックではなく**ページ末尾の要素**
	// (同意しない場合の logout 導線) を基準にスクロールする。本文量が違っても
	// 両方が「末尾まで送った状態」になり、同じ場所を撮った Before / After になる。
	await page.getByTestId('consent-decline-logout').scrollIntoViewIfNeeded();
	await waitFrames(page, 3);

	await capture(`${PREFIX}consent-cross-border`);

	// 折りたたみを開いた状態も撮る。常時表示を 2 行に抑えた判断 (#4944) の裏返しとして、
	// 「畳んだ結果、全文に到達できなくなっていないか」をレビュアが目視できるようにする。
	// details が無い版 (Before) では対象が無いので撮らない。
	const details = page.locator('details').last();
	if (await details.isVisible().catch(() => false)) {
		await details.locator('summary').click();
		await page.getByTestId('consent-decline-logout').scrollIntoViewIfNeeded();
		await waitFrames(page, 3);
		await capture(`${PREFIX}consent-cross-border-expanded`);
	}
};
