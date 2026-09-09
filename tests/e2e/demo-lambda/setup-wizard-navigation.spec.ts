// tests/e2e/demo-lambda/setup-wizard-navigation.spec.ts
//
// セットアップウィザードの**戻る / 出口が実際に描画されている**ことを実ブラウザで見る
// (#4863 / PO 決裁 2026-09-09)。
//
// なぜ demo 環境で見られるのか (adversarial 実測): `src/hooks.server.ts` の setup gate は
// `authMode === 'local'` の内側にしかない。demo (`AUTH_MODE=anonymous` + `DATA_SOURCE=demo`)
// では gate が走らないので、**`/setup/*` の 9 画面はすべて 200 で返る**。
// 「demo では原理的に描画できない」は誤りだった。
//
// なぜ unit の fitness test では足りないか:
// `tests/unit/architecture/setup-wizard-back-links-4863.test.ts` は markup を正規表現で
// 読むだけで、**描画は見ていない**。実測で、戻るリンクを `{#if false}` で包んでも
// HTML コメントで囲って消しても 12/12 緑のまま通る。行き先のずれ (packs が step 2 を
// 飛ばしていた元の欠陥) には効くが、リンクが消えたことには効かない。ここで描画を見る。
//
// 固定する不変条件:
//   [N1] step 2〜8 に**共通の出口**が描画されている (7 回スキップを押させない)
//   [N2] step 1 (children) と step 9 (complete) には出口を出さない
//   [N3] 各 step の「戻る」が描画され、行き先が step 連鎖の 1 つ前である

import { expect, test } from '@playwright/test';

/** 実装の遷移順 (各 +page.server.ts の redirect 先を辿ったもの)。 */
const STEPS = [
	'/setup/children',
	'/setup/questionnaire',
	'/setup/packs',
	'/setup/rewards',
	'/setup/rules',
	'/setup/activities-defaults',
	'/setup/challenges',
	'/setup/first-adventure',
	'/setup/complete',
] as const;

/** 共通の出口を出す step (step 1 は出口が実在せず、step 9 は既に導線がある)。 */
const WITH_EXIT = STEPS.slice(1, 8);

test.describe('#4863 セットアップウィザードのナビゲーション (demo 環境で描画を見る)', () => {
	for (const path of WITH_EXIT) {
		test(`[N1] ${path} に共通の出口が描画される`, async ({ page }) => {
			const res = await page.goto(path);
			expect(res?.status(), `${path} が 200 で返らない`).toBeLessThan(400);
			await expect(
				page.getByTestId('setup-leave-wizard'),
				'「あとでやる」が描画されていない。戻された親が 7 回スキップを押すことになる',
			).toBeVisible();
		});
	}

	test('[N2] step 1 と step 9 には共通の出口を出さない', async ({ page }) => {
		for (const path of ['/setup/children', '/setup/complete']) {
			await page.goto(path);
			await expect(
				page.getByTestId('setup-leave-wizard'),
				`${path} に出口を出している (children は出口が実在せず、complete は既に導線がある)`,
			).toHaveCount(0);
		}
	});

	for (let i = 1; i < 8; i++) {
		const path = STEPS[i] as string;
		const prev = STEPS[i - 1] as string;
		test(`[N3] ${path} の「戻る」が描画され ${prev} を指す`, async ({ page }) => {
			await page.goto(path);
			const back = page
				.getByTestId('setup-back-link')
				.or(page.locator(`a[href$="${prev}"]`).filter({ hasText: '←' }));
			await expect(
				back.first(),
				`${path} に戻る導線が描画されていない (中断者はここで行き止まりになる)`,
			).toBeVisible();
			await expect(back.first()).toHaveAttribute('href', new RegExp(`${prev}$`));
		});
	}
});
