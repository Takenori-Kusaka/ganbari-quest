import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import BirthdayInput from '$lib/ui/primitives/BirthdayInput.svelte';

describe('BirthdayInput', () => {
	it('correctly initializes from value prop', async () => {
		const { getByLabelText } = render(BirthdayInput, { value: '2020-05-15', name: 'birthDate' });
		expect((getByLabelText('Year of birth') as HTMLSelectElement).value).toBe('2020');
		expect((getByLabelText('Month of birth') as HTMLSelectElement).value).toBe('5');
		expect((getByLabelText('Day of birth') as HTMLSelectElement).value).toBe('15');
	});

	it('updates value when year, month, and day are selected', async () => {
		const { container, getByLabelText } = render(BirthdayInput, { name: 'birthDate' });

		const yearSelect = getByLabelText('Year of birth');
		const monthSelect = getByLabelText('Month of birth');
		const daySelect = getByLabelText('Day of birth');

		await fireEvent.change(yearSelect, { target: { value: '2021' } });
		await fireEvent.change(monthSelect, { target: { value: '10' } });
		await fireEvent.change(daySelect, { target: { value: '25' } });

		const hiddenInput = container.querySelector('input[type="hidden"]') as HTMLInputElement;
		expect(hiddenInput.value).toBe('2021-10-25');
	});

	it('handles leap years correctly (29 days in Feb)', async () => {
		const { getByLabelText, getByText } = render(BirthdayInput, { value: '2024-02-01', name: 'birthDate' });

		const daySelect = getByLabelText('Day of birth') as HTMLSelectElement;
		const options = Array.from(daySelect.querySelectorAll('option')).filter((o) => o.value !== '');
		expect(options.length).toBe(29);
		expect(getByText('29日')).toBeTruthy();
	});

	it('handles non-leap years correctly (28 days in Feb)', async () => {
		const { getByLabelText, queryByText } = render(BirthdayInput, {
			value: '2023-02-01',
			name: 'birthDate',
		});

		const daySelect = getByLabelText('Day of birth') as HTMLSelectElement;
		const options = Array.from(daySelect.querySelectorAll('option')).filter((o) => o.value !== '');
		expect(options.length).toBe(28);
		expect(queryByText('29日')).toBeNull();
	});

	it('handles months with 30 days', async () => {
		const { getByLabelText, queryByText } = render(BirthdayInput, {
			value: '2023-04-01',
			name: 'birthDate',
		});

		const daySelect = getByLabelText('Day of birth') as HTMLSelectElement;
		const options = Array.from(daySelect.querySelectorAll('option')).filter((o) => o.value !== '');
		expect(options.length).toBe(30);
		expect(queryByText('31日')).toBeNull();
	});

	it('resets day when changing from a 31-day month to a 30-day month', async () => {
		const { getByLabelText } = render(BirthdayInput, { value: '2023-01-31', name: 'birthDate' });

		const monthSelect = getByLabelText('Month of birth');
		const daySelect = getByLabelText('Day of birth') as HTMLSelectElement;

		expect(daySelect.value).toBe('31');

		await fireEvent.change(monthSelect, { target: { value: '4' } });
		expect(daySelect.value).toBe('30');
	});

	it('resets to undefined when all fields are cleared', async () => {
		const { container, getByLabelText } = render(BirthdayInput, {
			value: '2023-01-31',
			name: 'birthDate',
		});

		const yearSelect = getByLabelText('Year of birth');
		const monthSelect = getByLabelText('Month of birth');
		const daySelect = getByLabelText('Day of birth');

		await fireEvent.change(yearSelect, { target: { value: '' } });
		await fireEvent.change(monthSelect, { target: { value: '' } });
		await fireEvent.change(daySelect, { target: { value: '' } });

		const hiddenInput = container.querySelector('input[type="hidden"]') as HTMLInputElement;
		expect(hiddenInput.value).toBe('');
	});
});
