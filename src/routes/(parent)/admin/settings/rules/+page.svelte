<script lang="ts">
import { tick } from 'svelte';
import { enhance } from '$app/forms';
import { invalidateAll, replaceState } from '$app/navigation';
import { page } from '$app/state';
import { toJSTDateString } from '$lib/domain/date-utils';
import { ADMIN_RULES_PAGE_LABELS, APP_LABELS, UI_LABELS } from '$lib/domain/labels';
// #2895: marketplace 陳列の in-page browse UI / OverflowMenu / help-restore-export dialog を撤去し、
// 本画面は「取込済 bonus ルールの確認 + ON/OFF + 削除」に簡素化。
// marketplace 詳細 → `?import=<presetId>` の bonus auto-import 経路は bonus 取込導線として維持する。
// UnifiedEmptyState は SSOT 維持 (CX-DoR #11、NN/G #4 consistency)。
import UnifiedEmptyState from '$lib/marketplace/ui/UnifiedEmptyState.svelte';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { showToast } from '$lib/ui/primitives/Toast.svelte';

let { data, form } = $props();

// #4023: 「保護を外す方向」「取り消せない方向」の操作にだけ確認を 1 枚挟む共通ガード。
//
// 停止は use:enhance の cancel() で行う。`onsubmit` + `e.preventDefault()` では
// use:enhance が form に別途登録する submit listener が defaultPrevented を見ないため、
// キャンセルしても action が実行されてしまう (旧 removePreset の確認はこの経路で無効化されていた)。
// 確認 UI は docs/DESIGN.md §5 の Dialog primitive を使う (native confirm() は不採用)。
type PendingConfirm = {
	formEl: HTMLFormElement;
	title: string;
	body: string;
	acceptLabel: string;
};
let pendingConfirm = $state<PendingConfirm | null>(null);
let confirmOpen = $state(false);
// 確認済みの form は 1 回だけ素通しする (requestSubmit で再入する submit を通すため)。
let confirmedForm: HTMLFormElement | null = null;

/** 確認済みなら true (flag を消費)。未確認なら確認ダイアログを開いて false を返す。 */
function passConfirm(
	formEl: HTMLFormElement,
	title: string,
	body: string,
	acceptLabel: string,
): boolean {
	if (confirmedForm === formEl) {
		confirmedForm = null;
		return true;
	}
	pendingConfirm = { formEl, title, body, acceptLabel };
	confirmOpen = true;
	return false;
}

function acceptConfirm() {
	const p = pendingConfirm;
	confirmOpen = false;
	pendingConfirm = null;
	if (!p) return;
	confirmedForm = p.formEl;
	p.formEl.requestSubmit();
}

function dismissConfirm() {
	confirmOpen = false;
	pendingConfirm = null;
}

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
		// #4711: 種類違いは「失敗 → 再試行」ではなく専用文言 + 正規経路 (交換型 = ごほうび管理)。
		// 表示名は load 側で marketplace から引く (内部 ID を出さない)。
		const name = data.importPresetName ?? data.importPresetIdRaw;
		const hint = data.importWrongTypeHref
			? ADMIN_RULES_PAGE_LABELS.importWrongTypeExchangeHint
			: ADMIN_RULES_PAGE_LABELS.importWrongTypeNotImportable;
		showToast(ADMIN_RULES_PAGE_LABELS.importToastWrongType(name), hint, 'error');
		importMessage = {
			text: `${ADMIN_RULES_PAGE_LABELS.importToastWrongType(name)} ${hint}`,
			tone: 'error',
			href: data.importWrongTypeHref,
		};
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

