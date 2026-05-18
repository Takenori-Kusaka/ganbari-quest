<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import ActivitiesHeader from './ActivitiesHeader.svelte';

const { Story } = defineMeta({
	title: 'Admin/ActivitiesHeader',
	component: ActivitiesHeader,
	tags: ['autodocs'],
	args: {
		clearConfirmOpen: false,
		onClearAll: () => {},
		canAdd: true,
		onAddSelect: () => {},
	},
});
</script>

<Story name="Default" />
<Story name="Clear confirm open (clear-all hidden from overflow)" args={{ clearConfirmOpen: true }} />
<Story name="Add disabled (limit reached)" args={{ canAdd: false }} />
