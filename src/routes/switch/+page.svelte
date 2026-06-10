<script lang="ts">
import { untrack } from 'svelte';
import { enhance } from '$app/forms';
import { APP_LABELS, OYAKAGI_LABELS, PAGE_TITLES, SWITCH_PAGE_LABELS } from '$lib/domain/labels';
import SetupResumeBanner from '$lib/features/admin/components/SetupResumeBanner.svelte';
import Logo from '$lib/ui/components/Logo.svelte';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import PinInput from '$lib/ui/primitives/PinInput.svelte';
import { soundService } from '$lib/ui/sound/sound-service';

let { data } = $props();

const knownThemes = new Set(['pink', 'blue', 'green', 'orange', 'purple']);

// EPIC #2310 子#2312: PIN gate inline modal (Apple Screen Time 同設計)
// pinRequired=1 query (Sub-1 middleware redirect) で初期表示 true
// 初期値のみ参照 (data 変化への追従は下記 $effect が担うため、untrack で明示的に opt out)
let pinModalOpen = $state<boolean>(untrack(() => data.pinRequired ?? false));
let pinError = $state<string>('');
let lockoutUntil = $state<number | null>(null);
let pinSubmitting = $state<boolean>(false);
// PinInput remount 用 key (失敗時に入力欄を確実にリセット)
let pinInputKey = $state<number>(0);

// Issue #2353 Fix 1 (Phase A): pinRequired query 再到達時 modal 自動 open 保証
// 子供画面から戻って `/switch?pinRequired=1` 再アクセス時、banner だけ残って modal が出ない bug の構造的修正。
// $state は初期化のみで data.pinRequired の変化に追従しないため、$effect で同期する。
// Research 結論 (Wave 28-A): 業界 8 サービス調査で「banner だけ + modal 出さない」設計は prior art ゼロ = 構造的 bug 確定。
$effect(() => {
	if (data.pinRequired) {
		pinModalOpen = true;
		// 過去の error / lockout / 入力残骸をクリアして再入力できる状態に揃える
		pinError = '';
		pinInputKey += 1;
	}
});

const lockedNow = $derived(lockoutUntil !== null && Date.now() < (lockoutUntil ?? 0));

async function handleAdminLinkClick(e: MouseEvent) {
	// cognito モードで /auth/login に飛ばす場合は本フローをスキップ (子供画面では本リンク自体が非表示)
	if (data.adminLink !== '/admin') return;
	e.preventDefault();
	soundService.ensureContext();
	soundService.play('tap');
	pinError = '';
	pinModalOpen = true;
}

