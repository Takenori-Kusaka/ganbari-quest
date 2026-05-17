<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { ADMIN_RULES_PAGE_LABELS, APP_LABELS } from '$lib/domain/labels';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data, form } = $props();

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

<div class="max-w-3xl mx-auto px-4 py-6 space-y-6" data-testid="admin-rules-page">
	<header class="space-y-2">
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
		<!-- 取込済が無い場合 -->
		<Card padding="lg" variant="elevated">
			{#snippet children()}
			<div class="text-center space-y-3" data-testid="rules-empty-state">
				<p class="text-sm font-bold text-[var(--color-text-primary)]">
					{ADMIN_RULES_PAGE_LABELS.emptyTitle}
				</p>
				<p class="text-xs text-[var(--color-text-tertiary)]">
					{ADMIN_RULES_PAGE_LABELS.emptyDesc}
				</p>
				<a
					href="/marketplace?type=rule-preset"
					class="text-sm text-[var(--color-action-primary)] hover:underline"
					data-testid="rules-browse-marketplace"
				>
					{ADMIN_RULES_PAGE_LABELS.browseLink}
				</a>
			</div>
			{/snippet}
		</Card>
	{:else}
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
