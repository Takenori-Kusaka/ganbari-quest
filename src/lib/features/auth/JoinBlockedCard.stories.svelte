<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import {
	AUTH_JOIN_LABELS,
	getInviteJoinBlockedMessage,
	INVITE_JOIN_BLOCKED_MESSAGES,
} from '$lib/domain/labels';
import JoinBlockedCard from './JoinBlockedCard.svelte';

const { Story } = defineMeta({
	title: 'Auth/JoinBlockedCard',
	component: JoinBlockedCard,
	tags: ['autodocs'],
	args: { switchAccountHref: '/auth/logout' },
});
</script>

<!--
  #4636: 招待受諾に失敗した人の着地画面。membership 未確定 (AuthUser はあるがテナント無し) は
  local backend では作れない (#3732) ため、拒否理由ごとの見た目は本 story が検証面を担う。
-->

<Story name="EmailMismatch" args={{ message: INVITE_JOIN_BLOCKED_MESSAGES.INVITE_EMAIL_MISMATCH }} />
<Story
	name="EmailUnverified"
	args={{ message: INVITE_JOIN_BLOCKED_MESSAGES.INVITE_EMAIL_UNVERIFIED }}
/>
<Story name="Expired" args={{ message: INVITE_JOIN_BLOCKED_MESSAGES.INVALID_OR_EXPIRED }} />
<Story
	name="TenantUnavailable"
	args={{ message: INVITE_JOIN_BLOCKED_MESSAGES.TENANT_NOT_FOUND }}
/>
<Story name="AlreadyInTenant" args={{ message: INVITE_JOIN_BLOCKED_MESSAGES.ALREADY_IN_TENANT }} />
<Story name="SelfInvite" args={{ message: INVITE_JOIN_BLOCKED_MESSAGES.SELF_INVITE_NOT_ALLOWED }} />
<Story
	name="OwnerDowngrade"
	args={{ message: INVITE_JOIN_BLOCKED_MESSAGES.OWNER_CANNOT_BE_DOWNGRADED }}
/>
<Story name="UnknownReason" args={{ message: getInviteJoinBlockedMessage('SOMETHING_NEW') }} />
<Story name="NoInvite" args={{ message: null }} />
<Story name="Creating" args={{ message: null, creating: true }} />
<Story
	name="CreateFailed"
	args={{ message: INVITE_JOIN_BLOCKED_MESSAGES.INVALID_OR_EXPIRED, createFailed: true }}
/>

<!-- 文言 SSOT を story 側でも参照していることの目印 (未使用 import lint 回避) -->
<p hidden>{AUTH_JOIN_LABELS.createSectionTitle}</p>