async function handlePinComplete(details: { valueAsString: string }) {
	if (pinSubmitting || lockedNow) return;
	pinSubmitting = true;
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
			pinModalOpen = false;
			// next path が /admin 配下に限定されていることは server 側で保証済
			window.location.href = data.nextPath ?? '/admin';
			return;
		}
		// 失敗: input 欄をリセット
		pinInputKey += 1;
		if (body.error === 'LOCKED_OUT' && body.lockedUntil) {
			lockoutUntil = new Date(body.lockedUntil).getTime();
			// #2991: 解除予定の絶対時刻 (HH:MM、ローカルタイム) を提示し「いつ再試行できるか」を明示する。
			// lockedUntil が parse 不能な場合のみ時刻なし fallback (lockedError)。
			const unlockTime = new Date(body.lockedUntil);
			pinError = Number.isNaN(unlockTime.getTime())
				? OYAKAGI_LABELS.lockedError
				: OYAKAGI_LABELS.gateLockedUntilNotice(
						unlockTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
					);
		} else if (body.error === 'PIN_FORMAT') {
			pinError = OYAKAGI_LABELS.gateFormatNotice;
		} else if (body.error === 'INVALID_PIN' || body.error === 'PIN_NOT_SET') {
			pinError = OYAKAGI_LABELS.invalidError;
		} else {
			pinError = OYAKAGI_LABELS.gateGenericError;
		}
	} catch {
		pinInputKey += 1;
		pinError = OYAKAGI_LABELS.gateGenericError;
	} finally {
		pinSubmitting = false;
	}
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.switchUser}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="portal-page min-h-dvh flex flex-col">
	{#if data.reason === 'admin_forbidden'}
		<div class="bg-[var(--color-gold-100)] text-[var(--color-gold-700)] py-3 px-4 text-center text-sm font-semibold border-b border-[var(--color-gold-500)]" role="alert">{SWITCH_PAGE_LABELS.adminForbiddenNotice}</div>
	{/if}

	{#if data.pinRequired}
		<div class="bg-[var(--color-feedback-info-bg)] text-[var(--color-feedback-info-text)] py-3 px-4 text-center text-sm font-semibold border-b border-[var(--color-feedback-info-border)]" role="status" data-testid="parent-gate-required-banner">{OYAKAGI_LABELS.gatePinRequiredBanner}</div>
	{/if}

	<header class="pt-10 px-6 pb-6 flex justify-center">
		<Logo variant="full" size={280} />
	</header>

	<main class="flex-1 px-4 pb-6 max-w-[480px] mx-auto w-full">
		<!-- #2821: セットアップ離脱後の再開導線 (進行中のみ表示) -->
		{#if data.onboarding}
			<div class="mb-4">
				<SetupResumeBanner onboarding={data.onboarding} variant="resume" />
			</div>
		{/if}

		<h1 class="text-2xl font-bold text-center text-[var(--color-neutral-900)] mb-6">{SWITCH_PAGE_LABELS.heading}</h1>

		{#if data.children.length === 0}
			<div class="flex flex-col items-center py-12 text-[var(--color-neutral-400)]">
				<span class="text-[2.5rem] mb-2">👤</span>
				<p class="font-bold m-0">{SWITCH_PAGE_LABELS.emptyTitle}</p>
				<p class="text-sm mt-1">{SWITCH_PAGE_LABELS.emptyDesc}</p>
			</div>
		{:else}
			<div class="flex flex-col gap-3">
				{#each data.children as child (child.id)}
					{@const themeName = knownThemes.has(child.theme) ? child.theme : 'pink'}
					<form method="POST" action="?/select" use:enhance>
						<input type="hidden" name="childId" value={child.id} />
						<Button
							type="submit"
							onclick={() => { soundService.ensureContext(); soundService.play('tap'); }}
							variant="ghost"
							size="lg"
							class="w-full flex items-center gap-3 p-4 bg-white border-2 border-[var(--theme-primary)] rounded-2xl shadow-sm cursor-pointer transition-all text-left hover:bg-[var(--theme-bg)] hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
							data-testid="child-select-{child.id}"
							data-theme={themeName}
						>
							{#if child.avatarUrl}
								<img
									src={child.avatarUrl}
									alt={child.nickname}
									class="w-12 h-12 rounded-full object-cover border-2 border-[var(--theme-primary)] shrink-0"
									loading="lazy"
								/>
							{:else}
								<span class="text-[2.5rem] shrink-0">👤</span>
							{/if}
							<div class="flex-1 min-w-0">
								<p class="text-lg font-bold text-[var(--color-neutral-900)] m-0">{child.nickname}</p>
								<p class="text-sm text-[var(--color-neutral-400)] mt-0.5">{child.age + 'さい'}</p>
							</div>
							<span class="text-2xl text-[var(--color-neutral-300)] shrink-0" aria-hidden="true">▶</span>
						</Button>
					</form>
				{/each}
			</div>
		{/if}
	</main>

	{#if data.showAdminLink}
		<footer class="p-4 text-center">
			<a
				href={data.adminLink}
				onclick={handleAdminLinkClick}
				data-testid="switch-admin-link"
				class="text-[var(--color-text-muted)] text-sm no-underline hover:text-[var(--color-brand-700)]"
			>{SWITCH_PAGE_LABELS.adminLink}</a>
		</footer>
	{/if}
</div>

<Dialog
	bind:open={pinModalOpen}
	title={OYAKAGI_LABELS.gateModalTitle}
	testid="parent-gate-modal"
	size="sm"
>
	<p class="text-sm text-[var(--color-text-muted)] mb-4">{OYAKAGI_LABELS.gateModalDescription}</p>
	{#key pinInputKey}
		<PinInput length={4} mask onComplete={handlePinComplete} />
	{/key}
	<!-- Issue #2353 Fix 5 (Phase A): 初期 PIN 5086 ヒントを modal から削除 (子供脆弱性) -->
	<!-- 業界 PIN 採用 4 サービス全てで初期値ヒントは setup 時のみ、modal では非表示 (Apple / Nintendo / Roblox / BusyKid) -->
	<!-- setup/complete/+page.svelte の OYAKAGI_LABELS.defaultValueHint は適切な文脈 (初期 setup 完了時) なので維持 -->
	<!-- Phase C: gateDefaultHint atom は labels.ts から削除済、ここでは Phase C 由来の Forgot PIN リンクのみ追加 -->

	{#if pinError}
		<div class="mt-3" data-testid="parent-gate-error">
			<Alert variant="danger">{pinError}</Alert>
		</div>
	{/if}
	{#if pinSubmitting}
		<p class="text-xs text-[var(--color-text-muted)] text-center mt-3" data-testid="parent-gate-submitting">{OYAKAGI_LABELS.gateModalSubmitting}</p>
	{/if}
	<!-- #2353 設計欠陥 4: PIN 忘れ救済導線 (SES magic link + jose JWT 30 分有効 + 1 回限り) -->
	<div class="mt-4 text-center">
		<a href="/auth/forgot-pin" class="text-sm text-[var(--color-text-link)] no-underline hover:underline" data-testid="parent-gate-forgot-pin-link">{OYAKAGI_LABELS.gateForgotPinLink}</a>
	</div>
</Dialog>

<style>
	.portal-page {
		background: linear-gradient(135deg, var(--color-brand-100) 0%, var(--color-brand-50) 50%, var(--color-gold-100) 100%);
	}
</style>
