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

<Story name="No activities - can add" args={{ hasFilter: false, canAdd: true, onAdd: () => alert('追加') }} />
<Story name="No activities - cannot add (limit)" args={{ hasFilter: false, canAdd: false, onAdd: () => {} }} />
<Story name="Filter result empty" args={{ hasFilter: true, canAdd: true, onAdd: () => alert('追加') }} />
