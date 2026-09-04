import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import BirthdayInput from '$lib/ui/primitives/BirthdayInput.svelte';

describe('BirthdayInput', () => {
	it('correctly initializes from value prop', async () => {
		const { getByLabelText } = render(BirthdayInput, { value: '2020-05-15', name: 'birthDate' });
		expect((getByLabelText('生まれた年') as HTMLSelectElement).value).toBe('2020');
		expect((getByLabelText('生まれた月') as HTMLSelectElement).value).toBe('5');
		expect((getByLabelText('生まれた日') as HTMLSelectElement).value).toBe('15');
	});

	it('updates value when year, month, and day are selected', async () => {
		const { container, getByLabelText } = render(BirthdayInput, { name: 'birthDate' });

		const yearSelect = getByLabelText('生まれた年');
		const monthSelect = getByLabelText('生まれた月');
		const daySelect = getByLabelText('生まれた日');

		await fireEvent.change(yearSelect, { target: { value: '2021' } });
		await fireEvent.change(monthSelect, { target: { value: '10' } });
		await fireEvent.change(daySelect, { target: { value: '25' } });

		const hiddenInput = container.querySelector('input[type="hidden"]') as HTMLInputElement;
		expect(hiddenInput.value).toBe('2021-10-25');
	});

	it('handles leap years correctly (29 days in Feb)', async () => {
		const { getByLabelText, getByText } = render(BirthdayInput, {
			value: '2024-02-01',
			name: 'birthDate',
		});

		const daySelect = getByLabelText('生まれた日') as HTMLSelectElement;
		const options = Array.from(daySelect.querySelectorAll('option')).filter((o) => o.value !== '');
		expect(options.length).toBe(29);
		expect(getByText('29日')).toBeTruthy();
	});

	it('handles non-leap years correctly (28 days in Feb)', async () => {
		const { getByLabelText, queryByText } = render(BirthdayInput, {
			value: '2023-02-01',
			name: 'birthDate',
		});

		const daySelect = getByLabelText('生まれた日') as HTMLSelectElement;
		const options = Array.from(daySelect.querySelectorAll('option')).filter((o) => o.value !== '');
		expect(options.length).toBe(28);
		expect(queryByText('29日')).toBeNull();
	});

	it('handles months with 30 days', async () => {
		const { getByLabelText, queryByText } = render(BirthdayInput, {
			value: '2023-04-01',
			name: 'birthDate',
		});

		const daySelect = getByLabelText('生まれた日') as HTMLSelectElement;
		const options = Array.from(daySelect.querySelectorAll('option')).filter((o) => o.value !== '');
		expect(options.length).toBe(30);
		expect(queryByText('31日')).toBeNull();
	});

	it('resets day when changing from a 31-day month to a 30-day month', async () => {
		const { getByLabelText } = render(BirthdayInput, { value: '2023-01-31', name: 'birthDate' });

		const monthSelect = getByLabelText('生まれた月');
		const daySelect = getByLabelText('生まれた日') as HTMLSelectElement;

		expect(daySelect.value).toBe('31');

		await fireEvent.change(monthSelect, { target: { value: '4' } });
		expect(daySelect.value).toBe('30');
	});

	// --- #4729 PO 決定 (2026-09-04): 誕生日は任意入力なので「未設定に戻せる」 ---
	//
	// 旧実装は placeholder option が `disabled` だったため、**画面からは**一度入れた誕生日を
	// 空に戻せなかった (下の "resets to undefined when all fields are cleared" は
	// `fireEvent.change` で programmatic に値を入れるため disabled でも通ってしまい、
	// 顧客の到達性を保証していなかった)。以下 3 件が「保護者が実際に消せる」ことを固定する。

	/** placeholder (未設定) option だけを取り出す */
	function placeholderOption(select: HTMLElement): HTMLOptionElement {
		const opt = select.querySelector('option[value=""]');
		if (!opt) throw new Error('未設定 option が無い (placeholder が描画されていない)');
		return opt as HTMLOptionElement;
	}

	it('未設定 option を選択できる（誕生日は任意入力なので消せる、#4729）', () => {
		const { getByLabelText } = render(BirthdayInput, { value: '2020-05-15', name: 'birthDate' });

		for (const labelText of ['生まれた年', '生まれた月', '生まれた日']) {
			expect(placeholderOption(getByLabelText(labelText)).disabled).toBe(false);
		}
	});

	it('required のときは未設定 option を選べない（必須入力が成立しなくなるため）', () => {
		const { getByLabelText } = render(BirthdayInput, {
			value: '2020-05-15',
			name: 'birthDate',
			required: true,
		});

		expect(placeholderOption(getByLabelText('生まれた年')).disabled).toBe(true);
	});

	it('年を未設定に戻すと月日も未設定になり、value が空になる（#4729）', async () => {
		const { container, getByLabelText } = render(BirthdayInput, {
			value: '2020-05-15',
			name: 'birthDate',
		});

		// 年だけを未設定に戻す。月 / 日の select は `disabled` になるため自力では空に戻せず、
		// 連動して空にならないと value が '2020-05-15' のまま固まる。
		await fireEvent.change(getByLabelText('生まれた年'), { target: { value: '' } });

		expect((getByLabelText('生まれた月') as HTMLSelectElement).value).toBe('');
		expect((getByLabelText('生まれた日') as HTMLSelectElement).value).toBe('');
		const hiddenInput = container.querySelector('input[type="hidden"]') as HTMLInputElement;
		expect(hiddenInput.value).toBe('');
	});

	// 部分クリアの沈黙を潰す (#4729 adversarial review must 2)。
	// 未設定 option を選べるようにした結果、年 / 月 / 日 のうち一部だけを空に戻せるようになった。
	// 「3 つ揃わなければ未設定」に統一していないと、**画面は空なのに hidden input には古い日付**が
	// 残り、`isBirthdayClearingSubmit()` (`!formData.get('birthDate')`) が false になって
	// 確認ダイアログも Alert も出ないまま古い誕生日が保存される = 保護者は「消したつもりで祝われ続ける」。
	it.each([
		['月', '生まれた月'],
		['日', '生まれた日'],
	])('%sだけを未設定に戻しても value は空になる（画面は空なのに前の誕生日が残る、を防ぐ #4729）', async (_name, labelText) => {
		const { container, getByLabelText } = render(BirthdayInput, {
			value: '2020-05-15',
			name: 'birthDate',
		});

		await fireEvent.change(getByLabelText(labelText), { target: { value: '' } });

		const hiddenInput = container.querySelector('input[type="hidden"]') as HTMLInputElement;
		expect(hiddenInput.value).toBe('');
		// 空にした欄自体も空のまま (下位の欄が残って「一部だけ埋まった日付」に見えない)
		expect((getByLabelText('生まれた日') as HTMLSelectElement).value).toBe('');
	});

	it('resets to undefined when all fields are cleared', async () => {
		const { container, getByLabelText } = render(BirthdayInput, {
			value: '2023-01-31',
			name: 'birthDate',
		});

		const yearSelect = getByLabelText('生まれた年');
		const monthSelect = getByLabelText('生まれた月');
		const daySelect = getByLabelText('生まれた日');

		await fireEvent.change(yearSelect, { target: { value: '' } });
		await fireEvent.change(monthSelect, { target: { value: '' } });
		await fireEvent.change(daySelect, { target: { value: '' } });

		const hiddenInput = container.querySelector('input[type="hidden"]') as HTMLInputElement;
		expect(hiddenInput.value).toBe('');
	});
});
