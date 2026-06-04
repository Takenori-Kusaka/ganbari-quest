// tests/e2e/plan-gated-features.spec.ts
// #776: プラン別ゲート UI の E2E 検証
//
// ローカル auth モードでは plan-limit-service の resolvePlanTier が
// 早期 return で常に 'family' を返すため、プランゲートを E2E で検証できない。
// この spec は AUTH_MODE=cognito + COGNITO_DEV_MODE=true 前提で実行し、
// DevCognitoAuthProvider のプラン別ダミーユーザー（free/standard/family）で
// ログイン → 実際のプランゲート UI を検証する。
//
// #1535: loginAsPlan() を storageState ベースに移行（describe ブロック分割）
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts plan-gated-features
//
// 対応ゲート:
//  - /admin/rewards: rewards-upgrade-banner（free のみ表示）
//
// #2316 削除済 ゲート:
//  - /admin/messages: ひとことメッセージボタン (free/standard disabled, family enabled)
//    → #2267 (PR #2293) で /admin/messages 廃止 + /admin/cheer 統合により、
//      メッセージ機能は応援機能の付随要素として全プラン解放された
//      (ADR-0006 assertion erosion ban に従い skip ではなく削除)

import { expect, test } from '@playwright/test';

// ============================================================
// /admin/rewards — #728 カスタムごほうびプランゲート
// ============================================================
test.describe('#776 /admin/rewards プランゲート — free', () => {
	test.use({ storageState: 'playwright/.auth/free.json' });

	test('free プランではアップグレードバナーが表示される', async ({ page }) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toBeVisible();
		await expect(page.getByTestId('rewards-upgrade-cta')).toBeVisible();
	});

	// #2894 AC5 (case 1): free tier (cognito-dev dev-free-owner, licenseStatus=NONE) で
	// marketplace reward-set を取込もうとすると importPresetToChildren action が
	// plan gate (#728) で 403 + PlanLimitError を返す。修正前は handleChildSelectionConfirm が
	// `String(error)` するため toast / banner が「[object Object]」になり plan-limit
	// メッセージが壊れていた (Issue 証拠④)。修正後 (getErrorMessage 経由) は
	// PLAN_GATE_LABELS.standardOrAboveFor('ごほうび管理') を含む可読メッセージが表示される。
	test('#2894: free で reward 取込確定 → plan-limit メッセージが表示され [object Object] にならない', async ({
		page,
	}) => {
		test.slow(); // Vite dev コールドコンパイル耐性

		// ?import=<presetId> で ChildSelectionDialog auto-open (kinder-rewards は実在 preset)
		await page.goto('/admin/rewards?import=kinder-rewards', { waitUntil: 'domcontentloaded' });

		const dialog = page.getByTestId('reward-import-child-selection-dialog');
		await expect(dialog, 'ChildSelectionDialog auto-open (dead-end でない前提)').toBeVisible({
			timeout: 15_000,
		});

		// default = 「全員に追加」選択済 → 確定 click。
		// 副作用 A: importPresetToChildren network 発火 (free では 403 plan gate で reject される)。
		const confirm = page.getByTestId('child-selection-confirm');
		await expect(confirm).toBeEnabled();
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/importPresetToChildren/.test(r.url())),
			confirm.click(),
		]);
		// SvelteKit form action は fail(403, ...) を 200 ActionResult (type:failure) で返す。
		// HTTP status は 200 だが body に PlanLimitError が入る。
		expect([200, 403].includes(resp.status())).toBe(true);

		// 副作用 B: 結果 feedback (Toast role=alert または banner role=status) が
		//   plan-limit メッセージを表示する。修正前バグの「[object Object]」を含まないこと、
		//   かつ「スタンダードプラン」を含む可読メッセージであることを assert。
		const actionMsg = page.getByTestId('rewards-action-message');
		const toast = page.getByRole('alert');
		// banner / toast のどちらか先に出た方を待つ (2 層防御、DESIGN.md §5 Toast)
		await expect(actionMsg.or(toast).first()).toBeVisible({ timeout: 10_000 });

		const bannerText = (await actionMsg.textContent().catch(() => '')) ?? '';
		const toastText =
			(await toast
				.first()
				.textContent()
				.catch(() => '')) ?? '';
		const combined = `${bannerText}${toastText}`;
		// #2894 回帰: 壊れた文字列化を二度と踏まない
		expect(combined, 'plan-limit feedback が [object Object] になっていない').not.toContain(
			'[object Object]',
		);
		// plan-limit メッセージ (PLAN_GATE_LABELS.standardOrAboveFor) の可読性を担保
		expect(combined, 'plan-limit メッセージにプラン名が含まれる').toContain('スタンダードプラン');
	});
});

