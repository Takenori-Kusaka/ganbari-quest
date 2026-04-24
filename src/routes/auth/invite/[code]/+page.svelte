<script lang="ts">
import { APP_LABELS, AUTH_INVITE_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
</script>

<svelte:head>
	<title>{PAGE_TITLES.invite}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="invite-bg min-h-dvh flex items-center justify-center p-4">
	<Card variant="elevated" padding="none" class="w-full max-w-[420px] py-10 px-8">
		{#snippet children()}
		<div class="text-center mb-8">
			<div class="text-5xl mb-2">🏰</div>
			<h1 class="text-2xl font-bold text-[var(--color-neutral-900)] m-0">{AUTH_INVITE_LABELS.appTitle}</h1>
		</div>

		{#if !data.valid}
			<div class="text-center">
				<div class="text-[2.5rem] mb-3">⚠️</div>
				<p class="text-base font-semibold text-[var(--color-danger)] mb-2">{data.error}</p>
				<p class="text-sm text-[var(--color-neutral-500)] mb-6">{AUTH_INVITE_LABELS.invalidLinkDesc}</p>
				<a href="/auth/login" class="invite-button invite-button--error">{AUTH_INVITE_LABELS.loginPageLink}</a>
			</div>
		{:else}
			<div class="mb-7">
				<p class="text-base text-[var(--color-neutral-700)] text-center mb-4 leading-relaxed">
					{AUTH_INVITE_LABELS.inviteMessage}
				</p>
				<div class="flex justify-center gap-2 py-3 px-4 bg-[var(--color-brand-50)] rounded-[var(--radius-sm)]">
					<span class="text-sm text-[var(--color-neutral-500)]">{AUTH_INVITE_LABELS.roleLabel}</span>
					<span class="text-sm font-semibold text-[var(--color-brand-700)]">
						{data.invite.role === 'parent' ? '保護者' : 'こども'}
					</span>
				</div>
			</div>

			<div class="flex flex-col gap-3">
				<a href="/auth/signup" class="invite-button invite-button--primary">
					{AUTH_INVITE_LABELS.signupButton}
				</a>
				<a href="/auth/login" class="invite-button invite-button--secondary">
					{AUTH_INVITE_LABELS.loginButton}
				</a>
			</div>
		{/if}
		{/snippet}
	</Card>
</div>

<style>
	.invite-bg { background: var(--gradient-brand); }
	.invite-button {
		display: block;
		padding: 14px;
		text-align: center;
		font-size: 1rem;
		font-weight: 600;
		border-radius: var(--radius-sm);
		text-decoration: none;
		transition: opacity 0.15s;
	}
	.invite-button:hover { opacity: 0.9; }
	.invite-button--primary {
		background: var(--gradient-brand);
		color: var(--color-text-inverse);
	}
	.invite-button--secondary {
		background: var(--color-surface-card);
		color: var(--color-brand-600);
		border: 2px solid var(--color-brand-600);
	}
	.invite-button--error {
		display: inline-block;
		background: var(--color-brand-600);
		color: var(--color-text-inverse);
		padding: 12px 24px;
	}
</style>
