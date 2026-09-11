/**
 * scripts/capture-specs/flows/admin-checklists-delete-confirm-4512.mjs (#4512 / EPIC #4495)
 *
 * `/admin/checklists` のテンプレート削除確認を native `confirm()` から Dialog primitive に
 * 置換したことによる **見た目の変化** を before / after で撮る (#4023 の横展開漏れ解消)。
 *
 * 撮影する 1 コマ (どちらの build でも同じ操作列):
 *   削除ボタン click 直後
 *     - 修正前 (origin/develop, SS_LABEL_PREFIX=before-): native confirm は Playwright が
 *       自動 dismiss するため、画面には確認 UI が何も残らない (= OS ダイアログは撮れない)
 *     - 修正後 (本 PR, SS_LABEL_PREFIX=after-): Dialog primitive の確認が出て操作が止まる
 *
 * 認証は `AUTH_MODE=cognito` (`npm run dev:cognito`、#1026)。login helper は
 * `admin-checklists-ai-gate-4506.mjs` と同型。
 *
 * 使用例 (別 agent が 5174 を使っている場合は自前 server + --base-url を渡す):
 *   MSYS_NO_PATHCONV=1 SS_LABEL_PREFIX=after- BASE_URL=http://localhost:5271 \
 *     node scripts/capture.mjs --pr 4512 \
 *     --flow admin-checklists-delete-confirm-4512 \
 *     --url /admin/checklists \
 *     --actions scripts/capture-specs/flows/admin-checklists-delete-confirm-4512.mjs \
 *     --base-url http://localhost:5271 --no-start-server --presets desktop
 */

import { devPassword } from '../lib/dev-users.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PREFIX = process.env.SS_LABEL_PREFIX || '';

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
	// 修正前 build は native confirm を出す。Playwright は既定で自動 dismiss するが、
	// 明示 handler を置いて「OS ダイアログが出た」ことを検知できるようにする。
	let nativeConfirmSeen = false;
	page.on('dialog', async (d) => {
		nativeConfirmSeen = true;
		await d.dismiss();
	});

	await login(page, 'family@example.com', devPassword('family@example.com'));
	await page.goto(`${BASE_URL}/admin/checklists`);
	await page.getByTestId('admin-checklists-page').waitFor({ state: 'visible', timeout: 20_000 });
	await dismissOverlays(page);

	// hydration gate。修正後 build では確認 Dialog (Ark Portal) の attach が hydration 完了の
	// 直接シグナル。修正前 build には存在しないので待って握りつぶす。
	await page
		.getByTestId('admin-checklists-confirm-dialog')
		.waitFor({ state: 'attached', timeout: 30_000 })
		.catch(() => {});

	// 削除ボタン。修正後 build は data-testid を持つ。修正前 build はテキストで拾う。
	const byTestId = page.locator('[data-testid^="admin-checklist-delete-"]').first();
	const hasTestId = await byTestId
		.waitFor({ state: 'visible', timeout: 5_000 })
		.then(() => true)
		.catch(() => false);
	const target = hasTestId ? byTestId : page.getByRole('button', { name: '削除' }).first();
	await target.waitFor({ state: 'visible', timeout: 15_000 });

	const dialog = page.getByTestId('admin-checklists-confirm-dialog');
	const dialogExists = (await dialog.count()) > 0;

	// 修正後 build なのに確認 Dialog が DOM に無い = hydration 未完了。
	// そのまま撮ると「確認が効いていない画面」を後 SS として貼ってしまうため撮影を中止する。
	if (PREFIX.startsWith('after') && !dialogExists) {
		throw new Error(
			'[flow] 修正後 build なのに確認ダイアログが DOM に無い (hydration 未完了)。撮影を中止する。',
		);
	}

	await target.click();

	if (dialogExists) {
		await dialog.waitFor({ state: 'visible', timeout: 10_000 });
	}
	await waitFrames(page, 2);
	await capture(`${PREFIX}checklists-delete-confirm`);

	if (PREFIX.startsWith('before') && !nativeConfirmSeen) {
		throw new Error(
			'[flow] 修正前 build なのに native confirm が発火していない。撮影対象が違う可能性がある。',
		);
	}
};
