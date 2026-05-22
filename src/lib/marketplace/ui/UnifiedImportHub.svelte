<script lang="ts">
/**
 * UnifiedImportHub — EPIC #2362 P4 / Issue #2370 / PO 指摘 ② 直接解決
 *
 * 5 種類の MarketplaceItemType (activity-pack / reward-set / checklist / rule-preset /
 * challenge-set) の import エントリポイントを統一する Hub UI。
 *
 * 設計原則:
 *   - Registry SSOT: `marketplaceRegistry.list()` から動的に type を列挙
 *     (新 type 追加時に本 component は変更不要)
 *   - 2 source dispatch: marketplace preset (`?/importMarketplace<Type>`) と
 *     file upload (`?/importFile`) を統一の form action 名規約で扱う
 *   - childId が必須な type (reward-set / checklist) は selectedChildId prop で渡す
 *   - DESIGN.md §5 primitives (Button / Card / FormField) 経由のみ。独自 UI ゼロ
 *
 * 関連:
 *   - ADR-0052 (MarketplaceTypeRegistry + ImportStrategy)
 *   - DESIGN.md §10 (Hick's Law / EPIC #2253 bridge ルール)
 */

import { enhance } from '$app/forms';
import { UNIFIED_IMPORT_HUB_LABELS } from '$lib/domain/labels';
// #2370: browser-safe な client-types のみ import (server services を巻き込まない)
import {
	getMarketplaceTypeMetaClient,
	MARKETPLACE_TYPE_METAS_CLIENT,
	type MarketplaceTypeCodeClient,
	type MarketplaceTypeMeta,
} from '$lib/marketplace/client-types';
import Button from '$lib/ui/primitives/Button.svelte';

type MarketplaceTypeCode = MarketplaceTypeCodeClient;

interface MarketplacePresetSummary {
	itemId: string;
	name: string;
	icon: string;
	itemCount: number;
	targetAgeMin?: number;
	targetAgeMax?: number;
}

interface Props {
	/** 表示対象の type コード（単一表示の場合）。省略時は全 registered type を tab 表示 */
	typeCode?: MarketplaceTypeCode;
	/** type ごとの marketplace preset 一覧（typeCode → list） */
	presets: Partial<Record<MarketplaceTypeCode, MarketplacePresetSummary[]>>;
	/** reward-set / checklist 等 requiresChildId === true の場合に渡す childId */
	selectedChildId?: number;
	/** 取込完了時の callback（メッセージ + result data） */
	onimported?: (message: string) => void;
	/** dialog close 等の callback */
	onclose?: () => void;
	/** disabled (plan 制限・権限) */
	disabled?: boolean;
	/** #2391: 既に取込済みの presetId 集合 (checklist 等で「取込済」バッジ表示・ボタン disable に使う) */
	importedPresetIds?: ReadonlySet<string>;
}

let {
	typeCode,
	presets,
	selectedChildId,
	onimported,
	onclose,
	disabled = false,
	importedPresetIds,
}: Props = $props();

// client-types SSOT から動的に type 一覧を取得（typeCode 指定時はその 1 件のみ）
const descriptors = $derived<MarketplaceTypeMeta[]>(
	typeCode ? [getMarketplaceTypeMetaClient(typeCode)] : [...MARKETPLACE_TYPE_METAS_CLIENT],
);

// 単一 type モードかタブ表示モードか
const isSingleType = $derived(descriptors.length === 1);

// 現在選択されている type（タブ表示時のみ）
let activeTypeCode = $state<MarketplaceTypeCode | null>(null);

$effect(() => {
	const first = descriptors[0];
	if (!activeTypeCode && first) {
		activeTypeCode = first.typeCode;
	}
});

const activeDescriptor = $derived<MarketplaceTypeMeta | null>(
	descriptors.find((d) => d.typeCode === activeTypeCode) ?? descriptors[0] ?? null,
);

const activePresets = $derived(activeDescriptor ? (presets[activeDescriptor.typeCode] ?? []) : []);

// childId 要件
const requiresChildId = $derived(activeDescriptor?.requiresChildId ?? false);
const hasChildId = $derived(
	selectedChildId !== undefined && selectedChildId !== null && selectedChildId > 0,
);
const canImport = $derived(!disabled && (!requiresChildId || hasChildId));

// 進行中表示
let importLoading = $state(false);
let fileImportLoading = $state(false);

// type 別の form action 名規約
// activity-pack: ?/importPack | ?/importFile (既存)
// reward-set: ?/importMarketplaceRewardSet
// checklist: ?/importMarketplaceChecklist
// rule-preset: ?/importMarketplaceRulePreset
// challenge-set: ?/importMarketplaceChallengeSet
function getImportAction(code: MarketplaceTypeCode): string {
	switch (code) {
		case 'activity-pack':
			return '?/importPack';
		case 'reward-set':
			return '?/importMarketplaceRewardSet';
		case 'checklist':
			return '?/importMarketplaceChecklist';
		case 'rule-preset':
			return '?/importMarketplaceRulePreset';
		case 'challenge-set':
			return '?/importMarketplaceChallengeSet';
	}
}

