// tests/unit/ui/FormField.test.ts
// #1191 — FormField primitive の variant (textarea/number/tel/date/time) 動作検証
//
// Svelte 5 + @testing-library/svelte で DOM をマウントし、type prop が
// 正しい HTML 要素 / type 属性に反映されるか、label/error/hint の
// a11y 属性配線が各 variant で一致するかを確認する。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import FormField from '../../../src/lib/ui/primitives/FormField.svelte';

describe('FormField variants (#1191)', () => {
	afterEach(() => {
		cleanup();
	});

	describe('textarea variant', () => {
		it('type="textarea" の時、textarea 要素が描画される (input ではなく)', () => {
			const { container } = render(FormField, { label: 'メモ', type: 'textarea' });
			expect(container.querySelector('textarea')).not.toBeNull();
			expect(container.querySelector('input')).toBeNull();
		});

		it('rows prop が textarea の rows 属性に反映される', () => {
			const { container } = render(FormField, {
				label: 'メモ',
				type: 'textarea',
				rows: 8,
			});
			const ta = container.querySelector('textarea');
			expect(ta?.getAttribute('rows')).toBe('8');
		});

		it('rows のデフォルトは 4', () => {
			const { container } = render(FormField, { label: 'メモ', type: 'textarea' });
			const ta = container.querySelector('textarea');
			expect(ta?.getAttribute('rows')).toBe('4');
		});

		it('label が textarea の for 属性と一致する', () => {
			const { container } = render(FormField, {
				label: 'メモ',
				type: 'textarea',
				id: 'memo-field',
			});
			const label = container.querySelector('label');
			const ta = container.querySelector('textarea');
			expect(label?.getAttribute('for')).toBe('memo-field');
			expect(ta?.id).toBe('memo-field');
		});

		it('error 時に aria-invalid="true" と aria-describedby が付く', () => {
			const { container } = render(FormField, {
				label: 'メモ',
				type: 'textarea',
				id: 'memo-e',
				error: '500 文字以内',
			});
			const ta = container.querySelector('textarea');
			expect(ta?.getAttribute('aria-invalid')).toBe('true');
			expect(ta?.getAttribute('aria-describedby')).toBe('memo-e-error');
			expect(screen.getByRole('alert').textContent).toContain('500 文字以内');
		});

		it('hint 表示時に aria-describedby が hint を指す', () => {
			const { container } = render(FormField, {
				label: 'メモ',
				type: 'textarea',
				id: 'memo-h',
				hint: '省略可',
			});
			const ta = container.querySelector('textarea');
			expect(ta?.getAttribute('aria-describedby')).toBe('memo-h-hint');
		});

		it('disabled prop が textarea に伝播する', () => {
			const { container } = render(FormField, {
				label: 'メモ',
				type: 'textarea',
				disabled: true,
			});
			const ta = container.querySelector('textarea');
			expect(ta?.hasAttribute('disabled')).toBe(true);
		});
	});

	describe('number variant', () => {
		it('type="number" の時 input の type 属性が number', () => {
			const { container } = render(FormField, { label: '年齢', type: 'number' });
			expect(container.querySelector('input')?.type).toBe('number');
		});

		it('min/max が input に伝播する', () => {
			const { container } = render(FormField, {
				label: '年齢',
				type: 'number',
				min: 0,
				max: 18,
			});
			const input = container.querySelector('input');
			expect(input?.getAttribute('min')).toBe('0');
			expect(input?.getAttribute('max')).toBe('18');
		});
	});

	describe('tel variant', () => {
		it('type="tel" の時 input の type 属性が tel', () => {
			const { container } = render(FormField, { label: '電話番号', type: 'tel' });
			expect(container.querySelector('input')?.type).toBe('tel');
		});
	});

	describe('date / time variants', () => {
		it('type="date" の時 input の type 属性が date', () => {
			const { container } = render(FormField, { label: '生年月日', type: 'date' });
			expect(container.querySelector('input')?.type).toBe('date');
		});

		it('type="time" の時 input の type 属性が time', () => {
			const { container } = render(FormField, { label: 'リマインダー', type: 'time' });
			expect(container.querySelector('input')?.type).toBe('time');
		});
	});

	describe('共通 a11y 配線', () => {
		it('text type でも label/input の for/id が一致する', () => {
			const { container } = render(FormField, {
				label: 'ニックネーム',
				id: 'nick',
			});
			const label = container.querySelector('label');
			const input = container.querySelector('input');
			expect(label?.getAttribute('for')).toBe('nick');
			expect(input?.id).toBe('nick');
		});

		it('id 省略時は label から自動生成される', () => {
			const { container } = render(FormField, { label: 'Display Name' });
			const label = container.querySelector('label');
			const input = container.querySelector('input');
			expect(label?.getAttribute('for')).toBe('field-display-name');
			expect(input?.id).toBe('field-display-name');
		});
	});
});
