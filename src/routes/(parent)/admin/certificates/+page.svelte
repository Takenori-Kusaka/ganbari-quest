<script lang="ts">
import { APP_LABELS, CERTIFICATES_PAGE_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import CertificateCard from '$lib/features/certificate/CertificateCard.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();

let childIdOverride = $state<number | undefined>(undefined);
const selectedChildId = $derived(
	childIdOverride !== undefined && data.children.some((c) => c.id === childIdOverride)
		? childIdOverride
		: (data.children[0]?.id ?? 0),
);

const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));

const groupedCerts = $derived.by(() => {
	if (!selectedChild) return {};
	const groups: Record<string, typeof selectedChild.certificates> = {};
	for (const cert of selectedChild.certificates) {
		const key = cert.category;
		if (!groups[key]) groups[key] = [];
		groups[key].push(cert);
	}
	return groups;
});

const categoryOrder = ['streak', 'level', 'monthly', 'category_master', 'annual'] as const;
const categoryNames: Record<string, string> = {
	streak: '🔥 連続記録',
	level: '🌟 レベルアップ',
	monthly: '📜 月間がんばり',
	category_master: '🎓 カテゴリマスター',
	annual: '🏆 年間がんばり大賞',
};
</script>

<svelte:head>
	<title>{PAGE_TITLES.certificates}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-lg font-bold text-[var(--color-text-primary)]">{CERTIFICATES_PAGE_LABELS.pageTitle}</h2>
		<a href="/admin/reports" class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">&larr; {CERTIFICATES_PAGE_LABELS.backToReportsLink}</a>
	</div>

	{#if !data.isPremium}
		<div class="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-feedback-warning-bg)] border border-[var(--color-feedback-warning-border)] text-sm">
			<span>⭐</span>
			<p class="text-[var(--color-feedback-warning-text)]">
				{CERTIFICATES_PAGE_LABELS.freePlanNotePrefix}<a href="/admin/license" class="underline font-medium">{CERTIFICATES_PAGE_LABELS.freePlanNoteLink}</a>{CERTIFICATES_PAGE_LABELS.freePlanNoteSuffix}
			</p>
		</div>
	{/if}

	{#if data.children.length > 0}
		<!-- Child selector -->
		<div class="flex gap-2 overflow-x-auto pb-2">
			{#each data.children as child (child.id)}
				<Button
					type="button"
					variant={selectedChildId === child.id ? 'primary' : 'outline'}
					size="sm"
					class="whitespace-nowrap {selectedChildId === child.id ? '' : 'bg-white text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]'}"
					onclick={() => {
						childIdOverride = child.id;
					}}
				>
					{child.nickname}
					<span class="text-xs opacity-75">({child.certificates.length})</span>
				</Button>
			{/each}
		</div>

		{#if selectedChild}
			{#if selectedChild.certificates.length === 0}
				<div class="text-center text-[var(--color-text-muted)] py-12">
					<p class="text-4xl mb-3">📜</p>
					<p class="font-bold mb-1">{CERTIFICATES_PAGE_LABELS.emptyTitle}</p>
					<p class="text-sm">{CERTIFICATES_PAGE_LABELS.emptyDesc}</p>
				</div>
			{:else}
				{#each categoryOrder as cat}
					{#if groupedCerts[cat]?.length}
						<div>
							<h3 class="text-sm font-bold text-[var(--color-text-secondary)] mb-2">{categoryNames[cat]}</h3>
							<div class="flex flex-col gap-2">
								{#each groupedCerts[cat] as cert (cert.id)}
									<CertificateCard certificate={cert} />
								{/each}
							</div>
						</div>
					{/if}
				{/each}
			{/if}
		{/if}
	{:else}
		<div class="text-center text-[var(--color-text-muted)] py-12">
			<p class="text-4xl mb-2">👧</p>
			<p class="font-bold">{CERTIFICATES_PAGE_LABELS.noChildrenTitle}</p>
		</div>
	{/if}
</div>
