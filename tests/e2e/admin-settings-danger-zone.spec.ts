// tests/e2e/admin-settings-danger-zone.spec.ts
// #2319 / #2321 / #2323: GitHub Danger Zone パターン (赤枠 + 最下部 + 3-step 確認) の E2E 検証
//
// 検証内容:
// - /admin/settings/data に data-testid="data-danger-zone" が表示 (clear-all)
// - 3-step 確認: 確認テキスト + 同意 checkbox の両方が満たされないとボタン disabled
// - /admin/settings/account に data-testid="account-danger-zone" が表示 (accountDelete、cognito モードのみ)
//   - local モードでは authMode!='cognito' によりセクション非表示なので env-skip 注釈

import { expect, test } from '@playwright/test';

test.describe('#2319 Danger Zone — data clear (/admin/settings/data)', () => {
	test('data-danger-zone が表示され、3-step 確認ガードが機能する', async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings/data', { waitUntil: 'domcontentloaded' });

		const dangerZone = page.getByTestId('data-danger-zone');
		await expect(dangerZone).toBeVisible();

		// Step 3: 実行ボタンは初期状態で disabled
		const executeBtn = page.getByTestId('data-danger-execute-button');
		await expect(executeBtn).toBeVisible();
		await expect(executeBtn).toBeDisabled();

		// Step 1 のみ満たしても disabled (Step 2 同意 checkbox 未チェック)
		await page.fill('#clearConfirm', '削除');
		await expect(executeBtn).toBeDisabled();

		// Step 2 のみ満たしても disabled (Step 1 確認テキスト未入力ならクリア)
		await page.fill('#clearConfirm', '');
		await page.getByTestId('data-danger-agree-checkbox').check();
		await expect(executeBtn).toBeDisabled();

		// Step 1 + Step 2 両方満たして初めて enabled
		await page.fill('#clearConfirm', '削除');
		await expect(executeBtn).toBeEnabled();
	});
});

test.describe('#2319 Danger Zone — accountDelete (/admin/settings/account)', () => {
	test('account-danger-zone は cognito モードのみ表示、3-step ガード機能', async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings/account', { waitUntil: 'domcontentloaded' });

		const dangerZone = page.getByTestId('account-danger-zone');
		const dangerZoneCount = await dangerZone.count();

		if (dangerZoneCount === 0) {
			// local モード (authMode != 'cognito') ではセクション非表示
			test.info().annotations.push({
				type: 'env-skip',
				description: 'account-danger-zone は cognito モードでのみ表示 (local モードでは非表示)',
			});
			return;
		}

		await expect(dangerZone).toBeVisible();

		// #4545: 復旧不能の告知は色文字ではなく Alert primitive (role="alert") で出す。
		// 色だけを手がかりにすると色覚多様性のある方に届かない (WCAG 1.4.1)。
		// role は Alert の danger variant が担保する。
		const ownerWarning = page.getByTestId('account-delete-owner-warning');
		if ((await ownerWarning.count()) > 0) {
			await expect(ownerWarning).toBeVisible();
			await expect(ownerWarning).toHaveAttribute('role', 'alert');
		}

		// 猶予期間の告知: 猶予 0 日 (無料プラン) は取り消せないので alert、
		// 猶予がある有料プランは期間内に取り消せるので status に留める。
		const graceNotice = page.getByTestId('account-delete-grace-notice');
		if ((await graceNotice.count()) > 0) {
			await expect(graceNotice).toBeVisible();
			// どちらの場合も「枠線付きの Alert」であること = role 属性を持つこと自体を要求する
			// (旧実装の裸の <p> は role を持たない)。
			await expect(graceNotice).toHaveAttribute('role', /^(alert|status)$/);
		}

		const executeBtn = page.getByTestId('account-danger-execute-button');
		await expect(executeBtn).toBeVisible();
		await expect(executeBtn).toBeDisabled();

		// Step 1: 確認テキスト入力
		await page.fill('#deleteConfirm', 'アカウントを削除します');
		// Step 2 未チェックでも disabled
		await expect(executeBtn).toBeDisabled();

		// Step 2: 同意 checkbox
		await page.getByTestId('account-danger-agree-checkbox').check();

		// Step 1 + 2 両方満たして enabled
		await expect(executeBtn).toBeEnabled();
	});
});
