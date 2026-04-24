<script lang="ts">
import { onDestroy } from 'svelte';
import { enhance } from '$app/forms';
import { page } from '$app/stores';
import { APP_LABELS, PAGE_TITLES, SIGNUP_LABELS } from '$lib/domain/labels';
import {
	LICENSE_KEY_LEGACY_FORMAT,
	LICENSE_KEY_SIGNED_FORMAT,
	SIGNUP_CODE_EXPIRY_MINUTES,
} from '$lib/domain/validation/auth';
import GoogleSignInButton from '$lib/ui/components/GoogleSignInButton.svelte';
import Logo from '$lib/ui/components/Logo.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import Divider from '$lib/ui/primitives/Divider.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { form } = $props();

let email = $state('');
let password = $state('');
let passwordConfirm = $state('');
let licenseKeyRaw = $state('');
const licenseKey = $derived(licenseKeyRaw.toUpperCase().trim());
const licenseKeyValid = $derived(
	licenseKey === '' ||
		LICENSE_KEY_LEGACY_FORMAT.test(licenseKey) ||
		LICENSE_KEY_SIGNED_FORMAT.test(licenseKey),
);
const licenseKeyError = $derived(
	licenseKeyRaw && !licenseKeyValid
		? 'GQ-XXXX-XXXX-XXXX または GQ-XXXX-XXXX-XXXX-XXXXX 形式で入力してください'
		: undefined,
);
let codeRaw = $state('');
const code = $derived(codeRaw.replace(/\s/g, ''));
let loading = $state(false);
let resending = $state(false);
let agreedTerms = $state(false);
let agreedPrivacy = $state(false);
let showLicenseKey = $state(false);

// #799 ライセンスキー使用時の追加ガード
let agreedLicenseOnce = $state(false); // 「一回限り使用に同意」
let showLicenseHelp = $state(false); // 折りたたみヘルプの開閉
let showLicenseConfirmDialog = $state(false); // 確認ダイアログ
let signupFormEl: HTMLFormElement | null = $state(null); // dialog から submit を呼ぶため

// #588: フォーム送信試行追跡（未入力フィールドのエラー表示用）
let submitAttempted = $state(false);

// #588: 送信可能かの判定
// #799: showLicenseKey 時は「一回限り使用に同意」も必須
const canSubmit = $derived(
	!loading &&
		!!email &&
		!!password &&
		!!passwordConfirm &&
		password === passwordConfirm &&
		agreedTerms &&
		agreedPrivacy &&
		(!showLicenseKey || (!!licenseKey && licenseKeyValid && agreedLicenseOnce)),
);

// #588: 送信不可理由
const submitBlockReason = $derived(() => {
	if (!email) return SIGNUP_LABELS.blockEmailRequired;
	if (!password) return SIGNUP_LABELS.blockPasswordRequired;
	if (!passwordConfirm) return SIGNUP_LABELS.blockPasswordConfirmRequired;
	if (password !== passwordConfirm) return SIGNUP_LABELS.blockPasswordMismatch;
	if (!agreedTerms) return SIGNUP_LABELS.blockTermsRequired;
	if (!agreedPrivacy) return SIGNUP_LABELS.blockPrivacyRequired;
	if (showLicenseKey && (!licenseKey || !licenseKeyValid))
		return SIGNUP_LABELS.blockLicenseKeyInvalid;
	if (showLicenseKey && !agreedLicenseOnce) return SIGNUP_LABELS.blockLicenseOnceRequired;
	return '';
});

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

// URL の plan パラメータ（pricing ページからの遷移用）
const planParam = $derived($page.url.searchParams.get('plan'));

let confirmStep = $derived(form?.confirmStep ?? false);

// サーバーレスポンス（form）からフォーム値を復元
$effect(() => {
	if (typeof form?.email === 'string') email = form.email;
	if (typeof form?.licenseKey === 'string') {
		licenseKeyRaw = form.licenseKey;
		if (form.licenseKey) showLicenseKey = true;
	}
});

// 再送成功時にクールダウン開始
$effect(() => {
	if (form && 'resent' in form && form.resent) {
		resendSuccess = true;
		startCooldown();
		// 3秒後に成功メッセージを消す
		if (messageTimeout) clearTimeout(messageTimeout);
		messageTimeout = setTimeout(() => {
			resendSuccess = false;
		}, 3000);
	}
});
</script>

