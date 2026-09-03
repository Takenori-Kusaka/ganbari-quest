/**
 * scripts/capture-specs/flows/admin-children-birthday-cleared-4729.mjs
 *
 * #4729 (PO 回答 2026-09-03): お子さまの誕生日を消して保存すると、推定誕生日へ「降格」し
 * 誕生日ボーナスの対象から外れる。降格が起きたことを保護者が画面で見られるかを撮る。
 *
 * demo 環境 (`DATA_SOURCE=demo`) は POST を allowlist で塞いでいる (`DEMO_WRITE_ALLOWLIST`) ため
 * 編集を保存できない。cognito dev (`npm run dev:cognito`、#1026) の sqlite backend で撮る。
 *
 * Before / After は同一 flow を **コードの状態を変えて 2 回**回して撮る (#2059 手順)。
 * label prefix は環境変数 `SS_LABEL_PREFIX` で与える (`before-` / `after-`)。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 SS_LABEL_PREFIX=after- BASE_URL=http://localhost:5174 \
 *   node scripts/capture.mjs --pr 4844 \
 *     --flow admin-children-birthday-cleared-4729 --url /admin/children \
 *     --actions scripts/capture-specs/flows/admin-children-birthday-cleared-4729.mjs \
 *     --server-mode cognito --presets desktop --no-start-server
 *
 * 実行ごとに別のお子さまを作る (`CAPTURE_CHILD_NICKNAME`)。同じ tenant の DB を使い回しても
 * before / after が互いの結果を上書きしない。
 */

import { devPassword } from '../lib/dev-users.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PREFIX = process.env.SS_LABEL_PREFIX || '';
const NICKNAME = process.env.CAPTURE_CHILD_NICKNAME ?? `たんじょうび${PREFIX || 'x'}`;

/** 描画 frame を n 回待つ (`waitForTimeout` は scripts/ 配下で禁止、#1208)。 */
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

async function login(page, email, password) {
	await page.goto(`${BASE_URL}/auth/login`);
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 30_000 });
	await page.waitForFunction(
		() => document.querySelector('input[name="email"]')?.getAttribute('type') === 'email',
		{ timeout: 30_000 },
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

/** BirthdayInput (年 / 月 / 日 の NativeSelect 3 本) に値を入れる。月 / 日は前段が入るまで disabled。 */
async function setBirthday(page, scope, { year, month, day }) {
	await scope.getByLabel('生まれた年').selectOption(year);
	await waitFrames(page, 2);
	await scope.getByLabel('生まれた月').selectOption(month);
	await waitFrames(page, 2);
	await scope.getByLabel('生まれた日').selectOption(day);
	await waitFrames(page, 2);
}

/**
 * 誕生日を空にして保存する。
 *
 * **UI の年 / 月 / 日 select からは空に戻せない** — `NativeSelect` の placeholder option は
 * `disabled` で、選び直して空にする経路が無い (本 PR の観察。修正は PO 判断待ちで本 PR の scope 外)。
 * 撮影対象は「誕生日が消えたときに保護者が何を見るか」なので、`BirthdayInput` が出す hidden input
 * (`name="birthDate"`) を空にして **同じ form を同じ action へ送る**。サーバ側の経路 (editChild →
 * 降格 → 告知) は実物そのままで、client 側の入力手段だけを迂回している。
 */
async function submitWithClearedBirthday(editForm) {
	await editForm.locator('input[name="birthDate"]').evaluate((el) => {
		el.value = '';
	});
	await editForm.getByRole('button', { name: /保存/ }).first().click();
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await login(page, 'owner@example.com', devPassword('owner@example.com'));

	// --- 1. 誕生日を入れてお子さまを登録する ---
	await page.goto(`${BASE_URL}/admin/children`);
	await dismissOverlays(page);

	const addToggle = page.locator('[data-tutorial="add-child-btn"]');
	await addToggle.waitFor({ state: 'visible', timeout: 30_000 });

	const nickname = page.locator('#add-nickname');
	for (let attempt = 0; attempt < 5; attempt++) {
		await addToggle.click();
		const opened = await nickname
			.waitFor({ state: 'visible', timeout: 3_000 })
			.then(() => true)
			.catch(() => false);
		if (opened) break;
	}
	await nickname.waitFor({ state: 'visible', timeout: 30_000 });
	await nickname.fill(NICKNAME);
	await setBirthday(page, page.locator('form').filter({ has: nickname }), {
		year: '2018',
		month: '5',
		day: '1',
	});
	await page.getByRole('button', { name: '追加する' }).click();

	const addedCard = page.getByText(NICKNAME, { exact: true }).first();
	await addedCard.waitFor({ state: 'visible', timeout: 30_000 });

	// --- 2. そのお子さまを選んで編集モードに入り、誕生日を空にして保存する ---
	await addedCard.click();
	const editButton = page.getByRole('button', { name: /編集/ }).first();
	await editButton.waitFor({ state: 'visible', timeout: 30_000 });
	await editButton.click();

	const editForm = page.locator('.profile-edit__form');
	await editForm.waitFor({ state: 'visible', timeout: 30_000 });
	await submitWithClearedBirthday(editForm);

	// --- 3. 保存結果 (降格の告知が出るか) を撮る ---
	await page
		.locator('[data-tutorial="child-detail"]')
		.waitFor({ state: 'visible', timeout: 30_000 });
	await waitFrames(page, 3);
	await page
		.locator('[data-tutorial="child-detail"]')
		.scrollIntoViewIfNeeded({ timeout: 10_000 })
		.catch(() => {});
	await waitFrames(page, 2);
	await capture(`${PREFIX}children-birthday-cleared`);
};
