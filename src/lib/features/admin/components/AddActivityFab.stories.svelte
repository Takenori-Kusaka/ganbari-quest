<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import AddActivityFab from './AddActivityFab.svelte';

const { Story } = defineMeta({
	title: 'Admin/AddActivityFab',
	component: AddActivityFab,
	tags: ['autodocs'],
	args: { enabled: true, onclick: () => {} },
});
</script>

<Story name="Enabled" args={{ enabled: true, onclick: () => alert('activity add') }} />
<Story name="Disabled (limit reached)" args={{ enabled: false, onclick: () => {} }} />
