<script lang="ts">
import { tick } from 'svelte';
import { enhance } from '$app/forms';
import { invalidateAll, replaceState } from '$app/navigation';
import { page } from '$app/state';
import { ADMIN_RULES_PAGE_LABELS, APP_LABELS, OVERFLOW_MENU_LABELS } from '$lib/domain/labels';
// #2391 (Phase 2): in-page rule-preset 取込 UI を統一
// #2558 段階2 横展開: admin 内 marketplace 風 browse UI (UnifiedImportHub) を撤去し
// `/marketplace?type=rule-preset` への画面遷移に統一 (DESIGN.md §10)。
import { TEMPLATE_TERMS } from '$lib/domain/terms';
// CX-DoR #9・#11 横展開 (Round 18): empty state を共通 SSOT に統一 (NN/G #4 consistency)
import UnifiedEmptyState from '$lib/marketplace/ui/UnifiedEmptyState.svelte';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import OverflowMenu, { type OverflowMenuItem } from '$lib/ui/primitives/OverflowMenu.svelte';
import { showToast } from '$lib/ui/primitives/Toast.svelte';

let { data, form } = $props();

// #2391 (Phase 2): marketplace import 完了メッセージ
let marketplaceImportMessage = $state('');

// #2362 PR-6: OverflowMenu からの「未実装」表示用 Dialog 群
let helpDialogOpen = $state(false);
let restoreDialogOpen = $state(false);
let exportDialogOpen = $state(false);

// #2362 PR-6: `?import=<presetId>` auto-import 制御
// load 側で validate 済 (importPresetId / importPresetError)、本 client 側は
// 1 度だけ form を programmatically submit + URL を `?import=` 除去
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

// #2362 PR-6: import action 完了後の form 戻り値を観察し toast 表示
// SvelteKit が action union から narrowing を自動推論できないため、
// importMarketplaceRulePreset 専用の shape として cast (top-level shape:
// { packName, imported, skipped, total, errors, presetId })
type ImportFormResult = {
	packName?: string;
	imported?: number;
	skipped?: number;
	total?: number;
	errors?: string[];
	presetId?: string;
	// #2823: demo write-guard (buildDemoNoopResponseBody) が返す no-op マーカー。
	// demo 応答は presetId を含まないため、real 経路 (presetId 必須) とは別分岐で扱う。
	demo?: boolean;
};

// 同一 form result の二重発火防止 — invalidateAll 後の re-render / 別 form action 後にも
// effect 再実行されるため、最後に処理した import result のシリアライズを記録して比較する。
let lastProcessedImportFingerprint = $state<string | null>(null);
// #2823: demo no-op の二重 toast 防止 (real 経路と同様、effect 再走で多重発火しないよう 1 回のみ)。
let demoNoopToastShown = $state(false);

