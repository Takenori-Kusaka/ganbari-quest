/**
 * scripts/capture-specs/flows/parent-wording-4716.mjs (#4716)
 *
 * 保護者画面の文言衛生（呼称 / 英語見出し / 生パス / バックアップ用語 / 日付書式）を
 * 変更する PR 用の、画面横断スタンプシート flow。
 *
 * 対象画面が 10 枚あり `--url` の単発撮影を 10 回まわすと BASE_URL / overlay 処理を
 * 毎回書くことになるため、1 flow に畳んで再利用可能にする（使い捨て script 禁止 #1442）。
 *
 * 使用例 (BASE_URL は AUTH_MODE=anonymous DATA_SOURCE=demo で起動した dev server):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5190 node scripts/capture.mjs \
 *     --flow parent-wording-4716 \
 *     --url "/admin?screenshot=all" \
 *     --actions scripts/capture-specs/flows/parent-wording-4716.mjs \
 *     --presets desktop \
 *     --max-steps 20 \
 *     --out <出力先>
 */

import { waitForStablePage } from '../../lib/ci/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/** 撮影対象。label は SS ファイル名になるので Before / After で一致させる。 */
const TARGETS = [
	{ label: 'admin-cheer', path: '/admin/cheer' },
	{ label: 'admin-rewards', path: '/admin/rewards' },
	{ label: 'admin-rewards-requests', path: '/admin/rewards/requests' },
	{ label: 'admin-checklists', path: '/admin/checklists' },
	{ label: 'admin-challenges', path: '/admin/challenges' },
	{ label: 'admin-points', path: '/admin/points' },
	{ label: 'admin-growth-book', path: '/admin/growth-book' },
	{ label: 'admin-settings', path: '/admin/settings' },
	{ label: 'admin-settings-data', path: '/admin/settings/data' },
	{ label: 'admin-settings-account', path: '/admin/settings/account' },
];

/**
 * 画面を覆う modal を閉じる。
 * demo テナントは有料プランのため `PremiumWelcome`（`.welcome-overlay`、Ark UI Dialog ではないので
 * Escape では閉じない）が初回表示され、以降の描画を覆う。
 */
async function closeBlockingOverlays(page) {
	const welcome = page.locator('.welcome-overlay');
	if ((await welcome.count()) > 0) {
		await page
			.locator('.welcome-cta')
			.first()
			.click()
			.catch(() => {});
		await welcome
			.first()
			.waitFor({ state: 'hidden', timeout: 10_000 })
			.catch(() => {});
	}
	const dialog = page.locator('[data-scope="dialog"][data-state="open"]').first();
	if ((await dialog.count()) === 0) return;
	await page.keyboard.press('Escape');
	await dialog.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// 最初の 1 回だけ welcome overlay を閉じる（以降は同一 context なので再表示されない）。
	await page.goto(`${BASE_URL}/admin?screenshot=all`, { waitUntil: 'domcontentloaded' });
	await waitForStablePage(page);
	await closeBlockingOverlays(page);

	for (const target of TARGETS) {
		await page.goto(`${BASE_URL}${target.path}?screenshot=all`, {
			waitUntil: 'domcontentloaded',
		});
		await page
			.locator('main, [role="main"]')
			.first()
			.waitFor({ state: 'visible', timeout: 20_000 });
		// 本文が描画されるまで待つ。`main` の可視化だけでは skeleton / 空 shell の
		// タイミングで撮れてしまい、全白 PNG になる（capture.mjs が検出して落ちる）。
		// 画面ごとに見出しの実装が違うため、要素ではなく「本文が入ったか」で待つ。
		await page.waitForFunction(
			() => {
				const main = document.querySelector('main, [role="main"]');
				return !!main && (main.textContent ?? '').trim().length > 40;
			},
			undefined,
			{ timeout: 20_000 },
		);
		await waitForStablePage(page);
		await closeBlockingOverlays(page);
		await capture(target.label);
	}
};