function getTypeHint(code: MarketplaceTypeCode): string {
	switch (code) {
		case 'activity-pack':
			return UNIFIED_IMPORT_HUB_LABELS.typeHintActivityPack;
		case 'reward-set':
			return UNIFIED_IMPORT_HUB_LABELS.typeHintRewardSet;
		case 'checklist':
			return UNIFIED_IMPORT_HUB_LABELS.typeHintChecklist;
		case 'rule-preset':
			return UNIFIED_IMPORT_HUB_LABELS.typeHintRulePreset;
		case 'challenge-set':
			return UNIFIED_IMPORT_HUB_LABELS.typeHintChallengeSet;
	}
}
</script>

<!-- legacy testid `activity-import-panel` を維持 (E2E tests/e2e/admin-activities-add-ux.spec.ts 互換) -->
<div
	class="unified-import-hub"
	data-testid={activeDescriptor?.typeCode === 'activity-pack'
		? 'activity-import-panel'
		: 'unified-import-hub'}
	data-active-type={activeDescriptor?.typeCode ?? ''}
>
	<div class="hub-header">
		<h3 class="hub-title">{UNIFIED_IMPORT_HUB_LABELS.heading}</h3>
		<p class="hub-desc">{UNIFIED_IMPORT_HUB_LABELS.description}</p>
	</div>

	{#if !isSingleType}
		<!-- 5 type 横断選択タブ（複数 type モード） -->
		<div
			class="type-tabs"
			role="tablist"
			aria-label={UNIFIED_IMPORT_HUB_LABELS.typeTabAriaLabel}
			data-testid="unified-import-hub-tabs"
		>
			{#each descriptors as desc}
				<Button
					variant={activeTypeCode === desc.typeCode ? 'primary' : 'ghost'}
					size="sm"
					onclick={() => { activeTypeCode = desc.typeCode; }}
					data-testid="unified-import-hub-tab-{desc.typeCode}"
				>
					{desc.displayLabel}
				</Button>
			{/each}
		</div>
	{/if}

	{#if activeDescriptor}
		<p class="type-hint" data-testid="unified-import-hub-hint">
			{getTypeHint(activeDescriptor.typeCode)}
		</p>

		{#if requiresChildId && !hasChildId}
			<p class="child-hint" data-testid="unified-import-hub-child-hint">
				{UNIFIED_IMPORT_HUB_LABELS.childRequiredHint}
			</p>
		{/if}

		<!-- (A) Marketplace preset 一覧 -->
		<section class="source-section" data-testid="unified-import-hub-marketplace">
			<h4 class="section-title">{UNIFIED_IMPORT_HUB_LABELS.marketplaceHeading}</h4>
			{#if activePresets.length === 0}
				<p class="empty-text">{UNIFIED_IMPORT_HUB_LABELS.emptyMarketplace}</p>
			{:else}
				<div class="preset-grid">
					{#each activePresets as preset (preset.itemId)}
						{@const alreadyImported = importedPresetIds?.has(preset.itemId) ?? false}
						<form
							method="POST"
							action={getImportAction(activeDescriptor.typeCode)}
							use:enhance={() => {
								importLoading = true;
								return async ({ result, update }) => {
									importLoading = false;
									if (result.type === 'success' && result.data) {
										const d = result.data as Record<string, unknown>;
										const imported = Number(d.imported ?? 0);
										const skipped = Number(d.skipped ?? 0);
										const name = String(d.packName ?? preset.name);
										const msg =
											imported === 0 && skipped > 0
												? UNIFIED_IMPORT_HUB_LABELS.resultAllDuplicates(name)
												: UNIFIED_IMPORT_HUB_LABELS.resultSuccess(name, imported, skipped);
										onimported?.(msg);
										onclose?.();
									}
									await update({ reset: false });
								};
							}}
						>
							{#if requiresChildId && hasChildId}
								<input type="hidden" name="childId" value={selectedChildId} />
							{/if}
							<input type="hidden" name="packId" value={preset.itemId} />
							<input type="hidden" name="presetId" value={preset.itemId} />
							<!-- #2391: legacy testid `marketplace-preset-import-{itemId}` を主 testid に維持
							     (E2E tests/e2e/marketplace-checklist-import.spec.ts 互換)。
							     新 testid 名は未使用のため主 testid を legacy 名に合わせる。 -->
							<button
								type="submit"
								disabled={importLoading || !canImport || alreadyImported}
								class="preset-card"
								data-testid="marketplace-preset-import-{preset.itemId}"
							>
								<span class="preset-icon">{preset.icon}</span>
								<div class="preset-meta">
									<p class="preset-name">
										{preset.name}
										{#if alreadyImported}
											<span
												class="imported-badge"
												data-testid="marketplace-preset-imported-{preset.itemId}"
											>{UNIFIED_IMPORT_HUB_LABELS.importedBadge}</span>
										{/if}
									</p>
									<p class="preset-sub">
										{UNIFIED_IMPORT_HUB_LABELS.itemCountSuffix(preset.itemCount)}
										{#if preset.targetAgeMin !== undefined && preset.targetAgeMax !== undefined}
											{UNIFIED_IMPORT_HUB_LABELS.itemAgeSeparator}{UNIFIED_IMPORT_HUB_LABELS.targetAgeRange(preset.targetAgeMin, preset.targetAgeMax)}
										{/if}
									</p>
								</div>
								<span class="preset-cta">
									{importLoading
										? UNIFIED_IMPORT_HUB_LABELS.processingText
										: UNIFIED_IMPORT_HUB_LABELS.addBtn}
								</span>
							</button>
						</form>
					{/each}
				</div>
			{/if}
		</section>

		<!-- (B) File source (activity-pack でのみ提供されている既存挙動を踏襲) -->
		{#if activeDescriptor.typeCode === 'activity-pack'}
			<section class="source-section" data-testid="unified-import-hub-file">
				<h4 class="section-title">{UNIFIED_IMPORT_HUB_LABELS.fileHeading}</h4>
				<p class="hub-desc">{UNIFIED_IMPORT_HUB_LABELS.fileDesc}</p>
				<form
					method="POST"
					action="?/importFile"
					enctype="multipart/form-data"
					use:enhance={() => {
						fileImportLoading = true;
						return async ({ result, update }) => {
							fileImportLoading = false;
							if (result.type === 'success' && result.data) {
								const d = result.data as Record<string, unknown>;
								const imported = Number(d.imported ?? 0);
								const skipped = Number(d.skipped ?? 0);
								const name = String(d.packName ?? 'ファイル');
								const msg =
									imported === 0 && skipped > 0
										? UNIFIED_IMPORT_HUB_LABELS.resultAllDuplicates(name)
										: UNIFIED_IMPORT_HUB_LABELS.resultSuccess(name, imported, skipped);
								onimported?.(msg);
								onclose?.();
							}
							await update({ reset: false });
						};
					}}
				>
					<div class="file-row">
						<input
							type="file"
							name="file"
							accept=".json,.csv"
							class="file-input"
							required
							disabled={!canImport}
						/>
						<Button
							type="submit"
							variant="success"
							size="sm"
							disabled={fileImportLoading || !canImport}
						>
							{fileImportLoading
								? UNIFIED_IMPORT_HUB_LABELS.processingText
								: UNIFIED_IMPORT_HUB_LABELS.fileImportBtn}
						</Button>
					</div>
				</form>
			</section>
		{/if}
	{/if}
</div>

<style>
	.unified-import-hub {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		background: var(--color-surface-card);
		border-radius: var(--radius-lg);
		border: 1px solid var(--color-border-default);
	}
	.hub-header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.hub-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text);
	}
	.hub-desc {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}
	.type-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	.type-hint {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		padding: 0.5rem 0.75rem;
		background: var(--color-surface-muted);
		border-radius: var(--radius-sm);
	}
	.child-hint {
		font-size: 0.8125rem;
		color: var(--color-feedback-warning-text);
		padding: 0.5rem 0.75rem;
		background: var(--color-feedback-warning-bg);
		border-radius: var(--radius-sm);
	}
	.source-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.section-title {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text-secondary);
	}
	.empty-text {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		text-align: center;
		padding: 1rem 0;
	}
	.preset-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
	}
	.preset-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		background: var(--color-surface);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-default);
		text-align: left;
		cursor: pointer;
		transition: border-color 0.15s ease, background 0.15s ease;
	}
	.preset-card:hover:not(:disabled) {
		border-color: var(--color-border-focus);
		background: var(--color-surface-muted);
	}
	.preset-card:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.preset-icon {
		font-size: 1.5rem;
	}
	.preset-meta {
		flex: 1;
		min-width: 0;
	}
	.preset-name {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text);
		margin: 0;
	}
	.imported-badge {
		display: inline-block;
		margin-left: 0.375rem;
		padding: 0.0625rem 0.375rem;
		font-size: 0.625rem;
		font-weight: 500;
		background: var(--color-feedback-success-bg);
		color: var(--color-feedback-success-text);
		border-radius: var(--radius-sm);
	}
	.preset-sub {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0;
	}
	.preset-cta {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-action-success);
		flex-shrink: 0;
	}
	.file-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.file-input {
		flex: 1;
		font-size: 0.875rem;
	}
</style>
