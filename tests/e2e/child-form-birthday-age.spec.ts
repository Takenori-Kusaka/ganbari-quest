// tests/e2e/child-form-birthday-age.spec.ts
// #1380: 子供追加フォームの誕生日 or 年齢 必須化 E2E 検証
// A案 (排他的): 誕生日入力時は年齢 disabled / 年齢のみも可 / 両方空はエラー

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
// #4716: 追加フォームの見出しは 'こどもを追加' → CHILD_TERMS.honorific 由来の 'お子さまを追加' に
//   揃った。リテラル直書きだと呼称を直すたびに spec が黙って腐るので SSOT を直接読む。
import { ADMIN_CHILDREN_PAGE_LABELS } from '../../src/lib/domain/labels';

/** 追加フォームの見出し (SSOT: ADMIN_CHILDREN_PAGE_LABELS.addFormTitle)。 */
const ADD_FORM_HEADING = { name: ADMIN_CHILDREN_PAGE_LABELS.addFormTitle };

async function openAddForm(page: Page) {
	await page.goto('/admin/children');
	const addBtn = page.getByRole('button', { name: '追加する' }).first();
	await addBtn.click();
	await expect(page.getByRole('heading', ADD_FORM_HEADING)).toBeVisible();
}

async function fillNickname(page: Page, name: string) {
	await page.getByLabel('ニックネーム').fill(name);
}

async function fillBirthday(page: Page) {
	// BirthdayInput: 年 → 月 → 日 の順に選択
	await page.getByRole('combobox', { name: '生まれた年' }).selectOption('2018');
	await page.getByRole('combobox', { name: '生まれた月' }).selectOption('3');
	await page.getByRole('combobox', { name: '生まれた日' }).selectOption('10');
}

test.describe('#1380: 子供フォーム — 誕生日 or 年齢 必須化 (A案)', () => {
	test('誕生日のみ入力 → 追加成功、年齢フィールドは disabled', async ({ page }) => {
		await openAddForm(page);
		await fillNickname(page, 'テスト誕生日のみ');
		await fillBirthday(page);

		// 誕生日入力後、年齢フィールドは disabled になること
		const ageInput = page.locator('#add-age');
		await expect(ageInput).toBeDisabled();

		// 年齢フィールドのラベルが「自動計算」に変わること
		await expect(page.getByText('年齢（誕生日から自動計算）')).toBeVisible();

		// フォーム送信
		await page.getByRole('button', { name: '追加する' }).last().click();

		// 成功時: フォームが閉じる
		await expect(page.getByRole('heading', ADD_FORM_HEADING)).not.toBeVisible();
	});

	test('年齢のみ入力 → 追加成功', async ({ page }) => {
		await openAddForm(page);
		await fillNickname(page, 'テスト年齢のみ');

		// 誕生日は空のまま、年齢だけ入力
		await page.locator('#add-age').fill('6');

		// フォーム送信
		await page.getByRole('button', { name: '追加する' }).last().click();

		// 成功時: フォームが閉じる
		await expect(page.getByRole('heading', ADD_FORM_HEADING)).not.toBeVisible();
	});

	test('誕生日 + 年齢 両方提供 → 追加成功（誕生日 SSOT、年齢は disabled）', async ({ page }) => {
		await openAddForm(page);
		await fillNickname(page, 'テスト両方提供');
		await fillBirthday(page);

		// 誕生日を入力すると年齢は disabled になること
		const ageInput = page.locator('#add-age');
		await expect(ageInput).toBeDisabled();

		await page.getByRole('button', { name: '追加する' }).last().click();
		await expect(page.getByRole('heading', ADD_FORM_HEADING)).not.toBeVisible();
	});

	test('誕生日・年齢 両方空 → バリデーションエラー', async ({ page }) => {
		await openAddForm(page);
		await fillNickname(page, 'テスト両方空');

		// 誕生日も年齢も入力せずに送信
		await page.getByRole('button', { name: '追加する' }).last().click();

		// サーバーサイドエラーが表示されること
		await expect(page.getByText('誕生日または年齢を入力してください')).toBeVisible();
	});
});
