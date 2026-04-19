<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import ActivityLimitBanner from './ActivityLimitBanner.svelte';

const { Story } = defineMeta({
	title: 'Admin/ActivityLimitBanner',
	component: ActivityLimitBanner,
	tags: ['autodocs'],
	args: { current: 30, max: 30 },
});
</script>

<Story name="Free plan limit reached" args={{ current: 30, max: 30 }} />
<Story name="Standard plan limit reached" args={{ current: 300, max: 300 }} />
<Story name="Near limit" args={{ current: 28, max: 30 }} />
