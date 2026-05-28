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
		// #2558 段階2: restore (バックアップから復元) + copy/bulk 統合に伴う新規 props
		onRestore: () => {},
		canCopyFromChild: true,
	},
});
</script>

<Story name="Default" />
<Story name="Clear confirm open (clear-all hidden from overflow)" args={{ clearConfirmOpen: true }} />
<Story name="Add disabled (limit reached)" args={{ canAdd: false }} />
<Story name="Single child (copy item hidden)" args={{ canCopyFromChild: false }} />
