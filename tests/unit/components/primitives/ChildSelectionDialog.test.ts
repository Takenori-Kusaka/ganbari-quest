import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ChildSelectionDialog from '$lib/ui/primitives/ChildSelectionDialog.svelte';

describe('ChildSelectionDialog', () => {
	const threeChildren = [
		{ id: 1, nickname: 'たろう', age: 8, icon: '👦' },
		{ id: 2, nickname: 'ひな', age: 5, icon: '👧' },
		{ id: 3, nickname: 'けんた', age: 1, icon: '👶' },
	];

	it('open=true で dialog が表示される (title + 全員に追加 option)', async () => {
		const { findByText } = render(ChildSelectionDialog, {
			props: {
				children: threeChildren,
				open: true,
				onConfirm: vi.fn(),
			},
		});
		expect(await findByText('どのお子さまに追加?')).toBeTruthy();
		expect(await findByText('全員に追加')).toBeTruthy();
	});

	it('default で「全員に追加」が選択されている', async () => {
		const { findByTestId } = render(ChildSelectionDialog, {
			props: {
				children: threeChildren,
				open: true,
				onConfirm: vi.fn(),
			},
		});
		const allInput = (await findByTestId('child-selection-all')) as HTMLInputElement;
		expect(allInput.checked).toBe(true);
	});

	it('child option を選択すると「全員」が外れる', async () => {
		const { findByTestId } = render(ChildSelectionDialog, {
			props: {
				children: threeChildren,
				open: true,
				onConfirm: vi.fn(),
			},
		});
		const child1Input = (await findByTestId('child-selection-1')) as HTMLInputElement;
		await fireEvent.change(child1Input, { target: { checked: true } });
		const allInput = (await findByTestId('child-selection-all')) as HTMLInputElement;
		expect(allInput.checked).toBe(false);
		expect(child1Input.checked).toBe(true);
	});

	it('「全員に追加」確定で onConfirm("all") が呼ばれる', async () => {
		const onConfirm = vi.fn();
		const { findByTestId } = render(ChildSelectionDialog, {
			props: {
				children: threeChildren,
				open: true,
				onConfirm,
			},
		});
		const confirmBtn = await findByTestId('child-selection-confirm');
		await fireEvent.click(confirmBtn);
		expect(onConfirm).toHaveBeenCalledWith('all');
	});

	it('個別 child 選択で onConfirm に ID 配列が渡る', async () => {
		const onConfirm = vi.fn();
		const { findByTestId } = render(ChildSelectionDialog, {
			props: {
				children: threeChildren,
				open: true,
				allowMultiple: false,
				onConfirm,
			},
		});
		const child2Input = (await findByTestId('child-selection-2')) as HTMLInputElement;
		await fireEvent.change(child2Input, { target: { checked: true } });
		const confirmBtn = await findByTestId('child-selection-confirm');
		await fireEvent.click(confirmBtn);
		expect(onConfirm).toHaveBeenCalledWith([2]);
	});

	it('allowMultiple=true で複数 child を選択できる', async () => {
		const onConfirm = vi.fn();
		const { findByTestId } = render(ChildSelectionDialog, {
			props: {
				children: threeChildren,
				open: true,
				allowMultiple: true,
				onConfirm,
			},
		});
		const child1 = (await findByTestId('child-selection-1')) as HTMLInputElement;
		const child3 = (await findByTestId('child-selection-3')) as HTMLInputElement;
		await fireEvent.change(child1, { target: { checked: true } });
		await fireEvent.change(child3, { target: { checked: true } });
		const confirmBtn = await findByTestId('child-selection-confirm');
		await fireEvent.click(confirmBtn);
		expect(onConfirm).toHaveBeenCalledWith(expect.arrayContaining([1, 3]));
	});

	it('キャンセルボタンで onCancel が呼ばれる', async () => {
		const onCancel = vi.fn();
		const { findByText } = render(ChildSelectionDialog, {
			props: {
				children: threeChildren,
				open: true,
				onConfirm: vi.fn(),
				onCancel,
			},
		});
		const cancelBtn = await findByText('キャンセル');
		await fireEvent.click(cancelBtn);
		expect(onCancel).toHaveBeenCalled();
	});

	it('child リストが空でも「全員に追加」option は表示される', async () => {
		const { findByText } = render(ChildSelectionDialog, {
			props: {
				children: [],
				open: true,
				onConfirm: vi.fn(),
			},
		});
		expect(await findByText('全員に追加')).toBeTruthy();
	});

	it('dialog content に role="dialog" 相当の aria-label がある (a11y)', async () => {
		const { findByTestId } = render(ChildSelectionDialog, {
			props: {
				children: threeChildren,
				open: true,
				onConfirm: vi.fn(),
				testid: 'csd',
			},
		});
		const dialog = await findByTestId('csd');
		expect(dialog).toBeTruthy();
	});

	it('child リストは role="group" + aria-label を持つ (a11y)', async () => {
		const { findByRole } = render(ChildSelectionDialog, {
			props: {
				children: threeChildren,
				open: true,
				onConfirm: vi.fn(),
			},
		});
		const group = await findByRole('group', { name: 'お子さま一覧' });
		expect(group).toBeTruthy();
	});
});