$effect(() => {
	if (!form) return;
	const r = form as ImportFormResult;
	// #2823: demo 環境の no-op 取込 ({demo:true, imported:0} で presetId なし) を正直に明示。
	// activity / reward / challenge / checklist と同文言で 5 type の体験を統一する (NN/G #1 / #4)。
	// real 経路 (presetId 必須) より先に判定し、demo 応答が無言で素通りするのを防ぐ。
	if (r.demo === true) {
		if (!demoNoopToastShown) {
			demoNoopToastShown = true;
			showToast(ADMIN_RULES_PAGE_LABELS.importDemo, undefined, 'info');
			cleanupImportQueryParam();
		}
		return;
	}
	if (r.presetId && typeof r.imported === 'number') {
		// fingerprint: presetId + imported + skipped で同一 import result の識別。
		// 同じ result の effect 再実行では toast を出さない。
		const fp = `${r.presetId}|${r.imported}|${r.skipped ?? 0}|${r.total ?? 0}`;
		if (fp === lastProcessedImportFingerprint) return;
		lastProcessedImportFingerprint = fp;
		const display = r.packName ?? r.presetId;
		if (r.imported > 0) {
			showToast(ADMIN_RULES_PAGE_LABELS.importToastSuccess(display), undefined, 'success');
		} else if (r.skipped === r.total && (r.total ?? 0) > 0) {
			showToast(ADMIN_RULES_PAGE_LABELS.importToastDuplicate(display), undefined, 'info');
		} else if (r.errors && r.errors.length > 0) {
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
	// $effect は mount 直後に fire するため初回は router 未初期化で
	// `replaceState` from $app/navigation が throw する。tick() で 1 回 microtask を
	// 待つと router init が完了するため安全に呼べる (PR #2478 review feedback)。
	await tick();
	try {
		replaceState(u, page.state ?? {});
	} catch {
		// fallback: tick 後でも router が未初期化な極端なケースのみ
		// window.history.replaceState (SvelteKit warning 出るが URL bar 更新のみで navigation 無し)
		window.history.replaceState(window.history.state, '', u.toString());
	}
}

// #2362 PR-6: OverflowMenu items (PR-2 OVERFLOW_MENU_LABELS 経由)
// rule bonus は family scope なので AI 提案は対象外 (個別 child カスタマイズが効きにくい)
const overflowItems = $derived<OverflowMenuItem[]>([
	{
		type: 'action',
		id: OVERFLOW_MENU_LABELS.items.marketplace.id,
		label: OVERFLOW_MENU_LABELS.items.marketplace.label,
		icon: OVERFLOW_MENU_LABELS.items.marketplace.icon,
		onSelect: () => {
			window.location.href = '/marketplace?type=rule-preset';
		},
	},
	{ type: 'divider', id: 'divider-1' },
	{
		type: 'action',
		id: OVERFLOW_MENU_LABELS.items.restore.id,
		label: OVERFLOW_MENU_LABELS.items.restore.label,
		icon: OVERFLOW_MENU_LABELS.items.restore.icon,
		onSelect: () => {
			restoreDialogOpen = true;
		},
	},
	{
		type: 'action',
		id: OVERFLOW_MENU_LABELS.items.export.id,
		label: OVERFLOW_MENU_LABELS.items.export.label,
		icon: OVERFLOW_MENU_LABELS.items.export.icon,
		onSelect: () => {
			exportDialogOpen = true;
		},
	},
	{ type: 'divider', id: 'divider-2' },
	{
		type: 'action',
		id: OVERFLOW_MENU_LABELS.items.help.id,
		label: OVERFLOW_MENU_LABELS.items.help.label,
		icon: OVERFLOW_MENU_LABELS.items.help.icon,
		onSelect: () => {
			helpDialogOpen = true;
		},
	},
]);

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

<!-- #2362 PR-6: ?import=<presetId> auto-import 用の hidden form (programmatic submit) -->
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
	<header class="flex items-start justify-between gap-2">
		<div class="space-y-2 flex-1 min-w-0">
			<h1 class="text-xl font-bold text-[var(--color-text-primary)]">
				{ADMIN_RULES_PAGE_LABELS.pageTitle}
			</h1>
			<p class="text-sm text-[var(--color-text-secondary)]">
				{ADMIN_RULES_PAGE_LABELS.pageDescription}
			</p>
		</div>
		<!-- #2362 PR-6: OverflowMenu (top-right ⋮) -->
		<OverflowMenu
			items={overflowItems}
			ariaLabel={ADMIN_RULES_PAGE_LABELS.overflowMenuAriaLabel}
			testid="rules-overflow-menu"
		/>
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
		<!-- 取込済が無い場合。CX-DoR #9・#11 横展開 (Round 18): 独自 markup を UnifiedEmptyState
		     SSOT に統一。文言 (emptyTitle / emptyDesc / browseLink) を override props で渡し視覚回帰最小。
		     marketplace browse は link mode (form 不要 page、SvelteKit 標準遷移)。testid は E2E 互換維持。 -->
		<Card padding="lg" variant="elevated">
			{#snippet children()}
			<UnifiedEmptyState
				testid="rules-empty-state"
				noItemsText={ADMIN_RULES_PAGE_LABELS.emptyTitle}
				descText={ADMIN_RULES_PAGE_LABELS.emptyDesc}
				showPrimary={false}
				secondaryMode="link"
				browseHref="/marketplace?type=rule-preset"
				importLinkLabel={ADMIN_RULES_PAGE_LABELS.browseLink}
				importTestid="rules-browse-marketplace"
			/>
			{/snippet}
		</Card>
	{/if}

	<!--
		#2558 段階2 横展開: in-page UnifiedImportHub (admin 内 marketplace 風 browse UI、
		二重管理) を撤去し marketplace への画面遷移に統一 (DESIGN.md §10 構造的ルール
		「marketplace 取込はマーケットプレイス画面に一本化」)。取込実行は marketplace 詳細
		→ `?import=<presetId>` → 即取込 + toast の正規経路 (marketplace-import-flow.md §3.1)
		に合流させる。

		marketplace 取込メッセージ + secondary link「みんなのテンプレートを見る」
		(empty state / 運用期到達性、DESIGN.md §10「bulk import bridge ルール」整合) は保持。
	-->
	<section data-testid="rules-marketplace-import-section">
		{#if marketplaceImportMessage}
			<div
				class="mb-2 px-3 py-2 rounded-md text-sm bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)]"
				data-testid="rules-marketplace-import-result"
			>
				{marketplaceImportMessage}
			</div>
		{/if}
		<a
			href="/marketplace?type=rule-preset"
			class="inline-flex items-center gap-1 text-xs text-[var(--color-action-primary)] hover:underline"
			data-testid="rules-marketplace-browse-link"
		>
			📦 {TEMPLATE_TERMS.browse}
		</a>
	</section>

	{#if data.bonusPresets.length > 0}
		<!-- bonus preset 一覧 -->
		<Card padding="lg" variant="elevated">
			{#snippet children()}
			<section class="space-y-3" data-testid="rules-bonus-section">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-bold text-[var(--color-text-primary)]">
						{ADMIN_RULES_PAGE_LABELS.sectionBonusTitle}
					</h2>
					<a
						href="/marketplace?type=rule-preset"
						class="text-xs text-[var(--color-action-primary)] hover:underline"
					>
						{ADMIN_RULES_PAGE_LABELS.browseLink}
					</a>
				</div>
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

	<!-- exchange 系の注釈 (取込済 reward は /admin/rewards 側で管理) -->
	<Card padding="md">
		{#snippet children()}
		<p class="text-xs text-[var(--color-text-tertiary)]">
			{ADMIN_RULES_PAGE_LABELS.sectionExchangeDesc}
		</p>
		<a
			href="/admin/rewards"
			class="text-xs text-[var(--color-action-primary)] hover:underline"
		>
			{ADMIN_RULES_PAGE_LABELS.rewardsLinkLabel}
		</a>
		{/snippet}
	</Card>

	<!-- penalty / special タイプの説明 -->
	<Card padding="md">
		{#snippet children()}
		<h2 class="text-sm font-bold text-[var(--color-text-primary)] mb-1">
			{ADMIN_RULES_PAGE_LABELS.penaltyNotImplementedTitle}
		</h2>
		<p class="text-xs text-[var(--color-text-tertiary)]">
			{ADMIN_RULES_PAGE_LABELS.penaltyNotImplementedDesc}
		</p>
		{/snippet}
	</Card>
</div>

<!-- #2362 PR-6: OverflowMenu からの未実装機能告知 + ヘルプ Dialog 群 -->
<Dialog
	bind:open={helpDialogOpen}
	title={ADMIN_RULES_PAGE_LABELS.helpDialogTitle}
	testid="rules-help-dialog"
>
	{#snippet children()}
	<p class="text-sm text-[var(--color-text-secondary)]">
		{ADMIN_RULES_PAGE_LABELS.helpDialogDesc}
	</p>
	{/snippet}
</Dialog>
<Dialog
	bind:open={restoreDialogOpen}
	title={ADMIN_RULES_PAGE_LABELS.restoreNotImplementedTitle}
	testid="rules-restore-dialog"
>
	{#snippet children()}
	<p class="text-sm text-[var(--color-text-secondary)]">
		{ADMIN_RULES_PAGE_LABELS.restoreNotImplementedDesc}
	</p>
	{/snippet}
</Dialog>
<Dialog
	bind:open={exportDialogOpen}
	title={ADMIN_RULES_PAGE_LABELS.exportNotImplementedTitle}
	testid="rules-export-dialog"
>
	{#snippet children()}
	<p class="text-sm text-[var(--color-text-secondary)]">
		{ADMIN_RULES_PAGE_LABELS.exportNotImplementedDesc}
	</p>
	{/snippet}
</Dialog>
