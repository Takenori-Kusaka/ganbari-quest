/**
 * scripts/capture-specs/flows/family-member-limit-4500.mjs (#4500)
 *
 * 家族メンバー上限の表記が変わるアプリ側 2 画面を撮影する。
 *   - /pricing            … プラン機能一覧 (plan-features.ts) の「家族メンバー招待」行。
 *                            旧「4人まで」→ 新「3人まで（オーナーを含めご家族4人）」
 *   - /admin/members       … 招待とメンバー一覧。閲覧リンクの有効期限 select を
 *                            MEMBERS_LABELS 参照に変えた箇所を含む (表示文字列は同値)
 *
 * LP 側 (pricing / faq / pamphlet の比較表・カード) は site/*.html の fallback と
 * shared-labels.js を同期済みで、LP SS は capture:lp の系統で撮る。
 *
 * AUTH_MODE=cognito (npm run dev:cognito、#1026) で動作させる。
 *
 * 使用例:
 *   SS_PHASE=after BASE_URL=http://localhost:5185 node scripts/capture.mjs --pr 4577 \
 *     --flow family-member-limit \
 *     --url /admin/subscription \
 *     --actions scripts/capture-specs/flows/family-member-limit-4500.mjs \
 *     --presets desktop
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PHASE = process.env.SS_PHASE === 'before' ? 'before' : 'after';

/** cognito-dev のログインフォームを通す (cancel-vs-deletion-4496.mjs と同型) */
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
	await page.keyboard.type('Gq!Dev#Owner2026x', { delay: 20 });

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

	// 1. プラン機能一覧 (「家族メンバー招待」行の表記)。plan-features.ts の PLAN_FEATURES を
	//    描画するのはアプリ内 /pricing (getPricingFeatures)。/admin/subscription は
	//    現在プランと使用量だけを出すので、この文言は載らない。
	await page.goto(`${BASE_URL}/pricing`, { waitUntil: 'domcontentloaded' });
	await page
		.getByText('家族メンバー招待', { exact: false })
		.first()
		.waitFor({ state: 'visible', timeout: 30_000 })
		.catch(() => {});
	await capture(`${PHASE}-pricing-plan-features`);

	// 2. メンバー画面 (招待 + 閲覧リンクの有効期限 select)
	await page.goto(`${BASE_URL}/admin/members`, { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle').catch(() => {});
	await capture(`${PHASE}-members`);
};
