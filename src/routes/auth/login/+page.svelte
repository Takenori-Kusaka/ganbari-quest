<script lang="ts">
import { onDestroy } from 'svelte';
import { enhance } from '$app/forms';
import { page } from '$app/stores';
import { APP_LABELS, LOGIN_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import GoogleSignInButton from '$lib/ui/components/GoogleSignInButton.svelte';
import Logo from '$lib/ui/components/Logo.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Divider from '$lib/ui/primitives/Divider.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data, form } = $props();

// form は複数の action から異なる型が返るためキャスト
const f = () => form as Record<string, unknown> | null;

let email = $state('');
let password = $state('');
let mfaCodeRaw = $state('');
let confirmCodeRaw = $state('');

// サーバーレスポンス（form）からのメールアドレス復元（パスワードはクライアント状態のみ）
$effect(() => {
	const formEmail = form?.email;
	if (typeof formEmail === 'string') email = formEmail;
});
const mfaCode = $derived(mfaCodeRaw.replace(/\s/g, ''));
const confirmCode = $derived(confirmCodeRaw.replace(/\s/g, ''));
let loading = $state(false);
let resending = $state(false);

// 再送クールダウン（60秒）
let resendCooldown = $state(0);
let cooldownTimer: ReturnType<typeof setInterval> | null = null;
let messageTimeout: ReturnType<typeof setTimeout> | null = null;
let resendSuccess = $state(false);

// コンポーネント破棄時にタイマーをクリーンアップ
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

// MFA ステップ: サーバーから session/challengeName が返ってきた場合
let mfaStep = $derived((f()?.mfaStep as boolean) ?? false);
let mfaSession = $derived((f()?.session as string) ?? '');
let mfaChallengeName = $derived((f()?.challengeName as string) ?? '');

// 確認コードステップ: UNCONFIRMED ユーザーのリカバリ
let confirmStep = $derived((f()?.confirmStep as boolean) ?? false);

const passwordReset = $derived($page.url.searchParams.get('passwordReset') === 'true');

// 再送成功時にクールダウン開始
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

// 確認ステップに初めて入った時（ログイン時の自動再送後）もクールダウン開始
$effect(() => {
	if (confirmStep && resendCooldown === 0 && !resendSuccess) {
		startCooldown();
	}
});
</script>

