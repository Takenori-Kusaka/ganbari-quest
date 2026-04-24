<script lang="ts">
import type { HTMLAttributes } from 'svelte/elements';

interface Props extends HTMLAttributes<HTMLElement> {
	/** Optional label text shown in the middle of the divider */
	label?: string;
	spacing?: 'sm' | 'md' | 'lg';
}

let { label, spacing = 'md', class: className = '', ...rest }: Props = $props();

const spacingClasses: Record<string, string> = {
	sm: 'my-2',
	md: 'my-4',
	lg: 'my-6',
};
</script>

{#if label}
	<div
		class="flex items-center gap-3 {spacingClasses[spacing]} {className}"
		role="separator"
		{...rest}
	>
		<hr class="flex-1 border-[var(--color-border-default)]" />
		<span class="text-xs text-[var(--color-text-muted)] font-medium shrink-0">{label}</span>
		<hr class="flex-1 border-[var(--color-border-default)]" />
	</div>
{:else}
	<hr
		class="border-[var(--color-border-default)] {spacingClasses[spacing]} {className}"
		{...rest}
	/>
{/if}
