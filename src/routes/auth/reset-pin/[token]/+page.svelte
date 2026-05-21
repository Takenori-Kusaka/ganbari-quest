<script lang="ts">
// /auth/reset-pin/[token] — #2353 設計欠陥 4: PIN 忘れ救済導線 (Step 2: 新 PIN 設定)
//
// magic link で送信された token (jose JWT、30 分有効、1 回限り) を [token] URL param で受け取り、
// 新 PIN を入力して /api/v1/parent-gate/reset/verify に POST。
import { page } from '$app/state';
import { APP_LABELS, PIN_RESET_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import PinInput from '$lib/ui/primitives/PinInput.svelte';

const token = $derived(page.params.token ?? '');

let newPin = $state('');
let submitting = $state(false);
let success = $state(false);
let errorMessage = $state('');
let pinInputKey = $state(0); // PinInput remount key (失敗時リセット)

async function submitNewPin(pinValue: string) {
	if (submitting || success) return;
	submitting = true;
	errorMessage = '';
	try {
		const res = await fetch('/api/v1/parent-gate/reset/verify', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token, newPin: pinValue }),
		});
		const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
		if (res.ok && body.ok) {
			success = true;
			return;
		}
		pinInputKey += 1;
		newPin = '';
		switch (body.error) {
			case 'PIN_FORMAT':
				errorMessage = PIN_RESET_LABELS.errorPinFormat;
				break;
			case 'TOKEN_EXPIRED':
				errorMessage = PIN_RESET_LABELS.errorTokenExpired;
				break;
			case 'TOKEN_ALREADY_USED':
				errorMessage = PIN_RESET_LABELS.errorTokenAlreadyUsed;
				break;
			case 'TOKEN_INVALID':
				errorMessage = PIN_RESET_LABELS.errorTokenInvalid;
				break;
			case 'RATE_LIMITED':
				errorMessage = PIN_RESET_LABELS.errorRateLimited;
				break;
			default:
				errorMessage = PIN_RESET_LABELS.errorGeneric;
		}
	} catch {
		pinInputKey += 1;
		newPin = '';
		errorMessage = PIN_RESET_LABELS.errorGeneric;
	} finally {
		submitting = false;
	}
}

function handlePinComplete(details: { valueAsString: string }) {
	newPin = details.valueAsString;
	void submitNewPin(details.valueAsString);
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
				<div data-testid="pin-reset-verify-success">
					<Alert variant="success">
						<h2 class="font-bold m-0 mb-1">{PIN_RESET_LABELS.resetSuccessHeading}</h2>
						<p class="text-sm m-0">{PIN_RESET_LABELS.resetSuccessBody}</p>
					</Alert>
					<div class="mt-6">
						<Button href="/switch" variant="primary" size="lg" class="w-full" data-testid="pin-reset-verify-success-cta">{PIN_RESET_LABELS.resetSuccessCta}</Button>
					</div>
				</div>
			{:else}
				<div class="flex flex-col gap-5" data-testid="pin-reset-verify-form">
					{#if errorMessage}
						<Alert variant="danger" data-testid="pin-reset-verify-error">{errorMessage}</Alert>
					{/if}
					<label for="pin-reset-new-pin" class="text-sm font-semibold text-[var(--color-text-primary)]">{PIN_RESET_LABELS.resetPinLabel}</label>
					{#key pinInputKey}
						<PinInput length={4} mask onComplete={handlePinComplete} />
					{/key}
					{#if submitting}
						<p class="text-xs text-[var(--color-text-muted)] text-center" data-testid="pin-reset-verify-submitting">{PIN_RESET_LABELS.resetSubmitting}</p>
					{/if}
				</div>
			{/if}
		{/snippet}
	</Card>
</div>
