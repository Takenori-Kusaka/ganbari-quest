<script lang="ts">
import { tick } from 'svelte';
import { enhance } from '$app/forms';
import { invalidateAll, replaceState } from '$app/navigation';
import { page } from '$app/state';
import { ADMIN_RULES_PAGE_LABELS, APP_LABELS } from '$lib/domain/labels';
// #2895: marketplace 陳列の in-page browse UI / OverflowMenu / help-restore-export dialog を撤去し、
// 本画面は「取込済 bonus ルールの確認 + ON/OFF + 削除」に簡素化。
// marketplace 詳細 → `?import=<presetId>` の bonus auto-import 経路は bonus 取込導線として維持する。
// UnifiedEmptyState は SSOT 維持 (CX-DoR #11、NN/G #4 consistency)。
import UnifiedEmptyState from '$lib/marketplace/ui/UnifiedEmptyState.svelte';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import { showToast } from '$lib/ui/primitives/Toast.svelte';

let { data, form } = $props();

// `?import=<presetId>` auto-import 制御 (load 側で validate 済)。1 度だけ form を programmatic submit + URL cleanup。
let autoImportTriggered = $state(false);
let autoImportFormRef = $state<HTMLFormElement | null>(null);
let autoImportPresetIdInput = $state<HTMLInputElement | null>(null);

$effect(() => {
	if (autoImportTriggered) return;

	// 不正 presetId / 非 bonus type を即時 toast 表示してから URL cleanup
	if (data.importPresetError === 'not-found' && data.importPresetIdRaw) {
		autoImportTriggered = true;
		showToast(
			ADMIN_RULES_PAGE_LABELS.importToastNotFound(data.importPresetIdRaw),
			undefined,
			'error',
		);
		cleanupImportQueryParam();
		return;
	}
	if (data.importPresetError === 'wrong-type' && data.importPresetIdRaw) {
		autoImportTriggered = true;
		showToast(ADMIN_RULES_PAGE_LABELS.importToastError(data.importPresetIdRaw), undefined, 'error');
		cleanupImportQueryParam();
		return;
	}

	if (data.importPresetId && autoImportFormRef && autoImportPresetIdInput) {
		autoImportTriggered = true;
		autoImportPresetIdInput.value = data.importPresetId;
		autoImportFormRef.requestSubmit();
	}
});

// import action 完了後の form 戻り値を観察し toast 表示。
type ImportFormResult = {
	packName?: string;
	imported?: number;
	skipped?: number;
	total?: number;
	errors?: string[];
	// #2955: 実失敗件数 (server 算出)。rule-preset の errors は warnings (already-imported 等の
	// 非失敗通知) を merge した表示ログのため、失敗判定は errors.length でなく failed を使う。
	failed?: number;
	presetId?: string;
	// #2823: demo write-guard が返す no-op マーカー (presetId なし)。real 経路とは別分岐で扱う。
	demo?: boolean;
};

let lastProcessedImportFingerprint = $state<string | null>(null);
let demoNoopToastShown = $state(false);

$effect(() => {
	if (!form) return;
	const r = form as ImportFormResult;
	// #2823: demo 環境の no-op 取込 ({demo:true, imported:0}、presetId なし) を正直に明示。
	if (r.demo === true) {
		if (!demoNoopToastShown) {
			demoNoopToastShown = true;
			showToast(ADMIN_RULES_PAGE_LABELS.importDemo, undefined, 'info');
			cleanupImportQueryParam();
		}
		return;
	}
	if (r.presetId && typeof r.imported === 'number') {
		const fp = `${r.presetId}|${r.imported}|${r.skipped ?? 0}|${r.total ?? 0}`;
		if (fp === lastProcessedImportFingerprint) return;
		lastProcessedImportFingerprint = fp;
		const display = r.packName ?? r.presetId;
		if (r.imported > 0) {
			showToast(ADMIN_RULES_PAGE_LABELS.importToastSuccess(display), undefined, 'success');
		} else if (r.skipped === r.total && (r.total ?? 0) > 0) {
			showToast(ADMIN_RULES_PAGE_LABELS.importToastDuplicate(display), undefined, 'info');
		} else if ((r.failed ?? 0) > 0) {
			// #2955: errors.length 判定だと rule-preset の warnings (非失敗) が error toast に
			// 誤判定される (penalty/special の no-op warning 等)。failed (genuine error 数) で判定する。
			showToast(ADMIN_RULES_PAGE_LABELS.importToastError(display), undefined, 'error');
		}
		cleanupImportQueryParam();
	}
});

async function cleanupImportQueryParam() {
	if (typeof window === 'undefined') return;
	const u = new URL(page.url);
	if (!u.searchParams.has('import')) return;
	u.searchParams.delete('import');
	// $effect は mount 直後に fire するため初回は router 未初期化で replaceState が throw する。
	// tick() で 1 回 microtask を待つと router init が完了するため安全に呼べる。
	await tick();
	try {
		replaceState(u, page.state ?? {});
	} catch {
		window.history.replaceState(window.history.state, '', u.toString());
	}
}

function formatImportedAt(iso: string): string {
	try {
		const d = new Date(iso);
		return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
	} catch {
		return iso;
	}
}
</script>

<svelte:head>
	<title>{ADMIN_RULES_PAGE_LABELS.pageTitle}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<!-- `?import=<presetId>` auto-import 用の hidden form (programmatic submit) -->
<form
	bind:this={autoImportFormRef}
	method="POST"
	action="?/importMarketplaceRulePreset"
	use:enhance={() => async ({ update }) => {
		await update();
		await invalidateAll();
	}}
	style="display:none"
	data-testid="rules-auto-import-form"
>
	<input bind:this={autoImportPresetIdInput} type="hidden" name="presetId" value="" />
