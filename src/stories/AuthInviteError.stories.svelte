<script module>
// #4049: 招待受付画面 (/auth/invite/[code]) のエラー状態を視認するための story。
// 招待 (invites) は local backend で起動できない (#3732) ため、実サーバでは
// この画面を描画できない。load が返す data をそのまま渡して見た目を確認する。
import { defineMeta } from '@storybook/addon-svelte-csf';
import { AUTH_INVITE_LABELS } from '$lib/domain/labels';
import InvitePage from '../routes/auth/invite/[code]/+page.svelte';

const { Story } = defineMeta({
	title: 'Pages/AuthInviteError',
	component: InvitePage,
	parameters: { layout: 'fullscreen' },
});
</script>

<!-- 修正前の load 出力 (errorDesc 未設定 = 再発行案内にフォールバック / 出口はログインのみ) -->
<Story
	name="AlreadyInTenantLegacy"
	args={{
		data: {
			valid: false,
			error: AUTH_INVITE_LABELS.alreadyInTenant,
			errorDesc: undefined,
		},
	}}
/>

<!-- 修正後: 専用の説明文 + ログアウト導線 -->
<Story
	name="AlreadyInTenant"
	args={{
		data: {
			valid: false,
			error: AUTH_INVITE_LABELS.alreadyInTenant,
			errorDesc: AUTH_INVITE_LABELS.alreadyInTenantDesc,
			sessionActive: true,
		},
	}}
/>

<Story
	name="EmailMismatch"
	args={{
		data: {
			valid: false,
			error: AUTH_INVITE_LABELS.emailMismatch,
			errorDesc: AUTH_INVITE_LABELS.emailMismatchDesc,
			sessionActive: true,
		},
	}}
/>

<Story
	name="InvalidLink"
	args={{
		data: {
			valid: false,
			error: AUTH_INVITE_LABELS.invalidLink,
			errorDesc: AUTH_INVITE_LABELS.invalidLinkDesc,
			sessionActive: false,
		},
	}}
/>
