<script lang="ts">
// /auth/reset-pin — #2993 (EPIC #2990): PIN 忘れ救済 (cognito 専用)
//
// 1 画面構成: ログイン中アカウント表示 (read-only) + アカウントパスワード + 新 PIN → 送信。
// /api/v1/parent-gate/reset-verified がパスワード re-auth → setupPin → parent session 発行まで行う。
import { APP_LABELS, PIN_RESET_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import PinInput from '$lib/ui/primitives/PinInput.svelte';

const { data } = $props();

let password = $state('');
let newPin = $state('');
let submitting = $state(false);
let success = $state(false);
let errorMessage = $state('');
let pinInputKey = $state(0); // PinInput remount key (失敗時リセット)

function handlePinComplete(details: { valueAsString: string }) {
	newPin = details.valueAsString;
}

async function submitReset() {
	if (submitting || success) return;
	if (!password) {
		errorMessage = PIN_RESET_LABELS.errorPasswordRequired;
		return;
	}
	if (!/^\d{4,6}$/.test(newPin)) {
		errorMessage = PIN_RESET_LABELS.errorPinFormat;
		return;
	}
	submitting = true;
	errorMessage = '';
	try {
		const res = await fetch('/api/v1/parent-gate/reset-verified', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ password, newPin }),
		});
		const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
		if (res.ok && body.ok) {
			success = true;
			return;
		}
		switch (body.error) {
			case 'INVALID_PASSWORD':
				errorMessage = PIN_RESET_LABELS.errorInvalidPassword;
				password = '';
				break;
			case 'PIN_FORMAT':
				errorMessage = PIN_RESET_LABELS.errorPinFormat;
				pinInputKey += 1;
				newPin = '';
				break;
			case 'PASSWORD_REQUIRED':
				errorMessage = PIN_RESET_LABELS.errorPasswordRequired;
				break;
			case 'RATE_LIMITED':
				errorMessage = PIN_RESET_LABELS.errorRateLimited;
				break;
			case 'NOT_SUPPORTED':
				errorMessage = PIN_RESET_LABELS.errorNotSupported;
				break;
			default:
				errorMessage = PIN_RESET_LABELS.errorGeneric;
		}
	} catch {
		errorMessage = PIN_RESET_LABELS.errorGeneric;
	} finally {
		submitting = false;
	}
}
</script>

<svelte:head>
	<title>{PIN_RESET_LABELS.resetPageTitle}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="min-h-dvh flex items-center justify-center bg-[var(--gradient-brand)] p-4">
	<Card padding="none" class="w-full max-w-[440px] px-8 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
		{#snippet children()}
			<h1 class="text-xl font-bold text-[var(--color-text-primary)] mb-2 text-center">{PIN_RESET_LABELS.resetHeading}</h1>
			<p class="text-sm text-[var(--color-text-muted)] leading-relaxed mb-6">{PIN_RESET_LABELS.resetDescription}</p>

			{#if success}
				<div data-testid="pin-reset-verified-success">
					<Alert variant="success">
						<h2 class="font-bold m-0 mb-1">{PIN_RESET_LABELS.resetSuccessHeading}</h2>
						<p class="text-sm m-0">{PIN_RESET_LABELS.resetSuccessBody}</p>
					</Alert>
					<div class="mt-6">
						<Button href="/admin" variant="primary" size="lg" class="w-full" data-testid="pin-reset-verified-success-cta">{PIN_RESET_LABELS.resetSuccessCta}</Button>
					</div>
				</div>
			{:else}
				<div class="flex flex-col gap-5" data-testid="pin-reset-verified-form">
					{#if errorMessage}
						<Alert variant="danger" data-testid="pin-reset-verified-error">{errorMessage}</Alert>
					{/if}
					<div>
						<span class="text-sm font-semibold text-[var(--color-text-primary)]">{PIN_RESET_LABELS.resetAccountLabel}</span>
						<p class="text-sm text-[var(--color-text-muted)] m-0 mt-1" data-testid="pin-reset-verified-account">{data.accountEmail}</p>
					</div>
					<FormField
						type="password"
						label={PIN_RESET_LABELS.resetPasswordLabel}
						hint={PIN_RESET_LABELS.resetPasswordHint}
						bind:value={password}
						showToggle
						required
						disabled={submitting}
						data-testid="pin-reset-verified-password"
					/>
					<div>
						<span class="text-sm font-semibold text-[var(--color-text-primary)] block mb-2">{PIN_RESET_LABELS.resetPinLabel}</span>
						{#key pinInputKey}
							<PinInput length={4} mask onComplete={handlePinComplete} />
						{/key}
					</div>
					<Button
						variant="primary"
						size="lg"
						class="w-full"
						loading={submitting}
						onclick={submitReset}
						data-testid="pin-reset-verified-submit"
					>
						{submitting ? PIN_RESET_LABELS.resetSubmitting : PIN_RESET_LABELS.resetSubmit}
					</Button>
					<a href="/switch" class="text-sm text-[var(--color-text-link)] text-center" data-testid="pin-reset-verified-back">{PIN_RESET_LABELS.resetBackToSwitch}</a>
				</div>
			{/if}
		{/snippet}
	</Card>
</div>
