<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import ActivitiesHeader from './ActivitiesHeader.svelte';

const { Story } = defineMeta({
	title: 'Admin/ActivitiesHeader',
	component: ActivitiesHeader,
	tags: ['autodocs'],
	args: { clearConfirmOpen: false, onClearAll: () => {} },
});
</script>

<Story name="Default" args={{ clearConfirmOpen: false, onClearAll: () => alert('全削除確認') }} />
<Story name="Clear confirm open (delete btn hidden)" args={{ clearConfirmOpen: true, onClearAll: () => {} }} />
