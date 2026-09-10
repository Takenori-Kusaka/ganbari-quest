<script lang="ts">
// src/lib/features/admin/components/ParentGateReauthDialog.svelte
//
// **保存しようとしたら PIN session が切れていた保護者を、その場で戻す**ダイアログ
// (#4866 系 QM 監査 / PO 決裁 2026-09-10 決定 4(a))。
//
// PO 決定は form action を `redirect(303)` にしないと定めている。303 は画面遷移なので、
// 保護者が書いた内容が黙って消えるため。ただし `fail()` で入力を残しても、**PIN を
// 入れ直す場所が `/switch` にしか無ければ結局そこへ遷移して入力を失う** — 入力を残す
// 意味が無くなる。そこで admin 画面のまま PIN を入れ直せる面をここに置く。
//
// 開くのは `(parent)/admin/+layout.svelte` が `page.form.parentGateRequired` を見て行う。
// この旗は `withParentGate` (単一の seam) が立てるので、**どの画面のどの action で
// 起きても同じ体験になる** (各 page が `form?.error` を描いているとは限らない)。

import { PIN_LENGTH } from '$lib/domain/constants/oyakagi';
import { OYAKAGI_LABELS } from '$lib/domain/labels';
import { resolvePinVerifyError } from '$lib/features/parent-gate/pin-verify-error';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import PinInput from '$lib/ui/primitives/PinInput.svelte';
import { showToast } from '$lib/ui/primitives/Toast.svelte';

interface Props {
	open: boolean;
	/** 確認できた / ダイアログを閉じた。呼び出し側が open を false に戻す */
	onClose: () => void;
}

let { open = $bindable(), onClose }: Props = $props();

let pinError = $state<string>('');
let submitting = $state<boolean>(false);
// 失敗のたびに PinInput を作り直して入力欄を空に戻す (残骸のまま再入力させない)
let pinInputKey = $state<number>(0);

async function handleComplete(details: { valueAsString: string }) {
	if (submitting) return;
	submitting = true;
	pinError = '';
	try {
		const res = await fetch('/api/v1/parent-gate/verify', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pin: details.valueAsString }),
		});
		const body = (await res.json().catch(() => ({}))) as {
			ok?: boolean;
			error?: string;
			lockedUntil?: string;
		};
		if (res.ok && body.ok) {
			// **保存はやり直しが要る**。ここで自動再送しないのは、保護者が何を保存しようと
			// していたかをこの component は知らないため (勝手に送ると意図しない保存になる)。
			showToast(OYAKAGI_LABELS.gateModalTitle, OYAKAGI_LABELS.gateReauthSuccess, 'success');
			pinInputKey += 1;
			onClose();
			return;
		}
		pinInputKey += 1;
		pinError = resolvePinVerifyError(body).message;
	} catch {
		pinInputKey += 1;
		pinError = OYAKAGI_LABELS.gateGenericError;
	} finally {
		submitting = false;
	}
}
</script>

<Dialog
	bind:open
	title={OYAKAGI_LABELS.gateModalTitle}
	testid="parent-gate-reauth-modal"
	size="sm"
	onOpenChange={(e) => {
		if (!e.open) onClose();
	}}
>
	<p class="text-sm text-[var(--color-text-muted)] mb-4">
		{OYAKAGI_LABELS.gateRequiredKeepInput}
	</p>
	<p class="text-sm text-[var(--color-text-muted)] mb-4" data-testid="parent-gate-reauth-hint">
		{OYAKAGI_LABELS.gateReauthDescription}
	</p>
	{#key pinInputKey}
		<PinInput length={PIN_LENGTH} mask autoFocus onComplete={handleComplete} />
	{/key}
	{#if pinError}
		<div class="mt-3" data-testid="parent-gate-reauth-error">
			<Alert variant="danger">{pinError}</Alert>
		</div>
	{/if}
	{#if submitting}
		<p
			class="text-xs text-[var(--color-text-muted)] text-center mt-3"
			data-testid="parent-gate-reauth-submitting"
		>
			{OYAKAGI_LABELS.gateModalSubmitting}
		</p>
	{/if}
	<!-- PIN を忘れた保護者の逃げ道。ここへ遷移すると入力は失われるが、
	     出口が無いほうが致命的なので必ず出す (#2993/#2994 と同じ導線)。 -->
	<div class="mt-4 text-center">
		<a
			href="/auth/reset-pin"
			class="text-sm text-[var(--color-text-link)] no-underline hover:underline"
			data-testid="parent-gate-reauth-forgot-pin-link"
		>
			{OYAKAGI_LABELS.gateForgotPinLink}
		</a>
	</div>
</Dialog>
