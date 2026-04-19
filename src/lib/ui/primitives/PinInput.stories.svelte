<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import PinInput from './PinInput.svelte';

const { Story } = defineMeta({
	title: 'Primitives/PinInput',
	component: PinInput,
	tags: ['autodocs'],
	args: {
		length: 6,
		mask: true,
	},
});
</script>

<Story name="Default" args={{ length: 6, mask: true }} />

<Story name="Unmasked" args={{ length: 6, mask: false }} />

<Story name="Length4" args={{ length: 4, mask: true }} />