// #4711: 取込結果の in-page banner (Toast との 2 層構成、DESIGN.md §5 Toast)。
// Toast は 3 秒で消えるため、2 回目取込の「取込済み」や種類違いの案内が見逃されないよう
// role="status" の banner を併置する (E2E もこちらを待つ)。
type ImportMessage = { text: string; tone: 'success' | 'info' | 'error'; href?: string | null };
let importMessage = $state<ImportMessage | null>(null);

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
			importMessage = {
				text: ADMIN_RULES_PAGE_LABELS.importToastSuccess(display),
				tone: 'success',
			};
		} else if ((r.skipped ?? 0) > 0) {
			// #4711: duplicate 判定は preset 単位 (imported === 0 && skipped > 0)。bonus は
			// preset 1 件を skipped=1 で返し total は rule 数 (3) なので、旧条件
			// `skipped === total` では 2 回目取込が無反応だった。
			showToast(ADMIN_RULES_PAGE_LABELS.importToastDuplicate(display), undefined, 'info');
			importMessage = { text: ADMIN_RULES_PAGE_LABELS.importToastDuplicate(display), tone: 'info' };
		} else if ((r.failed ?? 0) > 0) {
			// #2955: errors.length 判定だと rule-preset の warnings (非失敗) が error toast に
			// 誤判定される (penalty/special の no-op warning 等)。failed (genuine error 数) で判定する。
			showToast(ADMIN_RULES_PAGE_LABELS.importToastError(display), undefined, 'error');
			importMessage = { text: ADMIN_RULES_PAGE_LABELS.importToastError(display), tone: 'error' };
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

// 取込日時の日付化は JST SSOT 経由 (#4015)。ローカル getter だと SSR (UTC Lambda) と
// client (ブラウザ TZ) で表示日が変わり、JST 00:00〜09:00 の取込が前日表示になる。
function formatImportedAt(iso: string): string {
	try {
		const [y, m, d] = toJSTDateString(new Date(iso)).split('-');
		return `${y}/${Number(m)}/${Number(d)}`;
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

	{#if importMessage}
		<!-- #4711: 取込結果 banner (Toast 2 層目)。種類違いは正規経路への link を添える。 -->
		<div
			role="status"
			class="rounded-xl p-3 text-sm border {importMessage.tone === 'success'
				? 'bg-[var(--color-feedback-success-bg)] border-[var(--color-feedback-success-border)] text-[var(--color-feedback-success-text)]'
				: importMessage.tone === 'error'
					? 'bg-[var(--color-feedback-error-bg)] border-[var(--color-feedback-error-border)] text-[var(--color-feedback-error-text)]'
					: 'bg-[var(--color-feedback-info-bg)] border-[var(--color-feedback-info-border)] text-[var(--color-feedback-info-text)]'}"
			data-testid="rules-action-message"
			data-tone={importMessage.tone}
		>
			<span>{importMessage.text}</span>
			{#if importMessage.href}
				<a
					href={importMessage.href}
					class="ml-2 font-bold underline"
					data-testid="rules-import-wrong-type-link"
				>
					{ADMIN_RULES_PAGE_LABELS.importWrongTypeGoToRewards}
				</a>
			{/if}
		</div>
	{/if}

	{#if form?.toggleSuccess || form?.removeSuccess || form?.rewardAutoApproveSuccess}
		<div
			class="bg-[var(--color-feedback-success-bg)] border border-[var(--color-feedback-success-border)] text-[var(--color-feedback-success-text)] rounded-xl p-3 text-sm"
			data-testid="rules-action-success"
		>
			{#if form?.rewardAutoApproveSuccess}
				{ADMIN_RULES_PAGE_LABELS.rewardApprovalSuccess}
			{:else if form?.removeSuccess}
				{ADMIN_RULES_PAGE_LABELS.removeSuccess}
			{:else}
				{ADMIN_RULES_PAGE_LABELS.updateSuccess}
			{/if}
		</div>
	{/if}

	<!-- #3339: ごほうび交換のしかた（即時交換 / 親承認）。settings KVS reward_auto_approve、既定=承認必須。 -->
	<Card padding="lg" variant="elevated">
		{#snippet children()}
		<!-- #3954: ページガイド (settings-rules-approval) の anchor。常在セクション。 -->
		<section
			class="space-y-3"
			data-testid="rules-reward-approval-section"
			data-tutorial="rules-reward-approval"
		>
			<h2 class="text-sm font-bold text-[var(--color-text-primary)]">
				{ADMIN_RULES_PAGE_LABELS.rewardApprovalSectionTitle}
			</h2>
			<p class="text-xs text-[var(--color-text-tertiary)]">
				{ADMIN_RULES_PAGE_LABELS.rewardApprovalSectionDesc}
			</p>
			<div class="flex items-start gap-3 justify-between flex-wrap">
				<div class="flex-1 min-w-0 space-y-1">
					<div class="flex items-center gap-2">
						{#if data.rewardAutoApprove}
							<Badge variant="info" size="sm">
								{ADMIN_RULES_PAGE_LABELS.rewardApprovalInstantState}
							</Badge>
						{:else}
							<Badge variant="success" size="sm">
								{ADMIN_RULES_PAGE_LABELS.rewardApprovalRequireState}
							</Badge>
						{/if}
					</div>
					<p class="text-xs text-[var(--color-text-secondary)]">
						{data.rewardAutoApprove
							? ADMIN_RULES_PAGE_LABELS.rewardApprovalInstantDesc
							: ADMIN_RULES_PAGE_LABELS.rewardApprovalRequireDesc}
					</p>
				</div>
				<form
					method="POST"
					action="?/setRewardAutoApprove"
					use:enhance={({ formElement, formData, cancel }) => {
						// #4023 AC1 / AC2: 承認必須を外す方向 (承認必須 → 即時交換 = enabled true) だけ確認する。
						// 承認必須に戻す安全側の操作は 1 クリックのまま遅くしない。
						// 方向判定は submit される値 (formData) から取る。`data` を本 callback 内で読むと
						// use:enhance の parameter 式が reactive になり action の再セットアップを招くため。
						if (
							formData.get('enabled') === 'true' &&
							!passConfirm(
								formElement,
								ADMIN_RULES_PAGE_LABELS.rewardApprovalInstantConfirmTitle,
								ADMIN_RULES_PAGE_LABELS.rewardApprovalInstantConfirmBody,
								ADMIN_RULES_PAGE_LABELS.rewardApprovalEnableInstantButton,
							)
						) {
							cancel();
							return;
						}
						return async ({ update }) => {
							await update();
							await invalidateAll();
						};
					}}
				>
					<input type="hidden" name="enabled" value={data.rewardAutoApprove ? 'false' : 'true'} />
					<Button
						type="submit"
						variant={data.rewardAutoApprove ? 'outline' : 'primary'}
						size="sm"
						data-testid="rules-reward-approval-toggle"
					>
						{data.rewardAutoApprove
							? ADMIN_RULES_PAGE_LABELS.rewardApprovalDisableInstantButton
							: ADMIN_RULES_PAGE_LABELS.rewardApprovalEnableInstantButton}
					</Button>
				</form>
			</div>
		</section>
		{/snippet}
	</Card>

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
									use:enhance={({ formElement, cancel }) => {
										// #4023: 旧実装は onsubmit + preventDefault だったため
										// キャンセルしても enhance 側の submit listener が走り削除が通っていた。
										// 同一ページ内で確認機構を 1 つに揃える。
										if (
											!passConfirm(
												formElement,
												ADMIN_RULES_PAGE_LABELS.removeConfirmTitle,
												ADMIN_RULES_PAGE_LABELS.removeConfirm,
												ADMIN_RULES_PAGE_LABELS.removeButton,
											)
										) {
											cancel();
											return;
										}
										return async ({ update }) => {
											await update();
											await invalidateAll();
										};
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

<!-- #4023: 確認ダイアログ (DESIGN.md §5 Dialog primitive)。承認必須の解除 / ルール削除で共用。 -->
<Dialog
	bind:open={confirmOpen}
	onOpenChange={(details) => {
		if (!details.open) dismissConfirm();
	}}
	title={pendingConfirm?.title ?? ''}
	size="md"
	testid="rules-confirm-dialog"
>
	<p class="text-sm text-[var(--color-text-secondary)]">
		{pendingConfirm?.body ?? ''}
	</p>
	<div class="mt-4 flex items-center justify-end gap-2">
		<Button
			type="button"
			variant="outline"
			size="sm"
			onclick={dismissConfirm}
			data-testid="rules-confirm-cancel"
		>
			{UI_LABELS.cancel}
		</Button>
		<Button
			type="button"
			variant="primary"
			size="sm"
			onclick={acceptConfirm}
			data-testid="rules-confirm-accept"
		>
			{pendingConfirm?.acceptLabel ?? UI_LABELS.confirm}
		</Button>
	</div>
</Dialog>
