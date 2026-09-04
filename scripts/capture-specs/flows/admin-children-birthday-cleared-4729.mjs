/**
 * scripts/capture-specs/flows/admin-children-birthday-cleared-4729.mjs
 *
 * #4729 (PO 決定 2026-09-04): 保護者はお子さまの誕生日を消せる。保存すると入力された誕生日は破棄され、
 * その年齢の推定誕生日 (1/1) に置き換わって誕生日ボーナスの対象から外れる (取り消す操作は無い)。
 * だから **確認 → 保存 → 告知** の 3 点セットを撮る。
 *
 * demo 環境 (`DATA_SOURCE=demo`) は POST を allowlist で塞いでいる (`DEMO_WRITE_ALLOWLIST`) ため
 * 編集を保存できない。cognito dev (`npm run dev:cognito`、#1026) の sqlite backend で撮る。
 *
 * Before / After は同一 flow を **コードの状態を変えて 2 回**回して撮る (#2059 手順)。
 * label prefix は環境変数 `SS_LABEL_PREFIX` で与える (`before-` / `after-`)。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 SS_LABEL_PREFIX=after- BASE_URL=http://localhost:5174 \
 *   node scripts/capture.mjs --pr 4849 \
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
 * 誕生日を「未設定」に戻す — **保護者と同じ操作で**行う。
 *
 * `selectOption('')` は disabled option でも DOM を直接書き換えてしまい before / after の差が
 * 出ない (= 修正の有無を SS で見分けられない) ため使わない。年の select にフォーカスして `Home`
 * を押す = ブラウザのネイティブ挙動で「先頭の**選択可能な**option」へ動く。
 * placeholder が disabled のままなら先頭の年 (最新年) に動くだけで空にはならず、
 * 選択可能になっていれば「未設定」に入る。**この差がそのまま SS の差**になる。
 */
async function clearBirthdayLikeAParent(page, editForm) {
	const yearSelect = editForm.getByLabel('生まれた年');
	await yearSelect.focus();
	await page.keyboard.press('Home');
	await waitFrames(page, 3);
	const hidden = await editForm.locator('input[name="birthDate"]').inputValue();
	console.log(`[flow] 誕生日欄の値 = ${JSON.stringify(hidden)} (空なら未設定に戻せている)`);
	return hidden === '';
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

	// --- 2. そのお子さまを選んで編集モードに入り、誕生日を未設定に戻す ---
	await addedCard.click();
	const editButton = page.getByRole('button', { name: /編集/ }).first();
	await editButton.waitFor({ state: 'visible', timeout: 30_000 });
	await editButton.click();

	const editForm = page.locator('.profile-edit__form');
	await editForm.waitFor({ state: 'visible', timeout: 30_000 });
	await clearBirthdayLikeAParent(page, editForm);
	await capture(`${PREFIX}children-birthday-edit`);

	// --- 3. 保存 → 確認ダイアログ (修正前は出ずにそのまま保存される) ---
	await editForm.getByRole('button', { name: /保存/ }).first().click();
	const confirmDialog = page.locator('[data-testid="child-birthday-clear-confirm-dialog"]');
	const confirmShown = await confirmDialog
		.waitFor({ state: 'visible', timeout: 5_000 })
		.then(() => true)
		.catch(() => false);
	console.log(`[flow] 確認ダイアログ = ${confirmShown ? '出た' : '出ない'}`);
	await waitFrames(page, 2);
	await capture(`${PREFIX}children-birthday-clear-confirm`);

	if (confirmShown) {
		await page.locator('[data-testid="child-birthday-clear-accept"]').click();
		await confirmDialog.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
	}

	// --- 4. 保存結果 (消えたことの告知 + 「誕生日: 未設定」) を撮る ---
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