test.describe('#776 /admin/rewards プランゲート — standard', () => {
	test.use({ storageState: 'playwright/.auth/standard.json' });

	test('standard プランではアップグレードバナーが表示されない', async ({ page }) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
	});

	// #2894 AC5 (case 2): paid tier (cognito-dev dev-standard-owner, licenseStatus=ACTIVE +
	// plan=standard_monthly) では plan gate を通過し、reward 取込が成功する。
	// free との対比で「reward だけ paid 限定」という #728 committed 仕様 (pricing SSOT §3.2) を
	// 双方向で固定する (ADR-0006 mirror 関係)。
	test('#2894: standard で reward 取込確定 → plan gate を通過し成功フィードバックが出る', async ({
		page,
	}) => {
		test.slow(); // Vite dev コールドコンパイル耐性

		await page.goto('/admin/rewards?import=kinder-rewards', { waitUntil: 'domcontentloaded' });

		const dialog = page.getByTestId('reward-import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 15_000 });

		const confirm = page.getByTestId('child-selection-confirm');
		await expect(confirm).toBeEnabled();
		// 副作用 A: importPresetToChildren network 発火 + response OK (plan gate 通過 = 403 で reject されない)
		const [resp] = await Promise.all([
			page.waitForResponse((r) => /\?\/importPresetToChildren/.test(r.url())),
			confirm.click(),
		]);
		expect(resp.ok()).toBeTruthy();
		const respBody = await resp.text();
		// 成功 ActionResult (type:success) で対象 presetId を含む = Strategy dispatch 完了。
		// plan gate 403 (PlanLimitError) なら body に "PLAN_LIMIT_EXCEEDED" が含まれるため、
		// 成功経路ではそれを含まないことを併せて確認 (free との対比)。
		expect(respBody.includes('kinder-rewards')).toBeTruthy();
		expect(
			respBody.includes('PLAN_LIMIT_EXCEEDED'),
			'standard は plan gate で reject されない (PlanLimitError を返さない)',
		).toBeFalsy();

		// 副作用 B: 成功 feedback (banner role=status または Toast) が表示され
		//   plan-limit メッセージは出ない。
		const actionMsg = page.getByTestId('rewards-action-message');
		const toast = page.getByRole('alert');
		await expect(actionMsg.or(toast).first()).toBeVisible({ timeout: 10_000 });
		const bannerText = (await actionMsg.textContent().catch(() => '')) ?? '';
		const toastText =
			(await toast
				.first()
				.textContent()
				.catch(() => '')) ?? '';
		const combined = `${bannerText}${toastText}`;
		expect(combined).not.toContain('[object Object]');
		expect(combined, 'standard 成功時は plan-limit メッセージを出さない').not.toContain(
			'スタンダードプラン以上',
		);
	});
});

test.describe('#776 /admin/rewards プランゲート — family', () => {
	test.use({ storageState: 'playwright/.auth/family.json' });

	test('family プランではアップグレードバナーが表示されない', async ({ page }) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('rewards-upgrade-banner')).toHaveCount(0);
	});
});

// ============================================================
// /admin/challenges — #2402 QM must-3 (OWASP A01) challenge-set import family ゲート
// ============================================================
// 兄弟チャレンジは family-only 機能。client-side `{#if !isFamily}` UI ゲートを
// 直接 POST でバイパスできないよう、サーバー側でも family プラン厳密比較を実施。
//
// **検証層**: unit テスト (`tests/unit/routes/admin-challenges-marketplace-import-plan-gate.test.ts`)
// で action handler を直接呼び出して検証する。
//
// E2E (`request.post`) で同等の検証を試みたところ、SvelteKit の CSRF 保護
// (`Cross-site POST form submissions are forbidden`) が family ゲートに到達する前に
// レスポンスを差し替えるため、E2E 層で gate メッセージを assert できない問題があった
// (PR #2402 e2e-cognito-dev failure)。
// unit テストで action handler を直接呼ぶことで CSRF を回避しつつ、ADR-0006 に従い
// 403 family gate の assertion 強度は維持する (検証層を移動するだけで弱体化させない)。
