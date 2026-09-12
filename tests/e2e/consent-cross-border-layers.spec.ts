// tests/e2e/consent-cross-border-layers.spec.ts
// #4944: 規約再同意画面 (/consent) の越境移転同意ブロックが「2 層」で描画されることの回帰検証。
//
// 背景: 2026-09-10 版への再同意で、利用者から「逆に不安になった」「AWS や Google と言われても
// 何をされるのかよくわからない」という声が出た。原因は第一層 (画面) に法律用語の見出し・
// 事業者名 3 社・否定形 3 連が並んでいたこと。#4944 で第一層を「何が起きる / 起きない」の
// 2 行 + 折りたたみにし、事業者名・国名・条番号は第二層 (privacy.html 第10条) へ降ろした。
//
// E2E スコープ (ADR-0002: hotfix の E2E 回帰要件):
//   1. 第一層 (常時表示) に事業者名・国名・条番号が出ていない
//   2. 折りたたみを開くと、決済で渡る範囲 / 退会したとき の説明に到達できる (畳んだ結果、
//      全文に到達できなくなっていないこと)
//   3. 第二層への導線が「同意前の確認」を明示的に求める文で、privacy.html 第10条の anchor に向く
//      (PPC Q12-10: URL 提供は「本人に対して当該情報の確認を明示的に求める」ことが条件)
//   4. 3 つの同意を全部チェックすると送信可能になる (act → outcome。送信はしない —
//      送信すると worker DB に同意行が残り、以後この画面が描画されなくなる)
//
// 文言そのものの SSOT 整合 (第10条との突合 / 常時表示 2 行 / 40 字以内) は
//   tests/unit/domain/legal-labels.test.ts が担当。本 spec は「画面に実際にそう出る」ことを見る。
//
// 設計メモ:
//   - cognito-dev mode 専用 (storageState=playwright/.auth/owner.json)。`playwright.config.ts` の
//     BASE_TEST_IGNORE に追加 + `playwright.cognito-dev.config.ts` の testMatch に追加。
//   - COGNITO_DEV_MODE=true では hooks の同意 gate が skip されるため、/consent へは直接 goto する。
//     ページ自身の load は authMode=cognito なら描画するので、同意行が無い owner では 3 ブロックが出る。
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts consent-cross-border-layers

import { expect, test } from '@playwright/test';
import { CONSENT_LABELS } from '../../src/lib/domain/labels';

/** 第一層に出てはいけない語 (第二層 = privacy.html 第10条にだけ在るべきもの) */
const SECOND_LAYER_ONLY = ['AWS', 'Stripe', 'Google', '米国', 'バージニア北部', '第28条'];

test.describe('#4944 /consent 越境移転同意の 2 層描画', () => {
	test.use({ storageState: 'playwright/.auth/owner.json' });

	test.beforeEach(async ({ page }) => {
		await page.goto('/consent');
		// 越境移転ブロックが無い = 既に最新版へ同意済み。この spec の前提が崩れているので、
		// silent に PASS させず fail させる (別の状態を「検証した」ことにしない)。
		await expect(page.getByTestId('consent-cross-border-checkbox')).toBeVisible();
	});

	test('第一層 (常時表示) に事業者名・国名・条番号が出ない', async ({ page }) => {
		const block = page
			.getByTestId('consent-cross-border-checkbox')
			.locator('xpath=ancestor::div[contains(@class, "border")][1]');
		await expect(block.getByRole('heading', { level: 2 })).toHaveText(
			CONSENT_LABELS.crossBorderSectionTitle,
		);

		// 折りたたみを開く前の visible text だけを見る (畳まれた中身は innerText に含まれない)
		const visibleText = await block.innerText();
		for (const word of SECOND_LAYER_ONLY) {
			expect(visibleText, `第一層に「${word}」が出ている`).not.toContain(word);
		}
		expect(visibleText).toContain(CONSENT_LABELS.crossBorderSummaryPositive);
		expect(visibleText).toContain(CONSENT_LABELS.crossBorderNoNoUse);
	});

	test('折りたたみを開くと、決済で渡る範囲と退会時の説明に到達できる', async ({ page }) => {
		const block = page
			.getByTestId('consent-cross-border-checkbox')
			.locator('xpath=ancestor::div[contains(@class, "border")][1]');
		const details = block.locator('details');
		const summary = details.locator('summary');
		await expect(summary).toHaveText(CONSENT_LABELS.crossBorderDetailsSummary);

		// 畳んだ状態では中身が見えない
		await expect(details.getByText(CONSENT_LABELS.crossBorderPaymentScope)).toBeHidden();

		// act: 開く → outcome: 3 文が読める
		await summary.click();
		await expect(details).toHaveAttribute('open', '');
		await expect(details.getByText(CONSENT_LABELS.crossBorderWhatHappens)).toBeVisible();
		await expect(details.getByText(CONSENT_LABELS.crossBorderPaymentScope)).toBeVisible();
		await expect(details.getByText(CONSENT_LABELS.crossBorderDeletion)).toBeVisible();
	});

	test('第二層への導線が「同意前の確認」を求め、第10条の anchor に向いている', async ({ page }) => {
		const link = page.getByRole('link', { name: CONSENT_LABELS.crossBorderReadLink });
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute(
			'href',
			'https://www.ganbari-quest.com/privacy.html#cross-border-transfer',
		);
		await expect(link).toHaveAttribute('target', '_blank');
	});

	test('3 つの同意を全部チェックすると送信可能になる (送信はしない)', async ({ page }) => {
		const submit = page.getByRole('button', { name: CONSENT_LABELS.submitButton });
		await expect(submit).toBeDisabled();

		await page.getByTestId('consent-terms-checkbox').check();
		await page.getByTestId('consent-privacy-checkbox').check();
		await expect(submit).toBeDisabled(); // 越境移転がまだ

		await page.getByTestId('consent-cross-border-checkbox').check();
		await expect(submit).toBeEnabled();

		// 同意しない場合の出口 (#4497) が同一視界に在ること
		await expect(page.getByTestId('consent-decline-logout')).toBeVisible();
	});
});
