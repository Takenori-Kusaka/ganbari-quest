<script lang="ts">
import { Tabs as ArkTabs } from '@ark-ui/svelte/tabs';
import type { Snippet } from 'svelte';

interface TabItem {
	value: string;
	label: string;
}

interface Props {
	items: TabItem[];
	value?: string;
	onValueChange?: (details: { value: string }) => void;
	/**
	 * Ark UI Tabs.Root の render strategy。
	 * - lazyMount=true: 初回アクティブ化まで Content を mount しない
	 * - unmountOnExit=true: 非アクティブ化時に Content を unmount する
	 * 既定 false (Ark UI default、全 panel 並列 mount + display:none で隠蔽)。
	 * 同一 reward 等が全 panel に並列存在することで Playwright strict mode が
	 * 多重 match する場合は両方 true を指定する (#2157)。
	 */
	lazyMount?: boolean;
	unmountOnExit?: boolean;
	children: Snippet<[string]>;
}

let {
	items,
	value = $bindable(items[0]?.value ?? ''),
	onValueChange,
	lazyMount = false,
	unmountOnExit = false,
	children,
}: Props = $props();

function handleValueChange(details: { value: string }) {
	value = details.value;
	onValueChange?.(details);
}
</script>

<ArkTabs.Root {value} onValueChange={handleValueChange} {lazyMount} {unmountOnExit}>
	<ArkTabs.List
		class="flex gap-1 bg-[var(--theme-nav)] rounded-[var(--radius-md)] p-1"
	>
		{#each items as item (item.value)}
			<ArkTabs.Trigger
				value={item.value}
				data-testid="tab-{item.value}"
				class="tap-target flex-1 px-3 py-2 rounded-[var(--radius-sm)] text-sm font-bold text-center
					transition-colors data-[selected]:bg-white data-[selected]:text-[var(--theme-primary)]
					data-[selected]:shadow-sm text-[var(--color-text-muted)]"
			>
				{item.label}
			</ArkTabs.Trigger>
		{/each}
		<ArkTabs.Indicator class="hidden" />
	</ArkTabs.List>

	{#each items as item (item.value)}
		<ArkTabs.Content value={item.value} class="mt-[var(--sp-md)]">
			{@render children(item.value)}
		</ArkTabs.Content>
	{/each}
</ArkTabs.Root>