<svelte:head>
	<title>{PAGE_TITLES.login}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="min-h-dvh flex items-center justify-center bg-[var(--gradient-brand)] p-4">
	<Card padding="none" class="w-full max-w-[400px] px-8 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
		{#snippet children()}
		<div class="text-center mb-8">
			<Logo variant="full" size={320} />
			{#if mfaStep}
				<p class="text-sm text-[var(--color-text-muted)] mt-2 font-semibold">{LOGIN_LABELS.mfaBadge}</p>
			{/if}
		</div>

		{#if passwordReset}
			<div class="mb-4 p-3 bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)] border border-[var(--color-feedback-success-border)] rounded-[var(--radius-sm)] text-sm" role="status">
				{LOGIN_LABELS.passwordResetSuccess}
			</div>
		{/if}

		{#if form?.error}
			<div class="mb-4 p-3 bg-[var(--color-danger-50)] text-[var(--color-danger-600)] border border-[var(--color-danger-200)] rounded-[var(--radius-sm)] text-sm" role="alert">
				{form.error}
			</div>
		{/if}

		{#if confirmStep}
			<!-- UNCONFIRMED ユーザー: 確認コード入力 -->
			<p class="text-sm text-[var(--color-text-muted)] text-center mb-2 font-semibold">{LOGIN_LABELS.confirmBadge}</p>

			<form
				method="POST"
				action="?/confirmCode"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						loading = false;
						await update({ reset: false });
					};
				}}
				class="flex flex-col gap-5"
			>
				<input type="hidden" name="email" value={email} />
				<input type="hidden" name="password" value={password} />

				<p class="text-sm text-[var(--color-text-muted)] text-center leading-relaxed">
					<strong>{email}</strong>{LOGIN_LABELS.confirmDesc1Suffix}<br />
					{LOGIN_LABELS.confirmDesc2}
				</p>

				<FormField label={LOGIN_LABELS.confirmCodeLabel} id="confirmCode">
					{#snippet children()}
						<input
							id="confirmCode"
							name="code"
							type="text"
							bind:value={confirmCodeRaw}
							placeholder="123456"
							required
							inputmode="numeric"
							autocomplete="one-time-code"
							class="px-4 py-3 border border-[var(--input-border)] rounded-[var(--input-radius)] text-2xl text-center tracking-[0.5em] font-mono
								focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--color-brand-300)] focus:ring-opacity-50 outline-none transition-colors"
						/>
					{/snippet}
				</FormField>

				<Button type="submit" disabled={loading || confirmCode.length < 1} size="md" class="w-full">
					{#if loading}
						<span class="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" aria-hidden="true"></span>
						{LOGIN_LABELS.confirmLoading}
					{:else}
						{LOGIN_LABELS.confirmButton}
					{/if}
				</Button>
			</form>

			{#if resendSuccess}
				<div class="mt-3 p-3 bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)] border border-[var(--color-feedback-success-border)] rounded-[var(--radius-sm)] text-sm text-center" role="status">
					{LOGIN_LABELS.confirmResendSuccess}
				</div>
			{/if}

			<form
				method="POST"
				action="?/resendFromLogin"
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
				<Button
					type="submit"
					variant="ghost"
					size="sm"
					disabled={resending || resendCooldown > 0}
				>
					{#if resending}
						{LOGIN_LABELS.confirmResendLoading}
					{:else if resendCooldown > 0}
						{LOGIN_LABELS.confirmResendCooldown(resendCooldown)}
					{:else}
						{LOGIN_LABELS.confirmResendButton}
					{/if}
				</Button>
			</form>
		{:else if mfaStep}
			<!-- MFA コード入力フォーム -->
			<form
				method="POST"
				action="?/mfa"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						loading = false;
						mfaCodeRaw = '';
						await update();
					};
				}}
				class="flex flex-col gap-5"
			>
				<input type="hidden" name="session" value={mfaSession} />
				<input type="hidden" name="challengeName" value={mfaChallengeName} />
				<input type="hidden" name="email" value={email} />

				<p class="text-sm text-[var(--color-text-muted)] text-center">
					{LOGIN_LABELS.mfaDesc}
				</p>

				<FormField label={LOGIN_LABELS.mfaCodeLabel} id="mfaCode">
					{#snippet children()}
						<input
							id="mfaCode"
							name="mfaCode"
							type="text"
							bind:value={mfaCodeRaw}
							placeholder="000000"
							required
							maxlength="12"
							inputmode="numeric"
							autocomplete="one-time-code"
							class="px-4 py-3 border border-[var(--input-border)] rounded-[var(--input-radius)] text-2xl text-center tracking-[0.5em] font-mono
								focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--color-brand-300)] focus:ring-opacity-50 outline-none transition-colors"
						/>
					{/snippet}
				</FormField>

				<Button type="submit" disabled={loading || mfaCode.length !== 6} size="md" class="w-full">
					{#if loading}
						<span class="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" aria-hidden="true"></span>
						{LOGIN_LABELS.mfaLoading}
					{:else}
						{LOGIN_LABELS.mfaButton}
					{/if}
				</Button>
			</form>
		{:else}
			<!-- Google OAuth ログイン -->
			{#if !data.devMode}
				<GoogleSignInButton />
				<Divider label={LOGIN_LABELS.dividerLabel} spacing="sm" />
			{/if}

			<!-- 通常ログインフォーム -->
			<form
				method="POST"
				action="?/login"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						loading = false;
						password = '';
						await update();
					};
				}}
				class="flex flex-col gap-5"
			>
				<FormField
					label="メールアドレス"
					type="email"
					id="email"
					name="email"
					bind:value={email}
					placeholder={LOGIN_LABELS.emailPlaceholder}
					required
					autocomplete="email"
				/>

				<FormField
					label="パスワード"
					type="password"
					id="password"
					name="password"
					bind:value={password}
					placeholder={LOGIN_LABELS.passwordPlaceholder}
					required
					minlength={8}
					autocomplete="current-password"
					showToggle
				/>

				<div class="-mt-2 text-right">
					<a href="/auth/forgot-password" class="text-xs text-[var(--color-text-link)] hover:underline">
						{LOGIN_LABELS.forgotPasswordLink}
					</a>
				</div>

				<Button type="submit" disabled={loading || !email || !password} size="md" class="w-full">
					{#if loading}
						<span class="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" aria-hidden="true"></span>
						{LOGIN_LABELS.loginLoading}
					{:else}
						{LOGIN_LABELS.loginButton}
					{/if}
				</Button>
			</form>

			{#if !data.devMode}
				<div class="mt-5 text-center">
					<a href="/auth/signup" class="text-sm text-[var(--color-text-link)] hover:underline">
						{LOGIN_LABELS.signupLink}
					</a>
				</div>
			{/if}
		{/if}

		{#if data.devMode}
			<div class="mt-6 pt-4 border-t border-[var(--color-border-default)]">
				<details>
					<summary class="text-xs text-[var(--color-text-muted)] cursor-pointer">{LOGIN_LABELS.devAccountsSummary}</summary>
					<ul class="mt-2 pl-4 text-xs text-[var(--color-text-muted)] leading-7">
						<li><code class="bg-[var(--color-neutral-100)] px-1 rounded text-[0.7rem]">owner@example.com</code> / <code class="bg-[var(--color-neutral-100)] px-1 rounded text-[0.7rem]">Gq!Dev#Owner2026x</code> {LOGIN_LABELS.devAccountOwnerRole}</li>
						<li><code class="bg-[var(--color-neutral-100)] px-1 rounded text-[0.7rem]">parent@example.com</code> / <code class="bg-[var(--color-neutral-100)] px-1 rounded text-[0.7rem]">Gq!Dev#Parent2026</code> {LOGIN_LABELS.devAccountParentRole}</li>
						<li><code class="bg-[var(--color-neutral-100)] px-1 rounded text-[0.7rem]">child@example.com</code> / <code class="bg-[var(--color-neutral-100)] px-1 rounded text-[0.7rem]">Gq!Dev#Child2026x</code> {LOGIN_LABELS.devAccountChildRole}</li>
					</ul>
				</details>
			</div>
		{/if}
		{/snippet}
	</Card>
</div>
