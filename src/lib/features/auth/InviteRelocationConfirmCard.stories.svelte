<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { INVITE_RELOCATION_LABELS } from '$lib/domain/labels';
import InviteRelocationConfirmCard from './InviteRelocationConfirmCard.svelte';

const { Story } = defineMeta({
	title: 'Auth/InviteRelocationConfirmCard',
	component: InviteRelocationConfirmCard,
	tags: ['autodocs'],
	args: { cancelHref: '/admin' },
});
</script>

<!--
  #4642: 別の家族グループへ引っ越すときの確認カード (不可逆操作)。
  この状態は「Cognito ユーザー + 自分ひとりの家族グループ + 有効な招待」が同時に要り、
  local backend では作れない (#3732) ため、見た目の検証は本 story が担う。
-->

<Story name="Default" />
<Story name="AcknowledgeRequired" args={{ errorMessage: INVITE_RELOCATION_LABELS.acknowledgeRequired }} />
<Story name="BlockedHasOtherMembers" args={{ errorMessage: INVITE_RELOCATION_LABELS.blockedHasOtherMembers }} />
<Story name="Submitting" args={{ submitting: true }} />
<Story name="Failed" args={{ errorMessage: INVITE_RELOCATION_LABELS.failed }} />
