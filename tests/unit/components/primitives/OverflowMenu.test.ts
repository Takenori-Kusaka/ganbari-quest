import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import OverflowMenu from '$lib/ui/primitives/OverflowMenu.svelte';

describe('OverflowMenu', () => {
	const baseItems = [
		{ id: 'marketplace', label: 'みんなのテンプレから取込', icon: '📦', onSelect: vi.fn() },
		{ id: 'ai-suggest', label: 'AI で提案してもらう', icon: '🤖', onSelect: vi.fn() },
		{ id: 'div-1', divider: true },
		{ id: 'restore', label: 'バックアップから復元', icon: '⬇', onSelect: vi.fn() },
		{ id: 'help', label: 'このページのヘルプ', icon: '❓', onSelect: vi.fn() },
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
		const items = [{ id: 'marketplace', label: 'みんなのテンプレから取込', icon: '📦', onSelect }];
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
		const disabledItems = [
			{
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

	it('items props で項目を ON/OFF できる (Open/Closed 原則)', async () => {
		const minimalItems = [
			{ id: 'help', label: 'このページのヘルプ', icon: '❓', onSelect: vi.fn() },
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
