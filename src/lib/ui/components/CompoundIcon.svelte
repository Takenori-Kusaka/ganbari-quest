<script lang="ts">
	import { splitIcon } from '$lib/domain/icon-utils';

	interface Props {
		icon: string;
		size?: 'sm' | 'md' | 'lg' | 'xl';
		faded?: boolean;
	}

	let { icon, size = 'lg', faded = false }: Props = $props();

	const parsed = $derived(splitIcon(icon));

	const sizeMap = {
		sm: { main: 'text-lg', sub: 'text-[8px]', badge: 'w-3.5 h-3.5 -bottom-0.5 -right-0.5' },
		md: { main: 'text-xl', sub: 'text-[10px]', badge: 'w-4 h-4 -bottom-0.5 -right-0.5' },
		lg: { main: 'text-3xl', sub: 'text-xs', badge: 'w-5 h-5 -bottom-1 -right-1' },
		xl: { main: 'text-5xl', sub: 'text-sm', badge: 'w-6 h-6 -bottom-1 -right-1' },
	};

	const classes = $derived(sizeMap[size]);
</script>

<span class="relative inline-flex items-center justify-center {faded ? 'opacity-40' : ''}" aria-hidden="true">
	<span class={classes.main}>{parsed.main}</span>
	{#if parsed.sub}
		<span class="absolute {classes.badge} flex items-center justify-center bg-white rounded-full shadow-sm border border-gray-200">
			<span class={classes.sub}>{parsed.sub}</span>
		</span>
	{/if}
</span>
