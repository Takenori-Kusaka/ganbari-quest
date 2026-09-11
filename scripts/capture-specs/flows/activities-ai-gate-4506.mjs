/**
 * scripts/capture-specs/flows/activities-ai-gate-4506.mjs (#4506)
 *
 * `/admin/activities` の「+ 追加 → AI で提案」ダイアログを撮る。
 *
 *   before … スタンダード加入者にも AI 提案パネルが**解放状態**で出る (押すと 403)
 *   after  … プレミアム限定のロック表示 + アップグレード CTA になる
 *
 * `dev:cognito` の owner@example.com は **スタンダード**なので、この環境で
 * 「誤って解放されていた側 → ロック」の変化がそのまま撮れる。
 *
 * AUTH_MODE=cognito (npm run dev:cognito、#1026) で動作させる。
 *
 * 使用例:
 *   SS_PHASE=after BASE_URL=http://localhost:5393 node scripts/capture.mjs --pr <N> \
 *     --flow activities-ai-gate \
 *     --url /admin/activities \
 *     --actions scripts/capture-specs/flows/activities-ai-gate-4506.mjs \
 *     --presets desktop
 */

import { devPassword } from '../lib/dev-users.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PHASE = process.env.SS_PHASE === 'before' ? 'before' : 'after';

/** cognito-dev のログインフォームを通す (cheer-free-text-gate-4504.mjs と同型) */
async function loginAsOwner(page) {
	await page.goto(`${BASE_URL}/auth/login`);
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(
		() => document.querySelector('input[name="email"]')?.getAttribute('type') === 'email',
		{ timeout: 15_000 },
	);

	await page.getByLabel('メールアドレス').click();
	await page.keyboard.type('owner@example.com', { delay: 20 });
	await page.getByLabel('パスワード', { exact: true }).click();
	await page.keyboard.type(devPassword('owner@example.com'), { delay: 20 });

	await page
		.locator('button[type="submit"]:not([disabled])')
		.first()
		.waitFor({ state: 'visible', timeout: 30_000 });
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child)/, { timeout: 30_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await loginAsOwner(page);

	await page.waitForLoadState('networkidle').catch(() => {});
	await page.goto(`${BASE_URL}/admin/activities`, { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle').catch(() => {});

	// header の「+ 追加」dropdown → 「AI で提案」(#2998 の正準構成)
	await page
		.getByRole('button', { name: /追加/ })
		.first()
		.click()
		.catch(() => {});
	const aiItem = page.getByRole('menuitem', { name: /AI/ }).first();
	await aiItem.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
	await aiItem.click().catch(() => {});

	await page
		.getByTestId('add-activity-dialog')
		.waitFor({ state: 'visible', timeout: 20_000 })
		.catch(() => {});
	// パネル本体が描画されるまで待つ (dialog の枠だけ出た瞬間に撮ると全白になる)
	await page
		.getByTestId('ai-suggest-panel')
		.waitFor({ state: 'visible', timeout: 20_000 })
		.catch(() => {});
	await capture(`${PHASE}-activities-ai-dialog`);
};
