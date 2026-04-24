<script lang="ts">
import { enhance } from '$app/forms';
import { ACHIEVEMENTS_LABELS, APP_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import { ErrorAlert } from '$lib/ui/components';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { data, form } = $props();

// ユーザー選択を保持。undefined = デフォルト（先頭の子供）
let childIdOverride = $state<number | undefined>(undefined);
const selectedChildId = $derived(
	childIdOverride !== undefined && data.children.some((c) => c.id === childIdOverride)
		? childIdOverride
		: (data.children[0]?.id ?? 0),
);
let showCustomForm = $state(false);

const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));

const conditionTypeLabels: Record<string, string> = {
	total_count: 'かつどう そうかいすう',
	activity_count: 'とくてい かつどう かいすう',
	category_count: 'カテゴリ かいすう',
	streak_days: 'れんぞく にっすう',
	activity_streak: 'かつどう れんぞく',
};
</script>

<svelte:head>
	<title>{PAGE_TITLES.achievements}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<!-- 子供選択 -->
	{#if data.children.length > 0}
		<div class="flex gap-2 mb-6 overflow-x-auto pb-2">
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
				</Button>
			{/each}
		</div>

		{#if selectedChild}
			<!-- チャレンジきろく -->
			<Card variant="default" padding="md">
				{#snippet children()}
				<div class="text-center py-8 text-[var(--color-text-muted)]">
					<span class="text-4xl mb-2 block">📋</span>
					<p class="font-bold mb-1">{ACHIEVEMENTS_LABELS.challengeEmptyTitle}</p>
					<p class="text-sm">{ACHIEVEMENTS_LABELS.challengeEmptyDesc}</p>
				</div>
				{/snippet}
			</Card>
		{/if}

		{#if form?.error}
			<ErrorAlert message={form.error} severity="warning" />
		{/if}

		<!-- カスタム実績 -->
		{#if data.isPremium && selectedChild}
			<Card variant="default" padding="md">
				{#snippet children()}
				<div class="flex items-center justify-between mb-3">
					<h3 class="text-lg font-bold text-[var(--color-text-primary)]">{ACHIEVEMENTS_LABELS.customSectionTitle}</h3>
					<Button type="button" variant="outline" size="sm" onclick={() => { showCustomForm = !showCustomForm; }}>
						{showCustomForm ? ACHIEVEMENTS_LABELS.toggleOpen : ACHIEVEMENTS_LABELS.toggleCreate}
					</Button>
				</div>

				{#if showCustomForm}
					<form method="POST" action="?/createCustomAchievement" use:enhance class="space-y-3 mb-4 p-3 bg-[var(--color-surface-muted)] rounded-lg">
						<input type="hidden" name="childId" value={selectedChildId} />
						<FormField id="ca-name" label={ACHIEVEMENTS_LABELS.fieldNameLabel}>
							<input id="ca-name" name="name" type="text" required maxlength="30" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder={ACHIEVEMENTS_LABELS.fieldNamePlaceholder} />
						</FormField>
						<FormField id="ca-desc" label={ACHIEVEMENTS_LABELS.fieldDescLabel}>
							<input id="ca-desc" name="description" type="text" maxlength="50" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder={ACHIEVEMENTS_LABELS.fieldDescPlaceholder} />
						</FormField>
						<div class="grid grid-cols-2 gap-3">
							<FormField id="ca-icon" label={ACHIEVEMENTS_LABELS.fieldIconLabel}>
								<input id="ca-icon" name="icon" type="text" value="🏅" maxlength="4" class="w-full px-3 py-2 border rounded-lg text-sm" />
							</FormField>
							<FormField id="ca-bonus" label={ACHIEVEMENTS_LABELS.fieldBonusLabel}>
								<input id="ca-bonus" name="bonusPoints" type="number" value="100" min="0" max="1000" class="w-full px-3 py-2 border rounded-lg text-sm" />
							</FormField>
						</div>
						<FormField id="ca-condType" label={ACHIEVEMENTS_LABELS.fieldCondTypeLabel}>
							<NativeSelect
								id="ca-condType"
								name="conditionType"
								options={[
									{ value: 'total_count', label: '活動 総回数' },
									{ value: 'activity_count', label: '特定活動の回数' },
									{ value: 'category_count', label: 'カテゴリ回数' },
									{ value: 'streak_days', label: '連続日数' },
									{ value: 'activity_streak', label: '特定活動の連続日数' },
								]}
							/>
						</FormField>
						<FormField id="ca-condValue" label={ACHIEVEMENTS_LABELS.fieldCondValueLabel}>
							<input id="ca-condValue" name="conditionValue" type="number" required min="1" max="9999" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder="100" />
						</FormField>
						<Button type="submit" variant="primary" size="sm" class="w-full">{ACHIEVEMENTS_LABELS.createButton}</Button>
					</form>
				{/if}

				{#if selectedChild.customAchievements.length === 0}
					<p class="text-sm text-[var(--color-text-tertiary)] text-center py-2">{ACHIEVEMENTS_LABELS.noCustomAchievements}</p>
				{:else}
					<div class="flex flex-col gap-2">
						{#each selectedChild.customAchievements as ca (ca.id)}
							<div class="flex items-center justify-between p-3 rounded-lg border {ca.unlockedAt ? 'border-[var(--color-feedback-warning-border)] bg-[var(--color-feedback-warning-bg)]' : 'border-[var(--color-border)] bg-[var(--color-surface-muted)]'}">
								<div class="flex items-center gap-3">
									<span class="text-2xl">{ca.icon}</span>
									<div>
										<p class="font-bold text-sm text-[var(--color-text-primary)]">{ca.name}</p>
										<p class="text-xs text-[var(--color-text-muted)]">
											{conditionTypeLabels[ca.conditionType] ?? ca.conditionType}: {ca.conditionValue}
											{#if ca.unlockedAt}
												<span class="text-[var(--color-feedback-warning-text)] font-bold ml-1">{ACHIEVEMENTS_LABELS.achievedLabel}</span>
											{/if}
										</p>
									</div>
								</div>
								<form method="POST" action="?/deleteCustomAchievement" use:enhance>
									<input type="hidden" name="id" value={ca.id} />
									<button type="submit" class="text-xs text-[var(--color-feedback-error-text)] hover:text-[var(--color-feedback-error-text)]">{ACHIEVEMENTS_LABELS.deleteButton}</button>
								</form>
							</div>
						{/each}
					</div>
				{/if}
				{/snippet}
			</Card>

		{:else if !data.isPremium}
			<Card variant="default" padding="md">
				{#snippet children()}
				<div class="text-center py-4">
					<p class="text-2xl mb-2">🏅</p>
					<p class="font-bold text-[var(--color-text-primary)] mb-1">{ACHIEVEMENTS_LABELS.upgradeTitle}</p>
					<p class="text-sm text-[var(--color-text-muted)] mb-3">{ACHIEVEMENTS_LABELS.upgradeDesc}</p>
					<a href="/admin/license" class="text-sm text-[var(--color-feedback-info-text)] hover:underline">{ACHIEVEMENTS_LABELS.upgradeLink}</a>
				</div>
				{/snippet}
			</Card>
		{/if}

	{:else}
		<div class="text-center text-[var(--color-text-muted)] py-12">
			<p class="text-4xl mb-2">👧</p>
			<p class="font-bold">{ACHIEVEMENTS_LABELS.noChildrenMessage}</p>
		</div>
	{/if}
</div>
