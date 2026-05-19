<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import ActivityEmptyState from './ActivityEmptyState.svelte';

const { Story } = defineMeta({
	title: 'Admin/ActivityEmptyState',
	component: ActivityEmptyState,
	tags: ['autodocs'],
	args: { hasFilter: false, canAdd: true, onAdd: () => {} },
});
</script>

<!-- EPIC #2253 / #2256: primary CTA + secondary import link 2 段構成 -->
<Story
	name="No activities - 2 layer CTA (primary + import bridge)"
	args={{ hasFilter: false, canAdd: true, onAdd: (mode) => alert(`mode=${mode}`) }}
/>
<Story
	name="No activities - cannot add (limit)"
	args={{ hasFilter: false, canAdd: false, onAdd: () => {} }}
/>
<Story
	name="Filter result empty (primary only, no import link)"
	args={{ hasFilter: true, canAdd: true, onAdd: (mode) => alert(`mode=${mode}`) }}
/>
