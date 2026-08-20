/**
 * scripts/capture-specs/flows/ops-plan-breakdown-4505.mjs (#4505)
 *
 * `/ops` の「プラン別内訳」テーブルを撮る。
 *
 *   before … 行を手で並べ、合計 MRR を画面が自前で計算していた形
 *   after  … 行を service が組み立てたプラン集合から描き、合計は service の値をそのまま描く形
 *
 * 行の中身 (プラン 5 行 + 未設定 + 合計) は #4514 の是正で既に揃っているため、
 * 見た目は一致するのが正しい。本 SS は「構造を変えても画面が壊れていない」ことの証跡。
 *
 * AUTH_MODE=cognito (npm run dev:cognito、#1026) の ops アカウントで動作させる。
 *
 * 使用例:
 *   BASE_URL=http://localhost:5174 node scripts/capture.mjs --pr <N> \
 *     --flow ops-plan-breakdown \
 *     --url /ops \
 *     --actions scripts/capture-specs/flows/ops-plan-breakdown-4505.mjs \
 *     --presets desktop,mobile
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

/** cognito-dev のログインフォームを通す (billing-graduation.mjs と同型) */
async function loginAsOps(page) {
	await page.goto(`${BASE_URL}/auth/login`);
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(
		() => document.querySelector('input[name="email"]')?.getAttribute('type') === 'email',
		{ timeout: 15_000 },
	);

	await page.getByLabel('メールアドレス').click();
	await page.keyboard.type('ops@example.com', { delay: 20 });
	await page.getByLabel('パスワード', { exact: true }).click();
	await page.keyboard.type('Gq!Dev#Ops2026xyz', { delay: 20 });

	await page
		.locator('button[type="submit"]:not([disabled])')
		.first()
		.waitFor({ state: 'visible', timeout: 30_000 });
	await page.getByRole('button', { name: 'ログイン', exact: true }).click();
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child)/, { timeout: 30_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await loginAsOps(page);

	await page.goto(`${BASE_URL}/ops`, { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle').catch(() => {});
	// 内訳テーブルの見出しが出るまで待つ (KPI カードだけ描けた状態で撮らない)
	await page.getByRole('columnheader', { name: 'MRR 概算' }).waitFor({
		state: 'visible',
		timeout: 20_000,
	});
	await capture('ops-plan-breakdown');
};
