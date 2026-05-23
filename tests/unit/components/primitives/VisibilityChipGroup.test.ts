import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import VisibilityChipGroup from '$lib/ui/primitives/VisibilityChipGroup.svelte';

describe('VisibilityChipGroup', () => {
	const threeChildren = [
		{ id: 1, nickname: 'たろう', age: 8, icon: '👦' },
		{ id: 2, nickname: 'ひな', age: 5, icon: '👧' },
		{ id: 3, nickname: 'けんた', age: 1, icon: '👶' },
	];

	it('section title が表示される', () => {
		const { getByText } = render(VisibilityChipGroup, {
			props: {
				children: threeChildren,
				visibility: { 1: true, 2: true, 3: true },
				onToggle: vi.fn(),
			},
		});
		expect(getByText('配信するお子さま')).toBeTruthy();
	});

	it('group は role="group" + aria-label を持つ (a11y)', () => {
		const { getByRole } = render(VisibilityChipGroup, {
			props: {
				children: threeChildren,
				visibility: { 1: true, 2: true, 3: true },
				onToggle: vi.fn(),
			},
		});
		const group = getByRole('group', { name: '配信お子さま選択' });
		expect(group).toBeTruthy();
	});

	it('visibility=true の chip は aria-pressed=true', () => {
		const { getByTestId } = render(VisibilityChipGroup, {
			props: {
				children: threeChildren,
				visibility: { 1: true, 2: false, 3: true },
				onToggle: vi.fn(),
			},
		});
		expect(getByTestId('visibility-chip-1').getAttribute('aria-pressed')).toBe('true');
		expect(getByTestId('visibility-chip-2').getAttribute('aria-pressed')).toBe('false');
	});

	it('未定義キーの child は ON 扱い (default ON)', () => {
		const { getByTestId } = render(VisibilityChipGroup, {
			props: {
				children: threeChildren,
				visibility: {}, // 全て未定義
				onToggle: vi.fn(),
			},
		});
		expect(getByTestId('visibility-chip-1').getAttribute('aria-pressed')).toBe('true');
		expect(getByTestId('visibility-chip-2').getAttribute('aria-pressed')).toBe('true');
	});

	it('chip クリックで onToggle が呼ばれる (ON → OFF)', async () => {
		const onToggle = vi.fn();
		const { getByTestId } = render(VisibilityChipGroup, {
			props: {
				children: threeChildren,
				visibility: { 1: true, 2: true, 3: true },
				onToggle,
			},
		});
		await fireEvent.click(getByTestId('visibility-chip-1'));
		expect(onToggle).toHaveBeenCalledWith(1, false);
	});

	it('OFF の chip クリックで onToggle(true) (OFF → ON)', async () => {
		const onToggle = vi.fn();
		const { getByTestId } = render(VisibilityChipGroup, {
			props: {
				children: threeChildren,
				visibility: { 1: false, 2: true, 3: true },
				onToggle,
			},
		});
		await fireEvent.click(getByTestId('visibility-chip-1'));
		expect(onToggle).toHaveBeenCalledWith(1, true);
	});

	it('「全員 ON」ボタンクリックで OFF の child に対し onToggle(true) が呼ばれる', async () => {
		const onToggle = vi.fn();
		const { getByTestId } = render(VisibilityChipGroup, {
			props: {
				children: threeChildren,
				visibility: { 1: true, 2: false, 3: false },
				onToggle,
			},
		});
		await fireEvent.click(getByTestId('visibility-shortcut-all-on'));
		// 2 / 3 が OFF だったので 2 回呼ばれる
		expect(onToggle).toHaveBeenCalledWith(2, true);
		expect(onToggle).toHaveBeenCalledWith(3, true);
		expect(onToggle).toHaveBeenCalledTimes(2);
	});

	it('「全員 OFF」ボタンクリックで ON の child に対し onToggle(false) が呼ばれる', async () => {
		const onToggle = vi.fn();
		const { getByTestId } = render(VisibilityChipGroup, {
			props: {
				children: threeChildren,
				visibility: { 1: true, 2: true, 3: false },
				onToggle,
			},
		});
		await fireEvent.click(getByTestId('visibility-shortcut-all-off'));
		expect(onToggle).toHaveBeenCalledWith(1, false);
		expect(onToggle).toHaveBeenCalledWith(2, false);
		expect(onToggle).toHaveBeenCalledTimes(2);
	});

	it('全員 ON 状態で「全員 ON」ボタンは disabled', () => {
		const { getByTestId } = render(VisibilityChipGroup, {
			props: {
				children: threeChildren,
				visibility: { 1: true, 2: true, 3: true },
				onToggle: vi.fn(),
			},
		});
		const allOnBtn = getByTestId('visibility-shortcut-all-on') as HTMLButtonElement;
		expect(allOnBtn.disabled).toBe(true);
	});

	it('showShortcuts=false で全員 ON/OFF ボタンが非表示', () => {
		const { queryByTestId } = render(VisibilityChipGroup, {
			props: {
				children: threeChildren,
				visibility: { 1: true, 2: true, 3: true },
				onToggle: vi.fn(),
				showShortcuts: false,
			},
		});
		expect(queryByTestId('visibility-shortcut-all-on')).toBeNull();
		expect(queryByTestId('visibility-shortcut-all-off')).toBeNull();
	});

	it('child が 1 人のみのとき shortcuts は非表示', () => {
		const singleChild = threeChildren.slice(0, 1);
		const { queryByTestId } = render(VisibilityChipGroup, {
			props: {
				children: singleChild,
				visibility: { 1: true },
				onToggle: vi.fn(),
			},
		});
		expect(queryByTestId('visibility-shortcut-all-on')).toBeNull();
	});

	it('chip の aria-label に状態 (表示/非表示) が含まれる', () => {
		const { getByTestId } = render(VisibilityChipGroup, {
			props: {
				children: threeChildren,
				visibility: { 1: true, 2: false, 3: true },
				onToggle: vi.fn(),
			},
		});
		expect(getByTestId('visibility-chip-1').getAttribute('aria-label')).toContain('表示');
		expect(getByTestId('visibility-chip-2').getAttribute('aria-label')).toContain('非表示');
	});
});
