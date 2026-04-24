<script lang="ts">
import { enhance } from '$app/forms';
import { APP_LABELS, FORGOT_PASSWORD_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import { PASSWORD_RESET_CODE_EXPIRY_MINUTES } from '$lib/domain/validation/auth';
import Logo from '$lib/ui/components/Logo.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { form } = $props();

let email = $state('');
let codeRaw = $state('');
const code = $derived(codeRaw.replace(/\s/g, ''));
let newPassword = $state('');
let newPasswordConfirm = $state('');
let loading = $state(false);

let confirmStep = $derived(form?.confirmStep ?? false);

// Restore email from server response
$effect(() => {
	if (typeof form?.email === 'string') email = form.email;
});
</script>

<svelte:head>
	<title>{PAGE_TITLES.forgotPassword}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="min-h-dvh flex items-center justify-center bg-[var(--gradient-brand)] p-4">
	<Card padding="none" class="w-full max-w-[400px] px-8 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
		{#snippet children()}
		<div class="text-center mb-8">
			<Logo variant="full" size={320} />
			<p class="text-sm text-[var(--color-text-muted)] mt-2 font-semibold">{FORGOT_PASSWORD_LABELS.pageSubtitle}</p>
		</div>

		{#if form?.error}
			<div class="mb-4 p-3 bg-[var(--color-danger-50)] text-[var(--color-danger-600)] border border-[var(--color-danger-200)] rounded-[var(--radius-sm)] text-sm" role="alert">
				{form.error}
			</div>
		{/if}

		{#if confirmStep}
			<!-- Step 2: Verification code + new password -->
			<form
				method="POST"
				action="?/confirmReset"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						loading = false;
						await update();
					};
				}}
				class="flex flex-col gap-5"
			>
				<input type="hidden" name="email" value={email} />

				<p class="text-sm text-[var(--color-text-muted)] text-center leading-relaxed">
					<strong>{email}</strong> {FORGOT_PASSWORD_LABELS.step2ConfirmSentPrefix}<br />
					{FORGOT_PASSWORD_LABELS.step2ConfirmEnterInstruction}
				</p>

				<p class="text-xs text-[var(--color-text-muted)] text-center">
					{FORGOT_PASSWORD_LABELS.step2CodeExpiryPrefix}{PASSWORD_RESET_CODE_EXPIRY_MINUTES}{FORGOT_PASSWORD_LABELS.step2CodeExpirySuffix}
				</p>

				<FormField label="確認コード" id="code">
					{#snippet children()}
						<input
							id="code"
							name="code"
							type="text"
							bind:value={codeRaw}
							placeholder="123456"
							required
							inputmode="numeric"
							autocomplete="one-time-code"
							class="px-4 py-3 border border-[var(--input-border)] rounded-[var(--input-radius)] text-2xl text-center tracking-[0.5em] font-mono
								focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--color-brand-300)] focus:ring-opacity-50 outline-none transition-colors"
						/>
					{/snippet}
				</FormField>

				<FormField
					label="新しいパスワード"
					type="password"
					id="newPassword"
					name="newPassword"
					bind:value={newPassword}
					placeholder="8文字以上（大小英字・数字を含む）"
					required
					minlength={8}
					autocomplete="new-password"
					showToggle
					hint="8文字以上、大文字・小文字・数字を含む"
				/>

				<FormField
					label="新しいパスワード（確認）"
					type="password"
					id="newPasswordConfirm"
					name="newPasswordConfirm"
					bind:value={newPasswordConfirm}
					placeholder="パスワードを再入力"
					required
					minlength={8}
					autocomplete="new-password"
					showToggle
					error={newPasswordConfirm && newPassword !== newPasswordConfirm ? 'パスワードが一致しません' : undefined}
					hint={newPasswordConfirm && newPassword === newPasswordConfirm ? 'パスワードが一致しました' : undefined}
				/>

				<Button type="submit" disabled={loading || code.length < 1 || !newPassword || !newPasswordConfirm} size="md" class="w-full">
					{#if loading}
						<span class="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" aria-hidden="true"></span>
						{FORGOT_PASSWORD_LABELS.resettingLabel}
					{:else}
						{FORGOT_PASSWORD_LABELS.resetButton}
					{/if}
				</Button>
			</form>
		{:else}
			<!-- Step 1: Email input -->
			<form
				method="POST"
				action="?/requestReset"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						loading = false;
						await update();
					};
				}}
				class="flex flex-col gap-5"
			>
				<p class="text-sm text-[var(--color-text-muted)] text-center leading-relaxed">
					{FORGOT_PASSWORD_LABELS.step1Instruction1}<br />
					{FORGOT_PASSWORD_LABELS.step1Instruction2}
				</p>

				<FormField
					label="メールアドレス"
					type="email"
					id="email"
					name="email"
					bind:value={email}
					placeholder="example@email.com"
					required
					autocomplete="email"
				/>

				<Button type="submit" disabled={loading || !email} size="md" class="w-full">
					{#if loading}
						<span class="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" aria-hidden="true"></span>
						{FORGOT_PASSWORD_LABELS.sendingLabel}
					{:else}
						{FORGOT_PASSWORD_LABELS.sendButton}
					{/if}
				</Button>
			</form>
		{/if}

		<div class="mt-5 text-center">
			<a href="/auth/login" class="text-sm text-[var(--color-text-link)] hover:underline">
				{FORGOT_PASSWORD_LABELS.backToLoginLink}
			</a>
		</div>
		{/snippet}
	</Card>
</div>
