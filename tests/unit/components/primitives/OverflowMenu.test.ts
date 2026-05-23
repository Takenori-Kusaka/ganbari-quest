import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import OverflowMenu, { type OverflowMenuItem } from '$lib/ui/primitives/OverflowMenu.svelte';

describe('OverflowMenu', () => {
	const baseItems: OverflowMenuItem[] = [
		{
			type: 'action',
			id: 'marketplace',
			label: 'みんなのテンプレから取込',
			icon: '📦',
			onSelect: vi.fn(),
		},
		{
			type: 'action',
			id: 'ai-suggest',
			label: 'AI で提案してもらう',
			icon: '🤖',
			onSelect: vi.fn(),
		},
		{ type: 'divider', id: 'div-1' },
		{
			type: 'action',
			id: 'restore',
			label: 'バックアップから復元',
			icon: '⬇',
			onSelect: vi.fn(),
		},
		{ type: 'action', id: 'help', label: 'このページのヘルプ', icon: '❓', onSelect: vi.fn() },
	];

	it('trigger button が aria-label を持つ', () => {
		const { getByRole } = render(OverflowMenu, {
			props: { items: baseItems, ariaLabel: 'メニューを開く' },
		});
		const trigger = getByRole('button', { name: 'メニューを開く' });
		expect(trigger).toBeTruthy();
	});

	it('trigger に testid が付与される', () => {
		const { container } = render(OverflowMenu, {
			props: { items: baseItems, ariaLabel: 'メニューを開く', testid: 'admin-overflow' },
		});
		expect(container.querySelector('[data-testid="admin-overflow"]')).toBeTruthy();
	});

	it('disabled prop で trigger button が無効化される', () => {
		const { container } = render(OverflowMenu, {
			props: { items: baseItems, ariaLabel: 'メニューを開く', disabled: true },
		});
		const trigger = container.querySelector('button.overflow-menu-trigger') as HTMLButtonElement;
		expect(trigger.disabled).toBe(true);
	});

	it('trigger をクリックすると menu が開く', async () => {
		const { container, findByText } = render(OverflowMenu, {
			props: { items: baseItems, ariaLabel: 'メニューを開く' },
		});
		const trigger = container.querySelector('button.overflow-menu-trigger') as HTMLButtonElement;
		await fireEvent.click(trigger);
		const item = await findByText('みんなのテンプレから取込');
		expect(item).toBeTruthy();
	});

	it('menu item をクリックすると onSelect が呼ばれる', async () => {
		const onSelect = vi.fn();
		const items: OverflowMenuItem[] = [
			{
				type: 'action',
				id: 'marketplace',
				label: 'みんなのテンプレから取込',
				icon: '📦',
				onSelect,
			},
		];
		const { container, findByTestId } = render(OverflowMenu, {
			props: { items, ariaLabel: 'メニューを開く' },
		});
		const trigger = container.querySelector('button.overflow-menu-trigger') as HTMLButtonElement;
		await fireEvent.click(trigger);
		const menuItem = await findByTestId('overflow-menu-item-marketplace');
		// Ark UI Menu Item は pointerdown / pointerup シーケンスで select が dispatch される設計
		// (jsdom 環境では click event 単独では発火しないため pointer event を明示)
		await fireEvent.pointerDown(menuItem);
		await fireEvent.pointerUp(menuItem);
		await fireEvent.click(menuItem);
		expect(onSelect).toHaveBeenCalledTimes(1);
	});

	it('divider 項目は role="separator" として描画される', async () => {
		const { container, findAllByRole } = render(OverflowMenu, {
			props: { items: baseItems, ariaLabel: 'メニューを開く' },
		});
		const trigger = container.querySelector('button.overflow-menu-trigger') as HTMLButtonElement;
		await fireEvent.click(trigger);
		const separators = await findAllByRole('separator', { hidden: true });
		expect(separators.length).toBeGreaterThanOrEqual(1);
	});

	it('disabled な menu item は data-disabled 属性を持つ', async () => {
		const disabledItems: OverflowMenuItem[] = [
			{
				type: 'action',
				id: 'marketplace',
				label: 'みんなのテンプレから取込',
				icon: '📦',
				onSelect: vi.fn(),
				disabled: true,
			},
		];
		const { container, findByText } = render(OverflowMenu, {
			props: { items: disabledItems, ariaLabel: 'メニューを開く' },
		});
		const trigger = container.querySelector('button.overflow-menu-trigger') as HTMLButtonElement;
		await fireEvent.click(trigger);
		const item = await findByText('みんなのテンプレから取込');
		const menuItem = item.closest('[data-testid="overflow-menu-item-marketplace"]');
		expect(menuItem?.getAttribute('data-disabled')).not.toBeNull();
	});

	it('OverflowMenuItem discriminated union: divider item は label / onSelect を持たない (型レベル narrowing)', () => {
		// QM Re-Review (2026-05-23): silent skip 防止のため discriminated union 化
		// この test は実行時 narrowing も検証する。コンパイル時 narrowing は
		// `tsc --noEmit` (svelte-check) で別途検証される。
		//
		// mixed 配列で型 narrowing が機能することを確認する (実利用パターン整合)。
		const items: OverflowMenuItem[] = [
			{ type: 'divider', id: 'div-1' },
			{ type: 'action', id: 'act', label: 'A', onSelect: vi.fn() },
		];
		for (const item of items) {
			if (item.type === 'divider') {
				// narrowing: divider item は label / onSelect プロパティを持たない
				// @ts-expect-error — divider item に label プロパティは存在しない
				expect(item.label).toBeUndefined();
				// @ts-expect-error — divider item に onSelect プロパティは存在しない
				expect(item.onSelect).toBeUndefined();
			} else {
				// narrowing: action item は label / onSelect を持つ (TS が認識)
				expect(item.label).toBeDefined();
				expect(item.onSelect).toBeDefined();
			}
		}
	});

	it('items props で項目を ON/OFF できる (Open/Closed 原則)', async () => {
		const minimalItems: OverflowMenuItem[] = [
			{ type: 'action', id: 'help', label: 'このページのヘルプ', icon: '❓', onSelect: vi.fn() },
		];
		const { container, findByText, queryByText } = render(OverflowMenu, {
			props: { items: minimalItems, ariaLabel: 'メニューを開く' },
		});
		const trigger = container.querySelector('button.overflow-menu-trigger') as HTMLButtonElement;
		await fireEvent.click(trigger);
		await findByText('このページのヘルプ');
		expect(queryByText('みんなのテンプレから取込')).toBeNull();
	});
});
