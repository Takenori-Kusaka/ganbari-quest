// tests/e2e/demo-lambda/per-child-import-dialog-reopen.spec.ts
//
// per-child 取込 (?import=<presetId> → ChildSelectionDialog → 確定) の demo Lambda 回帰。
// 顧客レビュー 2026-06-03 (AWS) で「確定後ダイアログが閉じない」を発見した経路。
//
// 根本原因: auto-open $effect の条件が `!showChildSelectionDialog` のみだったため、確定で
// false になると effect が再走し、data.importPresetId が残存して即座に再 open していた。
// presetId 単位の one-shot guard (consumedImportPresetId) で再 open を防ぐ。
//
// 検証 (3 per-child type 横断):
//   (1) 確定後に dialog が閉じる (再 open しない = dead-end でない)
//   (2) demo no-op は「デモではお試し用」を明示し、偽の成功件数を出さない
//   (3) キャンセルで dialog が閉じる

import { expect, type Page, test } from '@playwright/test';

type Case = {
	label: string;
	adminPath: string;
	importPreset: string;
	dialogTestid: string;
	/** demo で出てはいけない成功偽装文言 */
	falseSuccess: RegExp;
};

const CASES: Case[] = [
	{
		label: 'activity-pack',
		adminPath: '/admin/activities',
		importPreset: 'kinder-starter',
		dialogTestid: 'import-child-selection-dialog',
		falseSuccess: /件の活動を追加しました/,
	},
	{
		label: 'reward-set',
		adminPath: '/admin/rewards',
		importPreset: 'kinder-rewards',
		dialogTestid: 'reward-import-child-selection-dialog',
		falseSuccess: /件のごほうびを追加しました/,
	},
	{
		label: 'challenge-set',
		adminPath: '/admin/challenges',
		importPreset: 'japan-annual-events',
		dialogTestid: 'challenge-import-child-selection-dialog',
		falseSuccess: /件のチャレンジを追加しました/,
	},
];

async function openImportDialog(page: Page, c: Case) {
	await page.goto(`${c.adminPath}?import=${c.importPreset}`, { waitUntil: 'domcontentloaded' });
	const dialog = page.getByTestId(c.dialogTestid);
	await expect(dialog, `${c.label}: ChildSelectionDialog auto-open`).toBeVisible({
		timeout: 30_000,
	});
	return dialog;
}

for (const c of CASES) {
	test.describe(`per-child import demo (${c.label})`, () => {
		test(`${c.label}: 確定後に dialog が閉じる + demo no-op を正直に出す (偽の成功件数を出さない)`, async ({
			page,
		}) => {
			test.slow();
			const dialog = await openImportDialog(page, c);

			// default selection='all' で confirm 可能
			const confirm = dialog.getByTestId('child-selection-confirm');
			await expect(confirm).toBeEnabled({ timeout: 10_000 });
			await confirm.click();

			// demo no-op honest: feedback「デモではお試し用」を待つ (settling 点 = effect 再走 window 経過)
			const body = page.locator('body');
			await expect(body, `${c.label}: demo 明示メッセージ`).toContainText(/デモではお試し用/, {
				timeout: 15_000,
			});
			// 偽の成功件数を出さない
			await expect(body, `${c.label}: 偽の成功件数を出さない`).not.toContainText(c.falseSuccess);

			// dead-end でない: メッセージ表示後 (effect 再走後) も dialog は閉じたまま (旧 bug ではここで再 open)
			await expect(dialog, `${c.label}: 確定後 dialog が閉じたまま (再 open しない)`).toBeHidden();
		});

		test(`${c.label}: キャンセルで dialog が閉じる`, async ({ page }) => {
			test.slow();
			const dialog = await openImportDialog(page, c);
			await dialog.getByRole('button', { name: 'キャンセル' }).click();
			await expect(dialog, `${c.label}: キャンセルで閉じる`).toBeHidden({ timeout: 10_000 });
		});
	});
}
