<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import Divider from './Divider.svelte';

const { Story } = defineMeta({
	title: 'Primitives/Divider',
	component: Divider,
	tags: ['autodocs'],
	argTypes: {
		label: { control: 'text' },
		spacing: { control: 'select', options: ['sm', 'md', 'lg'] },
	},
});
</script>

<Story name="Simple" args={{ spacing: 'md' }} />
<Story name="WithLabel" args={{ label: STORYBOOK_LABELS.divider.labelOr, spacing: 'md' }} />
<Story name="SmallSpacing" args={{ spacing: 'sm' }} />
<Story name="LargeSpacing" args={{ spacing: 'lg' }} />
