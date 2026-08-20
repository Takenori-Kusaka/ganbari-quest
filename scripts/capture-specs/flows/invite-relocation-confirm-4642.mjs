/**
 * scripts/capture-specs/flows/invite-relocation-confirm-4642.mjs
 *
 * PR #4794 (Issue #4642): 引っ越し合流の確認画面。
 *
 * 撮影目的:
 *   PO 差し戻し (Q2) で足した「退会と同じ確認語の入力」が画面に出ていること、および
 *   同意チェックだけでは実行ボタンが押せないことを視覚的に提示する。
 *
 *   注: この画面は「Cognito ユーザー + 自分ひとりの家族グループの owner + 有効な招待」が
 *   同時に揃ったときだけ出る。招待 / メンバーは local backend では原理的に起動できない
 *   (#3732) ため、component 層 SSOT である Storybook story
 *   (Auth/InviteRelocationConfirmCard) で提示する。挙動の機械検証は
 *   `tests/unit/routes/auth-invite-relocation.test.ts` (サーバー側の 2 条件検証) と
 *   `tests/unit/architecture/irreversible-deletion-confirm-parity.test.ts` (退会との重さ揃え) が担う。
 *
 * 使用例 (Storybook を別途 `npm run storybook` で 6006 起動した状態で):
 *   BASE_URL=http://localhost:6006 node scripts/capture.mjs \
 *     --flow invite-relocation-confirm-4642 \
 *     --url /iframe.html?id=auth-inviterelocationconfirmcard--default&viewMode=story \
 *     --actions scripts/capture-specs/flows/invite-relocation-confirm-4642.mjs \
 *     --presets mobile,desktop --no-start-server --pr 4794
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:6006';
const STORY_URL = `${BASE_URL}/iframe.html?id=auth-inviterelocationconfirmcard--default&viewMode=story`;
/** SS_PHASE=before で撮ると before-*.png、既定は after-*.png (#2063 の Before/After ペア規約)。 */
const PHASE = process.env.SS_PHASE || 'after';

/** 描画の落ち着きを 2 フレーム待ちで取る (#1208: scripts/ で waitForTimeout 禁止)。 */
async function settle(page) {
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// --- 1) 初期状態: 同意チェックも確認語も未入力 → 実行ボタンは押せない ---
	await page.goto(STORY_URL);
	await page.locator('[data-testid="relocation-confirm"]').waitFor({ state: 'visible', timeout: 15_000 });
	await settle(page);
	await capture(`${PHASE}-relocation-confirm-initial`);

	// --- 2) 同意チェックだけ入れた状態 ---
	// 修正前はこれで実行できた。修正後は確認語が空なのでまだ押せない。
	await page.locator('[data-testid="relocation-acknowledge"]').check();
	await settle(page);
	await capture(`${PHASE}-relocation-confirm-acknowledged`);

	// --- 3) 確認語まで入れた状態 (修正後のみ入力欄が存在する) ---
	const confirmInput = page.locator('[data-testid="relocation-confirm-input"] input');
	if ((await confirmInput.count()) > 0) {
		await confirmInput.fill('アカウントを削除します');
		await settle(page);
		await capture(`${PHASE}-relocation-confirm-typed`);
	}
};
