// tests/e2e/demo-lambda/rule-preset-import-demo.spec.ts
//
// rule-preset 取込 (?import=<presetId> → hidden form auto-submit) の demo Lambda 回帰 (#2823)。
//
// 背景: demo 環境で /admin/settings/rules?import=<presetId> の自動取込を実行すると、
//   demo write-guard が {demo:true, imported:0} を返すが、rules page の form-result effect は
//   旧来 `r.presetId && typeof r.imported === 'number'` を要求していたため、presetId を含まない
//   demo 応答で分岐せず toast が一切出ない (無言) ことが #2823 で観測された。
//   activity / reward / challenge / checklist は #2819 系で「デモではお試し用」を明示するため、
//   rule-preset だけ挙動が異なり 5 type の体験が不統一だった (NN/G #1 visibility / #4 consistency)。
//
// 修正方針: rules page の form-result effect に `form.demo === true` 分岐を追加し、
//   他 4 type と同文言の demo 正直 toast (ADMIN_RULES_PAGE_LABELS.importDemo) を表示する。
//
// 検証 (per-child-import-dialog-reopen.spec.ts と同水準、rules は ChildSelectionDialog でなく
// auto-submit form なので `?import=` 遷移 → toast/feedback 表示を assert する):
//   (1) demo no-op は「デモではお試し用」を明示する (無言でない)
//   (2) 偽の成功件数 (「取込みました」) を出さない

import { expect, test } from '@playwright/test';

// demo seed に存在する rule-preset (bonus type、/admin/settings/rules で取込可能)。
// src/lib/data/marketplace/rule-presets/early-bird.json (payload.ruleType === 'bonus')。
const RULE_PRESET_ID = 'early-bird';

test.describe('rule-preset import demo (#2823)', () => {
	test('demo no-op を正直に出す (「デモではお試し用」+ 偽の成功件数を出さない)', async ({
		page,
	}) => {
		test.slow();

		await page.goto(`/admin/settings/rules?import=${RULE_PRESET_ID}`, {
			waitUntil: 'domcontentloaded',
		});

		// auto-import 用の hidden form が programmatic submit され、demo write-guard が
		// {demo:true, imported:0} を返す。form-result effect が demo 分岐で toast を出す。
		const body = page.locator('body');
		await expect(body, 'rule-preset: demo 明示メッセージ (無言でない)').toContainText(
			/デモではお試し用/,
			{ timeout: 30_000 },
		);

		// 偽の成功件数 (real 経路の importToastSuccess) を出さない。
		await expect(body, 'rule-preset: 偽の成功件数を出さない').not.toContainText(/取込みました/);
	});
});
