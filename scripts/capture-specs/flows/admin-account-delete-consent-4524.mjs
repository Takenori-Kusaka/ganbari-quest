/**
 * scripts/capture-specs/flows/admin-account-delete-consent-4524.mjs (#4524 / EPIC #4495)
 *
 * `/admin/settings/account` の Danger Zone を **プラン別に実 account でログインして**撮る。
 * 同意チェックの文言が猶予 notice と同じ事実を述べているか（= プラン差そのもの）が本 Issue の
 * 主題なので、demo env (`DATA_SOURCE=demo`) では検証にならず `AUTH_MODE=cognito`
 * (`npm run dev:cognito`、#1026) の DEV_USERS を使う。
 *
 * - free (`free@example.com`)         … 猶予 0 日。「元に戻せません」が**正しい**ので維持される
 * - standard (`standard@example.com`) … 猶予 7 日。旧実装はここで notice と矛盾していた（本丸）
 * - family (`family@example.com`)     … 猶予 30 日。同上
 *
 * Before / After は同一 flow を **コードの状態を変えて 2 回**回して撮る (#2059 手順)。
 * label prefix は `SS_LABEL_PREFIX` で与える (`before-` / `after-`)。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 SS_LABEL_PREFIX=after- BASE_URL=http://localhost:5174 \
 *     node scripts/capture.mjs --pr 4595 \
 *     --flow admin-account-delete-consent-4524 \
 *     --url /admin/settings/account \
 *     --actions scripts/capture-specs/flows/admin-account-delete-consent-4524.mjs \
 *     --presets desktop
 */

import { devPassword } from '../lib/dev-users.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PREFIX = process.env.SS_LABEL_PREFIX || '';

/** DEV_USERS SSOT: src/lib/server/auth/providers/cognito-dev.ts */
const ACCOUNTS = [
	{ slug: 'free', email: 'free@example.com', password: devPassword('free@example.com') },
	{
		slug: 'standard',
		email: 'standard@example.com',
		password: devPassword('standard@example.com'),
	},
	{ slug: 'family', email: 'family@example.com', password: devPassword('family@example.com') },
];

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
 * Danger Zone を開き、猶予 notice と同意チェックが同一視界に入る状態にする。
 * 猶予 notice は非同期に解決される (`deletionGraceDays === null` の間は出ない) ため、
 * notice か「猶予を出さない」確定のどちらかに落ち着くまで待つ。
 */
async function openDangerZone(page) {
	await page.goto(`${BASE_URL}/admin/settings/account`);
	await dismissOverlays(page);

	const consent = page.getByTestId('account-danger-agree-checkbox');
	await consent.waitFor({ state: 'visible', timeout: 20_000 });
	// 猶予 notice の解決待ち (owner のみ表示。出ない場合もあるので存在は必須にしない)
	await page
		.getByTestId('account-delete-grace-notice')
		.waitFor({ state: 'visible', timeout: 10_000 })
		.catch(() => {});
	await consent.scrollIntoViewIfNeeded();
	await waitFrames(page, 2);
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	for (const { slug, email, password } of ACCOUNTS) {
		await logout(page);
		await login(page, email, password);
		await openDangerZone(page);
		await capture(`${PREFIX}account-delete-consent-${slug}`);
	}
};
