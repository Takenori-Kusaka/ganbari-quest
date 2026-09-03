/**
 * scripts/capture-specs/flows/subscription-cancel-notice-4525.mjs (#4525 / EPIC #4495)
 *
 * `/admin/subscription/cancel` の notice を実 account でログインして撮る。
 *
 * DEV_USERS の `owner@example.com` は **plan が有料で Stripe subscription を持たない**ため、
 * 本 Issue の矛盾 (badge「スタンダードプラン」の隣で「お支払いは発生しておらず解約のお手続きは
 * 必要ありません」) がそのまま再現する。demo env では課金状態を持てないため
 * `AUTH_MODE=cognito` (`npm run dev:cognito`、#1026) を使う。
 *
 * 対照として `free@example.com` (無料プラン) も撮り、無料の案内が変わっていないことを示す。
 *
 * Before / After は同一 flow を **コードの状態を変えて 2 回**回して撮る (#2059 手順)。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 SS_LABEL_PREFIX=after- BASE_URL=http://localhost:5403 \
 *     node scripts/capture.mjs --flow subscription-cancel-notice-4525 \
 *     --url /admin/subscription/cancel \
 *     --actions scripts/capture-specs/flows/subscription-cancel-notice-4525.mjs \
 *     --presets desktop --out tmp/ss-4525-after
 */

import { devPassword } from '../lib/dev-users.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PREFIX = process.env.SS_LABEL_PREFIX || '';

/** DEV_USERS SSOT: src/lib/server/auth/providers/cognito-dev.ts */
// ローカル (sqlite/auth-repo.ts) の tenant 契約 4 列は settings key `local_tenant_contract` が
// SSOT で、**全 DEV_USERS が同じ行を共有する**。したがって有料アカウントがどの notice を出すかは
// この行の `stripeSubscriptionId` で決まる:
//
//   - subscription なし (既定) → `paidWithoutStripe` = サポート窓口の案内 (#4525 の再現条件)
//   - subscription あり       → `paidPlanNotice`     = 有料プランの解約案内 (#4540 Q4 の対象)
//
// #4540 Q4 の保持期間文を撮るときは、撮影前に契約列へ subscription を入れてから流す:
//   node -e "const D=require('better-sqlite3');const db=new D('data/ganbari-quest.db');
//     db.prepare(\"insert into settings(key,value,updated_at) values('local_tenant_contract',?,datetime('now')) on conflict(key) do update set value=excluded.value\")
//       .run(JSON.stringify({status:'active',plan:'standard_monthly',stripeCustomerId:'cus_dev',stripeSubscriptionId:'sub_dev'}))"
// 撮影後はこの行を削除して既定状態 (#4525 の再現条件) に戻す。
const ACCOUNTS = [
	// 本丸: plan が有料のアカウント。契約列の状態に応じて上記 2 通りの notice を出す
	{ slug: 'paid', email: 'owner@example.com', password: devPassword('owner@example.com') },
	// 対照: 無料プラン (本 PR で変わらないのが正しい)
	{ slug: 'free', email: 'free@example.com', password: devPassword('free@example.com') },
];

/** 描画 frame を n 回待つ。`page.waitForTimeout()` は scripts/ 配下で禁止 (#1208)。 */
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

/** cognito-dev のログインフォームを通す (admin-checklists-ai-gate-4506.mjs と同型) */
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

/** 初回 welcome overlay が被る場合は閉じる */
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
	for (const { slug, email, password } of ACCOUNTS) {
		await logout(page);
		await login(page, email, password);
		await page.goto(`${BASE_URL}/admin/subscription/cancel`);
		await dismissOverlays(page);
		// notice は Alert として最初に描画される。フォームまで出てから撮る。
		await page.getByTestId('cancellation-form').waitFor({ state: 'visible', timeout: 20_000 });
		await waitFrames(page, 2);
		await capture(`${PREFIX}cancel-notice-${slug}`);
	}
};
