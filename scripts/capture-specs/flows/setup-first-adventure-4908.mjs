/**
 * scripts/capture-specs/flows/setup-first-adventure-4908.mjs (#4908)
 *
 * /setup/first-adventure (セットアップ 8/9「はじめてのぼうけん」) の記録演出。
 * AUTH_MODE=local (npm run dev, port 5173) で local tenant に子供 1 人 + 活動セット
 * (elementary-boy pack) を実ウィザード経由で作成したうえで、記録前 / 記録後 (演出) を撮影する。
 *
 * ウィザードを歩く理由: 演出画面は「カードの基礎ポイント」と「記録結果」の突合が本題
 * (#4908 現象 c) のため、DB に直接 INSERT せず実際の setup フロー (children →
 * questionnaire(skip) → packs(import) → rewards(skip) → rules(skip) →
 * activities-defaults(apply) → challenges(auto-add) → first-adventure) を通して
 * 本番と同じ経路で activity を作る。
 *
 * 撮影状態:
 *   1. selecting — 活動選択中 (演出前)
 *   2. celebration — 「しゅくだいをした」を記録した後の祝福画面 (Lv 表示 / AA コントラスト / 内訳)
 *
 * 使用例:
 *   node scripts/capture.mjs --flow setup-first-adventure-4908 \
 *     --url /setup/children \
 *     --actions scripts/capture-specs/flows/setup-first-adventure-4908.mjs \
 *     --base-url http://localhost:5173 \
 *     --presets mobile \
 *     --out tmp/screenshots/pr-4908/
 */

import { waitForStablePage } from '../../lib/ci/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// ----- Step 1: /setup/children — 子供を 1 人登録 (8 歳、実 Issue の persona) -----
	await page.goto(`${BASE_URL}/setup/children`);
	await page.getByLabel('ニックネーム').fill('てすとくん');
	await page.getByLabel('年齢').fill('8');
	await page.getByRole('button', { name: '追加する' }).click();
	// 追加成功後、「次へ」ボタンが現れるまで待つ
	await page.getByRole('button', { name: '次へ' }).waitFor({ state: 'visible', timeout: 15_000 });
	await page.getByRole('button', { name: '次へ' }).click();

	// ----- Step 2: /setup/questionnaire — skip -----
	await page.waitForURL(/\/setup\/questionnaire/, { timeout: 15_000 });
	await page.locator('form[action="?/skip"] button[type="submit"]').click();

	// ----- Step 3: /setup/packs — 年齢 8 に推奨される activity pack を import -----
	await page.waitForURL(/\/setup\/packs/, { timeout: 15_000 });
	// $effect が年齢に合う pack を自動選択するまで待つ (submit ボタンの disabled 解除で判定)
	const packsSubmit = page.locator('form button[type="submit"]:not([formaction])');
	await page.waitForFunction(
		() => {
			const btn = document.querySelector('form button[type="submit"]:not([formaction])');
			return btn && !btn.disabled;
		},
		{ timeout: 15_000 },
	);
	await packsSubmit.click();

	// ----- Step 4: /setup/rewards — skip -----
	await page.waitForURL(/\/setup\/rewards/, { timeout: 15_000 });
	await page.getByText('おすすめセットを自動で追加してすすむ').click();
	await page.getByRole('button', { name: 'スキップして次へ' }).click();

	// ----- Step 5: /setup/rules — skip -----
	await page.waitForURL(/\/setup\/rules/, { timeout: 15_000 });
	await page.getByText('おすすめルールを自動で追加してすすむ').click();
	await page.getByRole('button', { name: 'スキップして次へ' }).click();

	// ----- Step 6: /setup/activities-defaults — 既定を適用してすすむ -----
	await page.waitForURL(/\/setup\/activities-defaults/, { timeout: 15_000 });
	await page.getByTestId('setup-activities-defaults-apply').click();

	// ----- Step 7: /setup/challenges — 推奨 3 件のまま追加してすすむ -----
	await page.waitForURL(/\/setup\/challenges/, { timeout: 15_000 });
	await page.locator('form[action="?/addChallenges"] button[type="submit"]').first().click();

	// ----- Step 8: /setup/first-adventure — 「しゅくだいをした」を選ぶ (記録前) -----
	await page.waitForURL(/\/setup\/first-adventure/, { timeout: 15_000 });
	await page.getByText('しゅくだいをした').first().waitFor({ state: 'visible', timeout: 15_000 });
	await capture('setup-first-adventure-1-selecting');

	await page.getByText('しゅくだいをした').first().click();
	await page.getByRole('button', { name: 'タップしてきろく！' }).click();

	// ----- 記録後: 祝福画面 (points-display + Lv 表示 + 内訳) -----
	await page
		.getByTestId('first-adventure-points-display')
		.waitFor({ state: 'visible', timeout: 15_000 });
	// fadeIn アニメーション (0.3s) の完了を待ってから撮影する
	await waitForStablePage(page, { skipNetworkIdle: true });
	await capture('setup-first-adventure-2-celebration');
};
