/**
 * scripts/capture-specs/flows/consent-cross-border-4497.mjs (#4497)
 *
 * 再同意画面 `/consent` を撮る。本 PR の視覚的な変更はすべてこの画面にある:
 *
 *   - 越境移転同意 (個人情報保護法 §28) セクションの新設
 *     — Google OAuth 経由の登録は signup フォームを通らないため、この画面が唯一の取得点
 *   - 「前回同意 → 最新」表示の文書ごとの個別化
 *     — 旧実装は利用規約の version 固定で、privacy だけを改定すると
 *       「2026-04-28 → 2026-04-28」という矛盾表示になっていた
 *   - 「同意せずログアウト」の出口
 *     — `/auth/logout` は実在するが画面から到達できなかった
 *
 * before / after は同一 URL・同一アカウントで、ブランチを切り替えて 2 回撮る:
 *   before … origin/develop を checkout した状態
 *   after  … 本 PR (fix/4497-consent-cross-border-privacy-version)
 *
 * AUTH_MODE=cognito (npm run dev:cognito、#1026) で動作させる。
 * ローカルの sqlite auth-repo は consent を stub 実装 (findLatestConsent が常に undefined) しており、
 * `checkConsent` が「未同意」を返すため、この画面が素直に描画される。
 *
 * 使用例 (起動済みサーバーに向ける):
 *   SS_PHASE=after BASE_URL=http://localhost:5174 node scripts/capture.mjs --pr 4516 \
 *     --flow consent-cross-border \
 *     --url /consent \
 *     --actions scripts/capture-specs/flows/consent-cross-border-4497.mjs \
 *     --presets desktop,mobile
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PHASE = process.env.SS_PHASE === 'before' ? 'before' : 'after';

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
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child|consent)/, { timeout: 30_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await login(page, 'owner@example.com', 'Gq!Dev#Owner2026x');

	await page.goto(`${BASE_URL}/consent`);
	await page.waitForLoadState('domcontentloaded');
	await page.getByTestId('consent-page').waitFor({ state: 'visible', timeout: 30_000 });

	// 初期状態 (全項目 未チェック = 同意ボタンが押せない)
	await capture(`${PHASE}-consent-initial`);

	// 表示されているチェックボックスを全て入れた状態 (同意ボタンが押せる)
	for (const testid of [
		'consent-terms-checkbox',
		'consent-privacy-checkbox',
		'consent-cross-border-checkbox',
	]) {
		const box = page.getByTestId(testid);
		// before ブランチには越境移転セクションが無いので、在るものだけ入れる
		if ((await box.count()) > 0) {
			await box.check();
		}
	}
	await capture(`${PHASE}-consent-checked`);
};