</form>

<div class="max-w-3xl mx-auto px-4 py-6 space-y-6" data-testid="admin-rules-page">
	<header class="space-y-2" data-tutorial="rules-overview">
		<h1 class="text-xl font-bold text-[var(--color-text-primary)]">
			{ADMIN_RULES_PAGE_LABELS.pageTitle}
		</h1>
		<p class="text-sm text-[var(--color-text-secondary)]">
			{ADMIN_RULES_PAGE_LABELS.pageDescription}
		</p>
	</header>

	{#if form?.toggleSuccess || form?.removeSuccess}
		<div
			class="bg-[var(--color-feedback-success-bg)] border border-[var(--color-feedback-success-border)] text-[var(--color-feedback-success-text)] rounded-xl p-3 text-sm"
			data-testid="rules-action-success"
		>
			{form.removeSuccess
				? ADMIN_RULES_PAGE_LABELS.removeSuccess
				: ADMIN_RULES_PAGE_LABELS.updateSuccess}
		</div>
	{/if}

	{#if data.bonusPresets.length === 0}
		<!-- 取込済が無い場合。CX-DoR #11: empty state を共通 SSOT に統一 (NN/G #4 consistency)。
		     #2895: marketplace 陳列撤去に伴い browse link / primary CTA は出さない。 -->
		<Card padding="lg" variant="elevated">
			{#snippet children()}
			<UnifiedEmptyState
				testid="rules-empty-state"
				noItemsText={ADMIN_RULES_PAGE_LABELS.emptyTitle}
				descText={ADMIN_RULES_PAGE_LABELS.emptyDesc}
				showPrimary={false}
				canImport={false}
			/>
			{/snippet}
		</Card>
	{:else}
		<!-- bonus preset 一覧 (確認 + ON/OFF + 削除) -->
		<Card padding="lg" variant="elevated">
			{#snippet children()}
			<section class="space-y-3" data-testid="rules-bonus-section">
				<h2 class="text-sm font-bold text-[var(--color-text-primary)]">
					{ADMIN_RULES_PAGE_LABELS.sectionBonusTitle}
				</h2>
				<p class="text-xs text-[var(--color-text-tertiary)]">
					{ADMIN_RULES_PAGE_LABELS.sectionBonusDesc}
				</p>

				<ul class="space-y-3">
					{#each data.bonusPresets as preset (preset.presetId)}
						<li
							class="border border-[var(--color-border-default)] rounded-lg p-3 space-y-2"
							data-testid="rules-bonus-preset-{preset.presetId}"
						>
							<div class="flex items-start gap-3">
								<span class="text-3xl">{preset.presetIcon}</span>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 flex-wrap">
										<h3 class="text-sm font-bold text-[var(--color-text-primary)]">
											{preset.presetName}
										</h3>
										{#if preset.enabled}
											<Badge variant="success" size="sm">
												{ADMIN_RULES_PAGE_LABELS.enabledBadge}
											</Badge>
										{:else}
											<Badge variant="info" size="sm">
												{ADMIN_RULES_PAGE_LABELS.disabledBadge}
											</Badge>
										{/if}
									</div>
									<p class="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
										{ADMIN_RULES_PAGE_LABELS.importedAtLabel}: {formatImportedAt(preset.importedAt)}
									</p>
								</div>
							</div>

							<details class="text-xs">
								<summary class="cursor-pointer text-[var(--color-text-secondary)]">
									{ADMIN_RULES_PAGE_LABELS.rulesLabel} ({preset.rules.length})
								</summary>
								<ul class="mt-2 space-y-1 ml-4">
									{#each preset.rules as rule (rule.title)}
										<li class="flex items-start gap-2 text-xs">
											<span>{rule.icon}</span>
											<div class="flex-1">
												<div class="font-medium text-[var(--color-text-primary)]">
													{rule.title}
													<span class="text-[var(--color-feedback-success-text)] ml-1">
														+{rule.pointBonus}{ADMIN_RULES_PAGE_LABELS.pointBonusSuffix}
													</span>
												</div>
												<p class="text-[var(--color-text-tertiary)]">{rule.description}</p>
											</div>
										</li>
									{/each}
								</ul>
							</details>

							<div class="flex items-center gap-2 justify-end">
								<form
									method="POST"
									action="?/togglePreset"
									use:enhance={() => async ({ update }) => {
										await update();
										await invalidateAll();
									}}
								>
									<input type="hidden" name="presetId" value={preset.presetId} />
									<input
										type="hidden"
										name="enabled"
										value={preset.enabled ? 'false' : 'true'}
									/>
									<Button
										type="submit"
										variant={preset.enabled ? 'outline' : 'primary'}
										size="sm"
										data-testid="rules-bonus-toggle-{preset.presetId}"
									>
										{preset.enabled
											? ADMIN_RULES_PAGE_LABELS.disableButton
											: ADMIN_RULES_PAGE_LABELS.enableButton}
									</Button>
								</form>
								<form
									method="POST"
									action="?/removePreset"
									use:enhance={() => async ({ update }) => {
										await update();
										await invalidateAll();
									}}
									onsubmit={(e) => {
										if (!confirm(ADMIN_RULES_PAGE_LABELS.removeConfirm)) {
											e.preventDefault();
										}
									}}
								>
									<input type="hidden" name="presetId" value={preset.presetId} />
									<Button
										type="submit"
										variant="outline"
										size="sm"
										data-testid="rules-bonus-remove-{preset.presetId}"
									>
										{ADMIN_RULES_PAGE_LABELS.removeButton}
									</Button>
								</form>
							</div>
						</li>
					{/each}
				</ul>
			</section>
			{/snippet}
		</Card>
	{/if}
</div>
