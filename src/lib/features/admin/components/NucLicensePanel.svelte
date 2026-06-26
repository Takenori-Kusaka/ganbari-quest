<script lang="ts">
/**
 * NucLicensePanel.svelte — NUC セルフホスト版ライセンス画面 (EPIC #2327 / #2329)
 *
 * Mattermost Team Edition / Bitwarden self-hosted / GitLab CE 業界 prior art 整合の
 * Edition badge + 利用状況 + サポート link の 3 セクション構成。
 *
 * 削除セクション (NUC で意味なし、本コンポーネントには含めない):
 *   - ライセンスキー適用 — NUC = セルフホスト = キー入力意味なし
 *   - 「現在のプラン」表示 — NUC = ファミリープラン自動格上げ、本文表示は混乱の元
 *   - プラン管理 placeholder ("決済機能は現在準備中です") — 決済機能不要
 *   - 7 日間 trial CTA — 全機能既に有効
 *   - 支払い履歴 / 請求書 link — 課金なし
 *
 * 親コンポーネント: /admin/subscription/+page.svelte (薄ラッパー、子#2331)
 */
import { APP_LABELS, NUC_LICENSE_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import Card from '$lib/ui/primitives/Card.svelte';

interface PanelData {
	planStats: {
		activityCount: number;
		childCount: number;
	};
}

interface Props {
	data: PanelData;
}

let { data }: Props = $props();

const planStats = $derived(data.planStats);
</script>

<svelte:head>
	<title>{PAGE_TITLES.license}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6" data-testid="nuc-license-panel">
	<!-- 1. Edition badge (Mattermost Team Edition 整合) -->
	<Card variant="elevated" padding="lg">
		{#snippet children()}
			<div class="edition-badge" data-testid="nuc-edition-badge" data-tutorial="nuc-edition">
				<h2 class="text-xl font-bold text-[var(--color-text-primary)] mb-2">
					{NUC_LICENSE_LABELS.editionTitle}
				</h2>
				<p class="text-sm text-[var(--color-text-secondary)] leading-relaxed">
					{NUC_LICENSE_LABELS.editionDesc}
				</p>
			</div>
		{/snippet}
	</Card>

	<!-- 2. 利用状況 -->
	<Card variant="default" padding="lg">
		{#snippet children()}
			<h3
				class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4"
				data-tutorial="nuc-usage"
			>
				{NUC_LICENSE_LABELS.usageTitle}
			</h3>
			<dl class="grid gap-3" data-testid="nuc-usage-list">
				<div
					class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]"
				>
					<dt class="text-sm text-[var(--color-text-muted)]">
						{NUC_LICENSE_LABELS.usageChildrenLabel}
					</dt>
					<dd class="text-sm font-semibold text-[var(--color-text-primary)]">
						{NUC_LICENSE_LABELS.usageChildrenUnit(planStats.childCount)}
					</dd>
				</div>
				<div
					class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]"
				>
					<dt class="text-sm text-[var(--color-text-muted)]">
						{NUC_LICENSE_LABELS.usageActivitiesLabel}
					</dt>
					<dd class="text-sm font-semibold text-[var(--color-text-primary)]">
						{NUC_LICENSE_LABELS.usageActivitiesValue(planStats.activityCount)}
					</dd>
				</div>
				<div class="flex items-center justify-between py-2">
					<dt class="text-sm text-[var(--color-text-muted)]">
						{NUC_LICENSE_LABELS.usageRetentionLabel}
					</dt>
					<dd class="text-sm font-semibold text-[var(--color-text-primary)]">
						{NUC_LICENSE_LABELS.usageRetentionValue}
					</dd>
				</div>
			</dl>
		{/snippet}
	</Card>

	<!-- 3. サポート link -->
	<Card variant="default" padding="lg">
		{#snippet children()}
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-3">
				{NUC_LICENSE_LABELS.supportTitle}
			</h3>
			<p class="text-sm text-[var(--color-text-muted)] mb-3">
				{NUC_LICENSE_LABELS.supportDesc}
			</p>
			<ul class="space-y-2 text-sm" data-testid="nuc-support-links">
				<li>
					<a
						href="/inquiry/founder"
						class="text-[var(--color-text-link)] underline hover:no-underline"
					>
						{NUC_LICENSE_LABELS.contactLabel}
					</a>
				</li>
				<li>
					<a
						href="/legal/selfhost"
						class="text-[var(--color-text-link)] underline hover:no-underline"
					>
						{NUC_LICENSE_LABELS.docsLabel}
					</a>
				</li>
			</ul>
		{/snippet}
	</Card>
</div>
