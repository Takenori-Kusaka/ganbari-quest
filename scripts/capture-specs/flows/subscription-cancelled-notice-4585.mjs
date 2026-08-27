/**
 * scripts/capture-specs/flows/subscription-cancelled-notice-4585.mjs (#4585-4)
 *
 * 契約終了 (S5 = `CONTRACT_STATE.CANCELLED`) の告知を撮影する。
 * **支払い失敗 (dunning) で契約が消えた顧客が着く唯一の画面**であり、解約画面
 * (`/admin/subscription/cancel`) を一度も通らないため、アーカイブの扱いをここで述べる。
 *
 * AUTH_MODE=cognito (#1026) で動かす。契約 4 列は sqlite auth-repo が `settings` の
 * `local_tenant_contract` に持つ (#4156) ため、S5 の再現は撮影前に 1 行 seed する:
 *
 *   node -e "const D=require('better-sqlite3');const db=new D('data/ganbari-quest.db');
 *     db.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
 *       .run('local_tenant_contract', JSON.stringify({status:'suspended',plan:'standard',stripeCustomerId:'cus_local_4585',stripeSubscriptionId:null}), new Date().toISOString());"
 *
 * (`status='suspended'` かつ `stripeSubscriptionId` 無し = S5。契約が残っていれば S4。
 *  判定は `resolveContractState()` = contract-state-view.ts。)
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 node scripts/capture.mjs --pr 4648 \
 *     --flow subscription-cancelled-notice \
 *     --url /admin/subscription \
 *     --actions scripts/capture-specs/flows/subscription-cancelled-notice-4585.mjs \
 *     --server-mode cognito --presets desktop
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

/** cognito-dev のログインフォームを通す (cancel-period-end-3991.mjs と同型) */
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
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await loginAsOwner(page);

	await page.goto(`${BASE_URL}/admin/subscription`);
	await page.waitForLoadState('domcontentloaded');
	await dismissOverlays(page);
	await page.getByTestId('saas-license-panel').waitFor({ state: 'visible', timeout: 15_000 });
	// 契約終了の告知が出るまで待つ (S5 seed が効いていなければここで失敗する)
	await page.getByText('解約が完了しました').first().waitFor({ state: 'visible', timeout: 20_000 });
	await capture('subscription-cancelled-notice');
};