<svelte:head>
	<title>{PAGE_TITLES.signup}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="min-h-dvh flex items-center justify-center bg-[var(--gradient-brand)] p-4">
	<Card padding="none" class="w-full max-w-[400px] px-8 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
		{#snippet children()}
		<div class="text-center mb-8">
			<Logo variant="full" size={320} />
		</div>

		{#if form?.error}
			<div class="mb-4 p-3 bg-[var(--color-danger-50)] text-[var(--color-danger-600)] border border-[var(--color-danger-200)] rounded-[var(--radius-sm)] text-sm" role="alert">
				{form.error}
			</div>
		{/if}

		{#if confirmStep}
			<!-- メール認証コード入力 -->
			<form
				method="POST"
				action="?/confirm"
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
				<input type="hidden" name="password" value={password} />
				<input type="hidden" name="licenseKey" value={licenseKey} />
				<input type="hidden" name="plan" value={planParam ?? ''} />

				<p class="text-sm text-[var(--color-text-muted)] text-center leading-relaxed">
					{SIGNUP_LABELS.confirmEmailSent(email)}<br />
					{SIGNUP_LABELS.confirmEmailNote}
				</p>

				<p class="text-xs text-[var(--color-text-muted)] text-center">
					{SIGNUP_LABELS.confirmCodeExpiry(SIGNUP_CODE_EXPIRY_MINUTES)}
				</p>

				<FormField label={SIGNUP_LABELS.confirmCodeLabel} id="code">
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

				<Button type="submit" disabled={loading || code.length < 1} size="md" class="w-full">
					{#if loading}
						<span class="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" aria-hidden="true"></span>
						{SIGNUP_LABELS.confirmSubmitLoading}
					{:else}
						{SIGNUP_LABELS.confirmSubmitButton}
					{/if}
				</Button>
			</form>

			{#if resendSuccess}
				<div class="mt-3 p-3 bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)] border border-[var(--color-feedback-success-border)] rounded-[var(--radius-sm)] text-sm text-center" role="status">
					{SIGNUP_LABELS.resendSuccess}
				</div>
			{/if}

			<form
				method="POST"
				action="?/resend"
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
				<input type="hidden" name="licenseKey" value={licenseKey} />
				<input type="hidden" name="plan" value={planParam ?? ''} />
				<Button
					type="submit"
					variant="ghost"
					size="sm"
					disabled={resending || resendCooldown > 0}
				>
					{#if resending}
						{SIGNUP_LABELS.resendLoading}
					{:else if resendCooldown > 0}
						{SIGNUP_LABELS.resendCooldown(resendCooldown)}
					{:else}
						{SIGNUP_LABELS.resendButton}
					{/if}
				</Button>
			</form>
		{:else}
			<!-- Google OAuth サインアップ -->
			<GoogleSignInButton label={SIGNUP_LABELS.googleSignupLabel} href="/auth/oauth/google" />
			<Divider label={SIGNUP_LABELS.dividerOr} spacing="sm" />

			<!-- 登録フォーム -->
			<form
				bind:this={signupFormEl}
				method="POST"
				action="?/signup"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						loading = false;
						passwordConfirm = '';
						await update({ reset: false });
					};
				}}
				class="flex flex-col gap-5"
			>
				<!-- #766: /pricing からの遷移で plan パラメータを確認アクションまで引き継ぐ -->
				<input type="hidden" name="plan" value={planParam ?? ''} />

				<FormField
					label={SIGNUP_LABELS.emailLabel}
					type="email"
					id="email"
					name="email"
					bind:value={email}
					placeholder={SIGNUP_LABELS.emailPlaceholder}
					required
					autocomplete="email"
				/>

				<FormField
					label={SIGNUP_LABELS.passwordLabel}
					type="password"
					id="password"
					name="password"
					bind:value={password}
					placeholder={SIGNUP_LABELS.passwordPlaceholder}
					required
					minlength={8}
					autocomplete="new-password"
					showToggle
					hint={SIGNUP_LABELS.passwordHint}
				/>

				<FormField
					label={SIGNUP_LABELS.passwordConfirmLabel}
					type="password"
					id="passwordConfirm"
					name="passwordConfirm"
					bind:value={passwordConfirm}
					placeholder={SIGNUP_LABELS.passwordConfirmPlaceholder}
					required
					minlength={8}
					autocomplete="new-password"
					showToggle
					error={passwordConfirm && password !== passwordConfirm ? SIGNUP_LABELS.passwordMismatchError : undefined}
					hint={passwordConfirm && password === passwordConfirm ? SIGNUP_LABELS.passwordMatchHint : undefined}
				/>

				{#if showLicenseKey}
					<FormField
						label={SIGNUP_LABELS.licenseKeyLabel}
						id="licenseKey"
						hint={SIGNUP_LABELS.licenseKeyHint}
						error={licenseKeyError}
					>
						{#snippet children()}
							<input
								id="licenseKey"
								name="licenseKey"
								type="text"
								bind:value={licenseKeyRaw}
								placeholder="GQ-XXXX-XXXX-XXXX-XXXXX"
								required
								autocomplete="off"
								class="w-full px-3 py-2 border border-[var(--input-border)] rounded-[var(--input-radius)] text-sm uppercase font-mono tracking-wider
									focus:border-[var(--input-border-focus)] focus:outline-none focus:ring-2 focus:ring-opacity-30 transition-colors"
							/>
						{/snippet}
					</FormField>

					<!-- #799: 折りたたみヘルプ「ライセンスキーについて」 -->
					<div class="-mt-3">
						<button
							type="button"
							class="text-xs text-[var(--color-text-link)] underline hover:no-underline"
							aria-expanded={showLicenseHelp}
							aria-controls="license-key-help"
							onclick={() => { showLicenseHelp = !showLicenseHelp; }}
							data-testid="signup-license-help-toggle"
						>
							{showLicenseHelp ? '▼' : '▶'} {SIGNUP_LABELS.licenseKeyHelpToggle}
						</button>
						{#if showLicenseHelp}
							<div
								id="license-key-help"
								class="mt-2 p-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] border border-[var(--color-border-default)] text-xs text-[var(--color-text-muted)] leading-relaxed space-y-1.5"
								data-testid="signup-license-help"
							>
								<p><strong class="text-[var(--color-text-primary)]">{SIGNUP_LABELS.licenseKeyHelpOnce}</strong>: {SIGNUP_LABELS.licenseKeyHelpOnceDesc}</p>
								<p><strong class="text-[var(--color-text-primary)]">{SIGNUP_LABELS.licenseKeyHelpAutoDetect}</strong>: {SIGNUP_LABELS.licenseKeyHelpAutoDetectDesc}</p>
								<p><strong class="text-[var(--color-text-primary)]">{SIGNUP_LABELS.licenseKeyHelpBound}</strong>: {SIGNUP_LABELS.licenseKeyHelpBoundDesc}</p>
								<p><strong class="text-[var(--color-text-primary)]">{SIGNUP_LABELS.licenseKeyHelpExpiry}</strong>: {SIGNUP_LABELS.licenseKeyHelpExpiryDesc}</p>
							</div>
						{/if}
					</div>

					<!-- #799: 一回限り使用に同意 -->
					<FormField label="" error={submitAttempted && !agreedLicenseOnce ? SIGNUP_LABELS.licenseKeyOnceAgreeError : undefined}>
						{#snippet children()}
							<label class="flex items-start gap-2 cursor-pointer">
								<input
									type="checkbox"
									bind:checked={agreedLicenseOnce}
									class="mt-0.5 w-4 h-4 shrink-0 accent-[var(--theme-primary)]"
									data-testid="signup-license-once-checkbox"
								/>
								<span class="text-[0.8rem] text-[var(--color-text-muted)] leading-relaxed">
									{SIGNUP_LABELS.licenseKeyOnceAgreePrefix}<strong class="text-[var(--color-text-primary)]">{SIGNUP_LABELS.licenseKeyOnceAgreeStrong}</strong>{SIGNUP_LABELS.licenseKeyOnceAgreeSuffix}
								</span>
							</label>
						{/snippet}
					</FormField>

					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-link)] underline -mt-3 !p-0"
						onclick={() => { showLicenseKey = false; licenseKeyRaw = ''; agreedLicenseOnce = false; showLicenseHelp = false; }}
					>
						{SIGNUP_LABELS.licenseKeySkipButton}
					</Button>
				{:else}
					<input type="hidden" name="licenseKey" value="" />
				{/if}

				<div class="-mt-1">
					<FormField label="" error={submitAttempted && !agreedTerms ? SIGNUP_LABELS.termsAgreeError : undefined}>
						{#snippet children()}
							<label class="flex items-start gap-2 cursor-pointer">
								<input
									type="checkbox"
									name="agreedTerms"
									bind:checked={agreedTerms}
									class="mt-0.5 w-4 h-4 shrink-0 accent-[var(--theme-primary)]"
								/>
								<span class="text-[0.8rem] text-[var(--color-text-muted)] leading-relaxed">
									<a href="https://www.ganbari-quest.com/terms.html" target="_blank" rel="noopener noreferrer" class="text-[var(--color-text-link)] underline">{SIGNUP_LABELS.termsAgreeLink}</a>{SIGNUP_LABELS.termsAgreeSuffix}
								</span>
							</label>
						{/snippet}
					</FormField>
					<FormField label="" error={submitAttempted && !agreedPrivacy ? SIGNUP_LABELS.privacyAgreeError : undefined}>
						{#snippet children()}
							<label class="flex items-start gap-2 cursor-pointer">
								<input
									type="checkbox"
									name="agreedPrivacy"
									bind:checked={agreedPrivacy}
									class="mt-0.5 w-4 h-4 shrink-0 accent-[var(--theme-primary)]"
								/>
								<span class="text-[0.8rem] text-[var(--color-text-muted)] leading-relaxed">
									<a href="https://www.ganbari-quest.com/privacy.html" target="_blank" rel="noopener noreferrer" class="text-[var(--color-text-link)] underline">{SIGNUP_LABELS.privacyAgreeLink}</a>{SIGNUP_LABELS.privacyAgreeSuffix}
								</span>
							</label>
						{/snippet}
					</FormField>
					<p class="text-xs text-[var(--color-neutral-400)] mt-1 ml-6 leading-snug">
						{SIGNUP_LABELS.parentalConsentNote}
					</p>
				</div>

				{#if submitAttempted && !canSubmit}
					<p class="text-xs text-[var(--color-danger)] text-center" role="alert">
						{submitBlockReason()}
					</p>
				{/if}

				<Button
					type="submit"
					disabled={!canSubmit}
					size="md"
					class="w-full disabled:opacity-40 disabled:cursor-not-allowed"
					data-testid="signup-submit-button"
					onclick={(e) => {
						if (!canSubmit) {
							e.preventDefault();
							submitAttempted = true;
							return;
						}
						// #799: ライセンスキー使用時は確認ダイアログを経由
						if (showLicenseKey) {
							e.preventDefault();
							showLicenseConfirmDialog = true;
						}
					}}
				>
					{#if loading}
						<span class="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" aria-hidden="true"></span>
						{SIGNUP_LABELS.submitLoading}
					{:else if showLicenseKey}
						{SIGNUP_LABELS.submitWithLicenseKey}
					{:else if planParam}
						{SIGNUP_LABELS.submitWithTrial}
					{:else}
						{SIGNUP_LABELS.submitFree}
					{/if}
				</Button>

				{#if planParam}
					<p class="text-xs text-center text-[var(--color-neutral-400)] -mt-2">
						{SIGNUP_LABELS.trialPlanNote(planParam === 'family' ? SIGNUP_LABELS.trialPlanFamily : SIGNUP_LABELS.trialPlanStandard)}
					</p>
				{/if}
			</form>

			<!-- ライセンスキー / プランの切り替えリンク -->
			<div class="mt-3 text-center">
				{#if !showLicenseKey}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-link)] underline !p-0"
						onclick={() => { showLicenseKey = true; }}
					>
						{SIGNUP_LABELS.licenseKeyLinkButton}
					</Button>
				{/if}
			</div>
		{/if}

		<div class="mt-5 text-center">
			<a href="/auth/login" class="text-sm text-[var(--color-text-link)] hover:underline">
				{SIGNUP_LABELS.loginLink}
			</a>
		</div>

		<!-- #709: 有料プラン契約に関する法的開示（特商法第11条準拠） -->
		<div class="mt-4 pt-3 border-t border-[var(--color-border-light)] text-center">
			<p class="text-xs text-[var(--color-text-tertiary)] leading-relaxed">
				{SIGNUP_LABELS.legalNote}
				<a href="https://www.ganbari-quest.com/tokushoho.html" target="_blank" rel="noopener noreferrer" class="text-[var(--color-text-link)] underline mx-1">{SIGNUP_LABELS.legalTokushoho}</a>
				{SIGNUP_LABELS.legalSlaAnd}
				<a href="https://www.ganbari-quest.com/sla.html" target="_blank" rel="noopener noreferrer" class="text-[var(--color-text-link)] underline mx-1">{SIGNUP_LABELS.legalSla}</a>
				{SIGNUP_LABELS.legalNoteEnd}
			</p>
		</div>
		{/snippet}
	</Card>
</div>

<!-- #799: ライセンスキー有効化 確認ダイアログ -->
<Dialog
	bind:open={showLicenseConfirmDialog}
	title={SIGNUP_LABELS.licenseConfirmTitle}
	size="md"
	testid="signup-license-confirm-dialog"
>
	{#snippet children()}
		<div class="space-y-4 text-sm">
			<div class="p-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] border border-[var(--color-border-default)]">
				<p class="text-xs text-[var(--color-text-tertiary)] mb-1">{SIGNUP_LABELS.licenseConfirmKeyLabel}</p>
				<p class="font-mono text-[var(--color-text-primary)] break-all" data-testid="signup-license-confirm-key">
					{licenseKey}
				</p>
			</div>

			<ul class="space-y-2 text-[var(--color-text-secondary)]">
				<li class="flex gap-2">
					<span aria-hidden="true">⚠️</span>
					<span>{SIGNUP_LABELS.licenseConfirmBoundPrefix}<strong class="text-[var(--color-text-primary)]">{SIGNUP_LABELS.licenseConfirmOnce}</strong>{SIGNUP_LABELS.licenseConfirmOnceDesc}</span>
				</li>
				<li class="flex gap-2">
					<span aria-hidden="true">📦</span>
					<span>{SIGNUP_LABELS.licenseConfirmPlanPrefix}<strong class="text-[var(--color-text-primary)]">{SIGNUP_LABELS.licenseConfirmPlanStrong}</strong>{SIGNUP_LABELS.licenseConfirmPlanSuffix}</span>
				</li>
				<li class="flex gap-2">
					<span aria-hidden="true">👤</span>
					<span>{SIGNUP_LABELS.licenseConfirmBoundPrefix}<strong class="text-[var(--color-text-primary)]">{SIGNUP_LABELS.licenseConfirmBoundEmail(email)}</strong>{SIGNUP_LABELS.licenseConfirmBoundSuffix}</span>
				</li>
				<li class="flex gap-2">
					<span aria-hidden="true">⏳</span>
					<span>{SIGNUP_LABELS.licenseConfirmBoundPrefix}<strong class="text-[var(--color-text-primary)]">{SIGNUP_LABELS.licenseConfirmExpiry}</strong>{SIGNUP_LABELS.licenseConfirmExpirySuffix}</span>
				</li>
			</ul>

			<div class="flex gap-2 pt-2">
				<Button
					type="button"
					variant="secondary"
					size="md"
					class="flex-1"
					data-testid="signup-license-confirm-cancel"
					onclick={() => { showLicenseConfirmDialog = false; }}
				>
					{SIGNUP_LABELS.licenseConfirmCancel}
				</Button>
				<Button
					type="button"
					variant="primary"
					size="md"
					class="flex-1"
					data-testid="signup-license-confirm-ok"
					onclick={() => {
						showLicenseConfirmDialog = false;
						signupFormEl?.requestSubmit();
					}}
				>
					{SIGNUP_LABELS.licenseConfirmOk}
				</Button>
			</div>
		</div>
	{/snippet}
</Dialog>
