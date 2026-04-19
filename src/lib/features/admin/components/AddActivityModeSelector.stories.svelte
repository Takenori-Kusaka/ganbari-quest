<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import AddActivityModeSelector from './AddActivityModeSelector.svelte';

const { Story } = defineMeta({
	title: 'Admin/AddActivityModeSelector',
	component: AddActivityModeSelector,
	tags: ['autodocs'],
	args: { onselect: () => {} },
});
</script>

<Story name="Default" args={{ onselect: (mode) => alert(`selected: ${mode}`) }} />
