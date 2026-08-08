/**
 * scripts/capture-specs/flows/ops-loyalty-month-key-4269.mjs (#4269 ①)
 *
 * `/ops` の在庫監査カードに「基準不明の継続月キー」の件数行が出ることを撮る。
 * 2 度実行して before / after を作る (`SS_PHASE` で切り替える):
 *
 *   SS_PHASE=before … 本 PR の実装を外した状態 (= 行が無い)
 *   SS_PHASE=after  … 本 PR の状態 (0 件でも「0 件 / 保存済み N 件」と出る)
 *
 * 同一アカウント (`ops@example.com`) / 同一 URL (`/ops`) で撮り分ける。
 * AUTH_MODE=cognito (npm run dev:cognito、#1026) で動作させる。
 *
 * 使用例 (起動済みサーバーに向ける):
 *   SS_PHASE=after BASE_URL=http://localhost:5196 node scripts/capture.mjs --pr <N> \
 *     --flow ops-loyalty-month-key \
 *     --url /ops \
 *     --actions scripts/capture-specs/flows/ops-loyalty-month-key-4269.mjs \
 *     --presets desktop,mobile
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PHASE = process.env.SS_PHASE === 'before' ? 'before' : 'after';
// flow モードは presets の先頭 1 つしか使わないため、viewport ごとに 1 回ずつ実行する。
// 出力名が衝突して上書きされないよう、label に viewport 名を含める。
const VIEW = process.env.SS_VIEW === 'mobile' ? 'mobile' : 'desktop';

/** cognito-dev のログインフォームを通す (ops-mfa-not-required-4363.mjs と同型) */
async function login(page, email, password) {
	await page.goto(`${BASE_URL}/auth/logout`).catch(() => {});
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

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await login(page, 'ops@example.com', 'Gq!Dev#Ops2026xyz');
	await page.goto(`${BASE_URL}/ops`);
	await page.waitForLoadState('domcontentloaded');

	// 契約状態の監査カードまでスクロールしてから撮る (カードは画面下部にある)
	const card = page.getByText('契約状態の監査').first();
	await card.waitFor({ state: 'visible', timeout: 20_000 });
	await card.scrollIntoViewIfNeeded();

	if (PHASE === 'before') {
		// 実装を外した状態: 継続月キーの行は存在しない
		await capture(`before-ops-loyalty-month-key-${VIEW}`);
		return;
	}

	// 本 PR: 0 件でも行が出る (滞留 0 と「見ていない」を区別できるようにする)
	await page.getByTestId('ops-loyalty-month-key').waitFor({ state: 'visible', timeout: 15_000 });
	await capture(`after-ops-loyalty-month-key-${VIEW}`);
};
