// tests/unit/components/primitives/NativeSelect.test.ts
//
// #4729 PO 決定 (2026-09-04): 誕生日を「未設定に戻せる」ようにするため、`NativeSelect` に
// `placeholderSelectable` を足した。**既定挙動 (placeholder = disabled) は全画面で不変**である
// ことをここで固定する — 既定を反転させると、全画面の select が「一度選んだら未選択に戻せる」
// ようになり、必須選択のつもりの入力欄が空で送られる。

import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

const options = [
	{ value: 'a', label: 'A' },
	{ value: 'b', label: 'B' },
];

function placeholderOption(container: HTMLElement): HTMLOptionElement {
	const opt = container.querySelector('option[value=""]');
	if (!opt) throw new Error('placeholder option が描画されていない');
	return opt as HTMLOptionElement;
}

describe('NativeSelect の placeholder option', () => {
	it('既定では選択できない（未選択のまま送らせないための disabled）', () => {
		const { container } = render(NativeSelect, { options, placeholder: '選んでください' });
		expect(placeholderOption(container).disabled).toBe(true);
	});

	it('placeholderSelectable={true} を渡した callsite でだけ選択できる（#4729 opt-in）', () => {
		const { container } = render(NativeSelect, {
			options,
			placeholder: '選んでください',
			placeholderSelectable: true,
		});
		expect(placeholderOption(container).disabled).toBe(false);
	});
});
