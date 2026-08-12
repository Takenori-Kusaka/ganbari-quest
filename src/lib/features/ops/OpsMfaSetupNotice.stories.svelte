<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import OpsMfaSetupNotice from './OpsMfaSetupNotice.svelte';

const { Story } = defineMeta({
	title: 'Ops/OpsMfaSetupNotice',
	component: OpsMfaSetupNotice,
	tags: ['autodocs'],
});
</script>

<!-- #4282: /ops が MFA 未設定で 403 になったときの復旧導線 (運営者専用、props なし) -->
<Story name="Default" />
