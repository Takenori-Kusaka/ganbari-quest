<script lang="ts">
// /auth/reset-pin — #2993 (EPIC #2990) / #3070: PIN 忘れ救済 (cognito 専用)
//
// ログイン中アカウント表示 (read-only) + 新 PIN → 送信。本人確認は認証種別で分岐:
//   - password ユーザ: アカウントパスワード + 新 PIN を 1 画面で送信 (#2993)
//   - federated (Google) ユーザ: ①「確認コードを送る」→ ②メールの 6 桁コード + 新 PIN を送信 (#3070)
// /api/v1/parent-gate/reset-verified が re-auth → setupPin → parent session 発行まで行う。
import { APP_LABELS, PIN_RESET_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import PinInput from '$lib/ui/primitives/PinInput.svelte';

const { data } = $props();

let password = $state('');
let code = $state(''); // #3070: federated email-OTP の 6 桁確認コード
let newPin = $state('');
let submitting = $state(false);
let sendingCode = $state(false); // #3070: 確認コード送信中
let codeSent = $state(false); // #3070: 確認コード送信済 (stage 2 表示)
let success = $state(false);
let errorMessage = $state('');
let infoMessage = $state('');
let pinInputKey = $state(0); // PinInput remount key (失敗時リセット)
let codeInputKey = $state(0); // OTP PinInput remount key

function handlePinComplete(details: { valueAsString: string }) {
	newPin = details.valueAsString;
}

function handleCodeComplete(details: { valueAsString: string }) {
	code = details.valueAsString;
}

// #3070: federated — 登録メールへ確認コードを送る (stage 1 → stage 2)
async function requestCode() {
	if (sendingCode || submitting) return;
	sendingCode = true;
	errorMessage = '';
	try {
		const res = await fetch('/api/v1/parent-gate/reset-request-code', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
		});
		const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
		if (res.ok && body.ok) {
			codeSent = true;
			infoMessage = PIN_RESET_LABELS.resetFederatedCodeSent;
			return;
		}
		switch (body.error) {
			case 'RATE_LIMITED':
				errorMessage = PIN_RESET_LABELS.errorRateLimited;
				break;
			case 'NOT_SUPPORTED':
				errorMessage = PIN_RESET_LABELS.errorNotSupported;
				break;
			default:
				errorMessage = PIN_RESET_LABELS.errorCodeSendFailed;
		}
	} catch {
		errorMessage = PIN_RESET_LABELS.errorCodeSendFailed;
	} finally {
		sendingCode = false;
	}
}

async function submitReset() {
	if (submitting || success) return;
	if (data.isFederated) {
		// #3070: federated は確認コード必須
		if (!codeSent) {
			errorMessage = PIN_RESET_LABELS.errorCodeRequired;
			return;
		}
		if (!/^\d{6}$/.test(code)) {
			errorMessage = PIN_RESET_LABELS.errorInvalidCode;
			return;
		}
	} else if (!password) {
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
			body: JSON.stringify({ password, code, newPin }),
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
			case 'CODE_REQUIRED':
				// #3070: cookie 失効等で先に送信が必要 — stage 1 に戻す
				errorMessage = PIN_RESET_LABELS.errorCodeRequired;
				codeSent = false;
				code = '';
				codeInputKey += 1;
				break;
			case 'INVALID_CODE':
				errorMessage = PIN_RESET_LABELS.errorInvalidCode;
				code = '';
				codeInputKey += 1;
				break;
			case 'CODE_EXPIRED':
				errorMessage = PIN_RESET_LABELS.errorCodeExpired;
				codeSent = false;
				code = '';
				codeInputKey += 1;
				break;
			case 'TOO_MANY_ATTEMPTS':
				errorMessage = PIN_RESET_LABELS.errorTooManyAttempts;
				codeSent = false;
				code = '';
				codeInputKey += 1;
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
			<p class="text-sm text-[var(--color-text-muted)] leading-relaxed mb-6">{data.isFederated ? PIN_RESET_LABELS.resetFederatedDescription : PIN_RESET_LABELS.resetDescription}</p>

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
					{#if data.isFederated && !codeSent}
						<!-- #3070: federated stage 1 — 登録メールへ確認コードを送る。
						     パスワード欄は持たない (Cognito パスワード不在) ため出さない -->
						<Button
							variant="primary"
							size="lg"
							class="w-full"
							loading={sendingCode}
							onclick={requestCode}
							data-testid="pin-reset-verified-send-code"
						>
							{sendingCode ? PIN_RESET_LABELS.resetFederatedSendingCode : PIN_RESET_LABELS.resetFederatedSendCodeButton}
						</Button>
					{:else}
						{#if data.isFederated}
							<!-- #3070: federated stage 2 — メールに送った 6 桁コード入力 -->
							{#if infoMessage}
								<Alert variant="info" data-testid="pin-reset-verified-code-sent">{infoMessage}</Alert>
							{/if}
							<div>
								<span class="text-sm font-semibold text-[var(--color-text-primary)] block mb-2">{PIN_RESET_LABELS.resetFederatedCodeLabel}</span>
								{#key codeInputKey}
									<PinInput length={6} mask={false} onComplete={handleCodeComplete} />
								{/key}
							</div>
						{:else}
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
						{/if}
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
						{#if data.isFederated}
							<Button
								variant="ghost"
								size="sm"
								class="w-full"
								loading={sendingCode}
								onclick={requestCode}
								data-testid="pin-reset-verified-resend-code"
							>
								{PIN_RESET_LABELS.resetFederatedResendButton}
							</Button>
						{/if}
					{/if}
					<a href="/switch" class="text-sm text-[var(--color-text-link)] text-center" data-testid="pin-reset-verified-back">{PIN_RESET_LABELS.resetBackToSwitch}</a>
				</div>
			{/if}
		{/snippet}
	</Card>
</div>
