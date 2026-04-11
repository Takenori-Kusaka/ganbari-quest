<script lang="ts">
import { enhance } from '$app/forms';
import { getErrorMessage } from '$lib/domain/errors';
import { formatPointValue } from '$lib/domain/point-display';
import ChildListCard from '$lib/features/admin/components/ChildListCard.svelte';
import ChildProfileCard from '$lib/features/admin/components/ChildProfileCard.svelte';
import PageHelpButton from '$lib/ui/components/PageHelpButton.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data, form } = $props();
const childLimit = $derived(
	(data as Record<string, unknown>).childLimit as
		| { allowed: boolean; current: number; max: number | null }
		| undefined,
);
// #787: form.error が string | PlanLimitError どちらでも表示できるよう正規化
const errorMessage = $derived(getErrorMessage(form?.error));

const ps = $derived(data.pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);

let showAddForm = $state(false);
</script>

<svelte:head>
	<title>こども管理 - がんばりクエスト</title>
</svelte:head>

<div class="children-page">
	<div class="flex items-center gap-2 mb-3">
		<h2 class="text-lg font-bold">👧 こども管理</h2>
		<PageHelpButton />
	</div>
	{#if childLimit && !childLimit.allowed}
		<div class="children-page__limit-banner">
			<span class="children-page__limit-icon">⚠️</span>
			<div>
				<p class="children-page__limit-title">こどもの登録上限に達しています</p>
				<p class="children-page__limit-desc">
					現在 {childLimit.current}人 / 最大 {childLimit.max}人。
				</p>
				<a href="/admin/license" class="children-page__limit-link">
					🚀 プランをアップグレードする →
				</a>
			</div>
		</div>
	{/if}

	<div class="children-page__toolbar" data-tutorial="children-list">
		{#if !childLimit || childLimit.allowed}
			<Button
				variant="primary"
				size="sm"
				onclick={() => showAddForm = !showAddForm}
				data-tutorial="add-child-btn"
			>
				{showAddForm ? 'キャンセル' : '+ こどもを追加'}
			</Button>
		{:else}
			<Button
				variant="ghost"
				size="sm"
				class="bg-[var(--color-border-strong)] text-[var(--color-text-muted)] cursor-not-allowed"
				disabled
			>
				上限に達しています
			</Button>
		{/if}
	</div>

	<!-- Add child form -->
	{#if showAddForm}
		<Card>
			<form
				method="POST"
				action="?/addChild"
				use:enhance={() => {
					return async ({ result, update }) => {
						if (result.type === 'success') {
							showAddForm = false;
						}
						await update();
					};
				}}
				class="children-page__add-form"
			>
				<h3 class="children-page__add-title">こどもを追加</h3>
				<div class="children-page__add-grid">
					<FormField
						label="ニックネーム"
						type="text"
						id="add-nickname"
						name="nickname"
						required
						placeholder="例: たろうくん"
					/>
					<FormField
						label="たんじょうび"
						type="date"
						id="add-birthDate"
						name="birthDate"
						max={new Date().toISOString().split('T')[0]}
						hint="設定すると年齢が自動計算されます"
					/>
					<FormField
						label="年齢"
						type="number"
						id="add-age"
						name="age"
						min="0"
						max="18"
						required
						placeholder="4"
					/>
					<div>
						<label for="add-theme" class="children-page__label">テーマカラー</label>
						<select id="add-theme" name="theme" class="children-page__select">
							<option value="pink">🩷 ピンク</option>
							<option value="blue">💙 ブルー</option>
							<option value="green">💚 みどり</option>
							<option value="orange">🧡 オレンジ</option>
							<option value="purple">💜 むらさき</option>
						</select>
					</div>
				</div>
				<Button type="submit" variant="success" size="sm">追加する</Button>
			</form>
		</Card>
	{/if}

	<!-- Error display -->
	{#if errorMessage}
		<div class="children-page__error">{errorMessage}</div>
	{/if}

	<!-- Children list -->
	<div class="children-page__list">
		{#each data.children as child, i}
			<ChildListCard
				{child}
				isSelected={data.selectedChild?.id === child.id}
				href="/admin/children?id={child.id}"
				dataTutorial={i === 0 ? 'child-card' : undefined}
				formatBalance={fmtBal}
			/>
		{/each}
	</div>

	<!-- Selected child detail -->
	{#if data.selectedChild}
		<div class="children-page__detail">
			<ChildProfileCard
				child={data.selectedChild}
				categoryDefs={data.categoryDefs}
				pointSettings={ps}
			/>
		</div>
	{/if}
</div>

<style>
	.children-page {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.children-page__limit-banner {
		background: var(--color-surface-warning, #fffbeb);
		border: 1px solid var(--color-border-warning, #fde68a);
		border-radius: 0.75rem;
		padding: 1rem;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}
	.children-page__limit-icon {
		font-size: 1.5rem;
	}
	.children-page__limit-title {
		font-weight: 700;
		color: var(--color-warning-text, #92400e);
	}
	.children-page__limit-desc {
		font-size: 0.875rem;
		color: var(--color-warning-text, #a16207);
		margin-top: 0.25rem;
	}
	.children-page__limit-link {
		display: inline-flex;
		align-items: center;
		margin-top: 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-action-primary, #2563eb);
	}
	.children-page__limit-link:hover {
		color: var(--color-action-primary-hover, #1d4ed8);
	}
	.children-page__toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.children-page__add-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.children-page__add-title {
		font-weight: 700;
		color: var(--color-text-secondary, #4b5563);
	}
	.children-page__add-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	@media (max-width: 480px) {
		.children-page__add-grid {
			grid-template-columns: 1fr;
		}
	}
	.children-page__label {
		display: block;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-text-tertiary, #6b7280);
		margin-bottom: 0.25rem;
	}
	.children-page__select {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--input-border, #d1d5db);
		border-radius: 0.5rem;
		font-size: 0.875rem;
	}
	.children-page__error {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: var(--color-danger, #dc2626);
		padding: 0.75rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
	}
	.children-page__list {
		display: grid;
		gap: 0.75rem;
	}
	.children-page__detail {
		animation: slide-in 0.2s ease-out;
	}
	@keyframes slide-in {
		from {
			opacity: 0;
			transform: translateY(-0.5rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
