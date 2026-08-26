<script lang="ts">
import { onDestroy } from 'svelte';
import { enhance } from '$app/forms';
import { APP_LABELS, FORGOT_PASSWORD_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import { PASSWORD_RESET_CODE_EXPIRY_MINUTES } from '$lib/domain/validation/auth';
import GoogleAccountNotice from '$lib/ui/components/GoogleAccountNotice.svelte';
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

// #4702: step 2 の再送 (login 画面の resendFromLogin と同じ 60 秒 cooldown)。
// 「届かない場合は再送してください」と書きながら再送手段が無い dead-end を解消する。
let resending = $state(false);
let resendCooldown = $state(0);
let resendSuccess = $state(false);
let initialCooldownStarted = $state(false);
let cooldownTimer: ReturnType<typeof setInterval> | null = null;
let messageTimeout: ReturnType<typeof setTimeout> | null = null;

onDestroy(() => {
	if (cooldownTimer) clearInterval(cooldownTimer);
	if (messageTimeout) clearTimeout(messageTimeout);
});

function startCooldown() {
	resendCooldown = 60;
	if (cooldownTimer) clearInterval(cooldownTimer);
	cooldownTimer = setInterval(() => {
		resendCooldown -= 1;
		if (resendCooldown <= 0) {
			resendCooldown = 0;
			if (cooldownTimer) {
				clearInterval(cooldownTimer);
				cooldownTimer = null;
			}
		}
	}, 1000);
}

// 再送成功 (server が resent を返す) で cooldown 開始 + 3 秒で通知を消す
$effect(() => {
	if (form && 'resent' in form && form.resent) {
		resendSuccess = true;
		startCooldown();
		if (messageTimeout) clearTimeout(messageTimeout);
		messageTimeout = setTimeout(() => {
			resendSuccess = false;
		}, 3000);
	}
});

// 初回にコードを送った直後も cooldown を開始する (連打で Cognito の LimitExceeded を踏ませない)。
// one-shot 化 (#4748): resendCooldown を条件に読むと startCooldown() 自身がその値を書き換えるため
// 60 秒ごとに自己再トリガする無限ループになる。confirmStep の false→true 遷移で 1 回だけ発火させる。
$effect(() => {
	if (confirmStep && !initialCooldownStarted) {
		initialCooldownStarted = true;
		startCooldown();
	}
});

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

		<!-- #4702: Google 登録の顧客には Cognito にパスワードが無く、リセットコードも届かない。
		     Cognito はアカウントの存在を伏せる仕様のため、step 1 / 2 とも全員に常時案内する -->
		<GoogleAccountNotice class="mb-4" />

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

			{#if resendSuccess}
				<div class="mt-3 p-3 bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)] border border-[var(--color-feedback-success-border)] rounded-[var(--radius-sm)] text-sm text-center" role="status" data-testid="forgot-password-resend-success">
					{FORGOT_PASSWORD_LABELS.step2ResendSuccess}
				</div>
			{/if}

			<!-- #4702: 確認コード再送 (文言と操作の一致)。requestReset を再実行して新しいコードを送る -->
			<form
				method="POST"
				action="?/requestReset"
				use:enhance={() => {
					resending = true;
					return async ({ update }) => {
						resending = false;
						await update({ reset: false });
					};
				}}
				class="mt-4 text-center"
			>
				<input type="hidden" name="email" value={email} />
				<input type="hidden" name="resend" value="1" />
				<Button
					type="submit"
					variant="ghost"
					size="sm"
					disabled={resending || resendCooldown > 0}
					data-testid="forgot-password-resend"
				>
					{#if resending}
						{FORGOT_PASSWORD_LABELS.step2ResendLoading}
					{:else if resendCooldown > 0}
						{FORGOT_PASSWORD_LABELS.step2ResendCooldown(resendCooldown)}
					{:else}
						{FORGOT_PASSWORD_LABELS.step2ResendButton}
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
