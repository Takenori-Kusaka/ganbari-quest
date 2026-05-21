<script lang="ts">
// /auth/forgot-pin — #2353 設計欠陥 4: PIN 忘れ救済導線 (Step 1: email 入力)
//
// 業界標準 (1Password / Bitwarden / Apple Screen Time) と整合し、enumeration 攻撃を防ぐため
// email 未登録時も「送信しました」を表示する。実際の送信は /api/v1/parent-gate/reset/request 側で
// findUserByEmail → 該当があれば SES、無ければ logger.info のみ。
import { APP_LABELS, PAGE_TITLES, PIN_RESET_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let email = $state('');
let submitting = $state(false);
let submitted = $state(false);
let errorMessage = $state('');

async function handleSubmit(event: SubmitEvent) {
	event.preventDefault();
	if (submitting || submitted) return;
	submitting = true;
	errorMessage = '';
	try {
		const res = await fetch('/api/v1/parent-gate/reset/request', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email }),
		});
		const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
		if (res.ok && body.ok) {
			submitted = true;
			return;
		}
		if (body.error === 'INVALID_EMAIL') {
			errorMessage = PIN_RESET_LABELS.errorInvalidEmail;
		} else if (body.error === 'RATE_LIMITED') {
			errorMessage = PIN_RESET_LABELS.errorRateLimited;
		} else {
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
	<title>{PAGE_TITLES.forgotPassword === PIN_RESET_LABELS.requestPageTitle ? PAGE_TITLES.forgotPassword : PIN_RESET_LABELS.requestPageTitle}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="min-h-dvh flex items-center justify-center bg-[var(--gradient-brand)] p-4">
	<Card padding="none" class="w-full max-w-[440px] px-8 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
		{#snippet children()}
			<h1 class="text-xl font-bold text-[var(--color-text-primary)] mb-2 text-center">{PIN_RESET_LABELS.requestHeading}</h1>
			<p class="text-sm text-[var(--color-text-muted)] leading-relaxed mb-6">{PIN_RESET_LABELS.requestDescription}</p>

			{#if submitted}
				<div data-testid="pin-reset-request-success">
					<Alert variant="success">
						<h2 class="font-bold m-0 mb-1">{PIN_RESET_LABELS.requestSuccessHeading}</h2>
						<p class="text-sm m-0">{PIN_RESET_LABELS.requestSuccessBody}</p>
					</Alert>
					<div class="mt-6 text-center">
						<a href="/switch" class="text-sm text-[var(--color-text-link)] no-underline hover:underline" data-testid="pin-reset-back-to-switch">{PIN_RESET_LABELS.requestBackToSwitch}</a>
					</div>
				</div>
			{:else}
				<form onsubmit={handleSubmit} class="flex flex-col gap-5" data-testid="pin-reset-request-form">
					{#if errorMessage}
						<Alert variant="danger" data-testid="pin-reset-request-error">{errorMessage}</Alert>
					{/if}
					<FormField label={PIN_RESET_LABELS.requestEmailLabel} id="pin-reset-email" type="email" bind:value={email} placeholder={PIN_RESET_LABELS.requestEmailPlaceholder} required autocomplete="email" inputmode="email" />
					<Button type="submit" variant="primary" size="lg" disabled={submitting || email.length === 0} data-testid="pin-reset-request-submit">
						{submitting ? PIN_RESET_LABELS.requestSubmitting : PIN_RESET_LABELS.requestSubmit}
					</Button>
				</form>
				<div class="mt-6 text-center">
					<a href="/switch" class="text-sm text-[var(--color-text-muted)] no-underline hover:underline">{PIN_RESET_LABELS.requestBackToSwitch}</a>
				</div>
			{/if}
		{/snippet}
	</Card>
</div>
