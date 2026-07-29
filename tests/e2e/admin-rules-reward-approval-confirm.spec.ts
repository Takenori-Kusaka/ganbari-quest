// tests/e2e/admin-rules-reward-approval-confirm.spec.ts
// #4023: ごほうび交換の「親承認を外す」操作に確認ステップを 1 枚入れる回帰テスト。
//
// 検証範囲:
//   AC1: 承認必須 → 即時交換 の押下で確認が出る / キャンセルで設定値が変わらない
//        (UI badge だけでなく settings KVS の reward_auto_approve が変化しないことを固定する。
//         UI だけ見ていると「確認が出る」テストは確認を素通ししても通ってしまうため)
//   AC2: 即時交換 → 承認必須 (安全側) では確認を出さない
//   同一ページ内の確認機構統一: bonus preset 削除のキャンセルでも preset が消えない

import { expect, test } from './fixtures';

const SETTING_KEY = 'reward_auto_approve';

async function readRewardAutoApprove(workerDbPath: string): Promise<string | null> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath, { readonly: true });
	try {
		const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY) as
			| { value: string }
			| undefined;
		return row?.value ?? null;
	} finally {
		db.close();
	}
}

async function resetState(workerDbPath: string): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		db.prepare('DELETE FROM settings WHERE key = ?').run(SETTING_KEY);
		db.prepare("DELETE FROM settings WHERE key = 'rule_preset_bonus_overrides'").run();
		db.prepare("DELETE FROM settings WHERE key = 'rule_preset_import_warnings'").run();
	} finally {
		db.close();
	}
}

/**
 * rules ページを開き、hydration 完了まで待つ。
 *
 * 確認ダイアログは Ark UI `<Portal>` 配下で client mount 後にのみ DOM に現れるため、
 * その attach を hydration gate として使う。hydration 前に submit ボタンを押すと
 * `use:enhance` が未装着で native form submit (= 確認なしで action 実行) になり、
 * 「確認が出ない」ではなく「JS 未起動」を測ってしまう。
 */
async function gotoRulesPage(page: import('@playwright/test').Page, query = ''): Promise<void> {
	await page.goto(`/admin/settings/rules${query}`, { waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('admin-rules-page')).toBeVisible();
	await expect(page.getByTestId('rules-confirm-dialog')).toHaveCount(1, { timeout: 30_000 });
}

test.describe('#4023 ごほうび交換の親承認解除に確認ステップ', () => {
	test.setTimeout(180_000);

	test.beforeEach(async ({ workerDbPath }) => {
		await resetState(workerDbPath);
	});

	test('AC1: 解除方向は確認が出る / キャンセルで reward_auto_approve が変化しない', async ({
		page,
		workerDbPath,
	}) => {
		test.slow();
		await gotoRulesPage(page);

		// 既定 = 承認必須 (設定 row なし)
		expect(await readRewardAutoApprove(workerDbPath)).toBeNull();

		const toggle = page.getByTestId('rules-reward-approval-toggle');
		await expect(toggle).toHaveText(/即時交換/);
		await toggle.click();

		// 確認ダイアログが出る。文言は「結果」を含む (AC3)
		const dialog = page.getByTestId('rules-confirm-dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText('承認なしで');

		// キャンセル
		await page.getByTestId('rules-confirm-cancel').click();
		await expect(dialog).toBeHidden();

		// 設定値が書かれていないこと (これが本 test の核。確認を素通しさせると 'true' になり fail する)
		expect(await readRewardAutoApprove(workerDbPath)).toBeNull();

		// reload しても承認必須のまま
		await gotoRulesPage(page);
		await expect(page.getByTestId('rules-reward-approval-toggle')).toHaveText(/即時交換/);
		expect(await readRewardAutoApprove(workerDbPath)).toBeNull();
	});

	test('確認を承認すると即時交換に切り替わる', async ({ page, workerDbPath }) => {
		test.slow();
		await gotoRulesPage(page);

		await page.getByTestId('rules-reward-approval-toggle').click();
		await expect(page.getByTestId('rules-confirm-dialog')).toBeVisible();
		await page.getByTestId('rules-confirm-accept').click();

		await expect(page.getByTestId('rules-reward-approval-toggle')).toHaveText(/承認を必須に戻す/, {
			timeout: 30_000,
		});
		await expect.poll(() => readRewardAutoApprove(workerDbPath), { timeout: 30_000 }).toBe('true');
	});

	test('AC2: 承認必須に戻す安全側の操作は確認を出さない', async ({ page, workerDbPath }) => {
		test.slow();
		await gotoRulesPage(page);

		// 前提を作る: 一旦 即時交換 にする
		await page.getByTestId('rules-reward-approval-toggle').click();
		await page.getByTestId('rules-confirm-accept').click();
		await expect.poll(() => readRewardAutoApprove(workerDbPath), { timeout: 30_000 }).toBe('true');
		// client 側の再描画 (invalidateAll) 完了を待ってから安全側を押す
		await expect(page.getByTestId('rules-reward-approval-toggle')).toHaveText(/承認を必須に戻す/, {
			timeout: 30_000,
		});

		// 安全側 (即時交換 → 承認必須) は 1 クリックで完了し、確認は出ない。
		// 「accept を一度も押していないのに設定が false へ戻る」= 確認を挟んでいない証拠。
		await page.getByTestId('rules-reward-approval-toggle').click();
		await expect.poll(() => readRewardAutoApprove(workerDbPath), { timeout: 30_000 }).toBe('false');
		await expect(page.getByTestId('rules-confirm-dialog')).toBeHidden();
	});

	test('bonus preset 削除のキャンセルで preset が消えない (確認機構の統一)', async ({ page }) => {
		test.slow();
		await gotoRulesPage(page, '?import=streak-bonus');
		const preset = page.getByTestId('rules-bonus-preset-streak-bonus');
		await expect(preset).toBeVisible({ timeout: 30_000 });

		await page.getByTestId('rules-bonus-remove-streak-bonus').click();
		await expect(page.getByTestId('rules-confirm-dialog')).toBeVisible();
		await page.getByTestId('rules-confirm-cancel').click();

		await gotoRulesPage(page);
		await expect(page.getByTestId('rules-bonus-preset-streak-bonus')).toBeVisible({
			timeout: 30_000,
		});
	});
});
