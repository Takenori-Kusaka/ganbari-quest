<script lang="ts">
import { enhance } from '$app/forms';
import { SETUP_QUESTIONNAIRE_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();
// svelte-ignore state_referenced_locally
const firstChild = data.children[0];
const childAge = firstChild?.age ?? 5;

// #1592 (ADR-0023 I4): 6→3 簡素化
// 親 P1（共働き、時間がない）が「使い始めたいけど何ができるかわからない」を解消するため、
// challenges を 3 軸に絞り、各軸にデフォルトプリセットを紐付ける。
const challengeOptions = [
	{
		value: 'homework-daily',
		label: SETUP_QUESTIONNAIRE_LABELS.challengeHomeworkDaily,
		icon: '📝',
	},
	{ value: 'chores', label: SETUP_QUESTIONNAIRE_LABELS.challengeChores, icon: '🧹' },
	{
		value: 'beyond-games',
		label: SETUP_QUESTIONNAIRE_LABELS.challengeBeyondGames,
		icon: '🎨',
	},
];

// 活動量の選択肢
const activityLevelOptions = [
	{
		value: 'few',
		label: SETUP_QUESTIONNAIRE_LABELS.activityLevelFewLabel,
		description: SETUP_QUESTIONNAIRE_LABELS.activityLevelFewDesc,
	},
	{
		value: 'normal',
		label: SETUP_QUESTIONNAIRE_LABELS.activityLevelNormalLabel,
		description: SETUP_QUESTIONNAIRE_LABELS.activityLevelNormalDesc,
	},
	{
		value: 'many',
		label: SETUP_QUESTIONNAIRE_LABELS.activityLevelManyLabel,
		description: SETUP_QUESTIONNAIRE_LABELS.activityLevelManyDesc,
	},
];

// チェックリストプリセット
// #1592: beyond-games (ゲーム以外のチャレンジ：読書/外遊び/工作/音楽) を追加
const presetOptions = [
	{
		value: 'morning-routine',
		label: SETUP_QUESTIONNAIRE_LABELS.presetMorningRoutine,
		icon: '☀️',
		ageMin: 0,
	},
	{
		value: 'evening-routine',
		label: SETUP_QUESTIONNAIRE_LABELS.presetEveningRoutine,
		icon: '🌙',
		ageMin: 0,
	},
	{
		value: 'after-school',
		label: SETUP_QUESTIONNAIRE_LABELS.presetAfterSchool,
		icon: '🎒',
		ageMin: 6,
	},
	{
		value: 'weekend-chores',
		label: SETUP_QUESTIONNAIRE_LABELS.presetWeekendChores,
		icon: '🧹',
		ageMin: 4,
	},
	{
		value: 'beyond-games',
		label: SETUP_QUESTIONNAIRE_LABELS.presetBeyondGames,
		icon: '🎨',
		ageMin: 3,
	},
];

// 年齢で表示するプリセットをフィルタ
const availablePresets = presetOptions.filter((p) => childAge >= p.ageMin);

let selectedChallenges = $state<string[]>([]);
let activityLevel = $state('normal');
let selectedPresets = $state<string[]>(availablePresets.map((p) => p.value));
let submitting = $state(false);

function toggleChallenge(value: string) {
	// #1592: 旧 'balanced' 排他制御を撤去（新 3 軸はすべて加算的に選択可能）
	if (selectedChallenges.includes(value)) {
		selectedChallenges = selectedChallenges.filter((c) => c !== value);
	} else {
		selectedChallenges = [...selectedChallenges, value];
	}
}

function togglePreset(value: string) {
	if (selectedPresets.includes(value)) {
		selectedPresets = selectedPresets.filter((p) => p !== value);
	} else {
		selectedPresets = [...selectedPresets, value];
	}
}
</script>

<h2 class="text-lg font-bold text-center mb-1">
	{SETUP_QUESTIONNAIRE_LABELS.pageTitle}
</h2>
<p class="text-sm text-[var(--color-text-muted)] text-center mb-4">
	{SETUP_QUESTIONNAIRE_LABELS.pageDesc}
</p>

<form method="POST" action="?/submit" use:enhance={() => {
	submitting = true;
	return async ({ update }) => {
		await update();
		submitting = false;
	};
}}>
	<!-- Q1: 課題 -->
	<fieldset class="mb-5">
		<legend class="text-sm font-semibold mb-2">
			{SETUP_QUESTIONNAIRE_LABELS.q1Legend}
		</legend>
		<div class="grid gap-2">
			{#each challengeOptions as option (option.value)}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="option-button {selectedChallenges.includes(option.value) ? 'option-button--selected' : ''}"
					onclick={() => toggleChallenge(option.value)}
				>
					<span class="text-lg">{option.icon}</span>
					<span class="text-sm">{option.label}</span>
				</Button>
				{#if selectedChallenges.includes(option.value)}
					<input type="hidden" name="challenges" value={option.value} />
				{/if}
			{/each}
		</div>
	</fieldset>

	<!-- Q2: 活動量 -->
	<fieldset class="mb-5">
		<legend class="text-sm font-semibold mb-2">
			{SETUP_QUESTIONNAIRE_LABELS.q2Legend}
		</legend>
		<div class="grid gap-2">
			{#each activityLevelOptions as option (option.value)}
				<label
					class="option-button"
					class:option-button--selected={activityLevel === option.value}
				>
					<input
						type="radio"
						name="activityLevel"
						value={option.value}
						bind:group={activityLevel}
						class="sr-only"
					/>
					<span class="text-sm font-medium">{option.label}</span>
					{#if option.value === 'normal'}
						<span class="ml-auto text-xs px-2 py-0.5 rounded-full bg-[var(--color-brand-100)] text-[var(--color-brand-700)]">
							{SETUP_QUESTIONNAIRE_LABELS.recommendedBadge}
						</span>
					{/if}
				</label>
			{/each}
		</div>
	</fieldset>

	<!-- Q3: チェックリスト -->
	<fieldset class="mb-5">
		<legend class="text-sm font-semibold mb-2">
			{SETUP_QUESTIONNAIRE_LABELS.q3Legend}
		</legend>
		<p class="text-xs text-[var(--color-text-muted)] mb-2">
			{SETUP_QUESTIONNAIRE_LABELS.q3Hint}
		</p>
		<div class="grid gap-2">
			{#each availablePresets as preset (preset.value)}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="option-button {selectedPresets.includes(preset.value) ? 'option-button--selected' : ''}"
					onclick={() => togglePreset(preset.value)}
				>
					<span class="text-lg">{preset.icon}</span>
					<span class="text-sm">{preset.label}</span>
					{#if selectedPresets.includes(preset.value)}
						<span class="ml-auto text-xs text-[var(--color-success)]">✓</span>
					{/if}
				</Button>
				{#if selectedPresets.includes(preset.value)}
					<input type="hidden" name="checklistPresets" value={preset.value} />
				{/if}
			{/each}
		</div>
	</fieldset>

	<div class="flex flex-col gap-2 mt-6">
		<Button type="submit" variant="primary" size="lg" class="w-full" disabled={submitting}>
			{submitting ? SETUP_QUESTIONNAIRE_LABELS.submittingLabel : SETUP_QUESTIONNAIRE_LABELS.startButton}
		</Button>
	</div>
</form>

<form method="POST" action="?/skip" use:enhance>
	<div class="text-center mt-3">
		<Button type="submit" variant="ghost" size="sm" class="text-sm text-[var(--color-text-muted)] underline hover:text-[var(--color-text-secondary)]">
			{SETUP_QUESTIONNAIRE_LABELS.skipButton}
		</Button>
	</div>
</form>

<style>
	.option-button {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border: 2px solid var(--color-neutral-200);
		border-radius: var(--radius-md);
		background: var(--color-surface-card);
		cursor: pointer;
		transition: all 0.15s;
		text-align: left;
	}

	.option-button:hover {
		border-color: var(--color-brand-300);
	}

	.option-button--selected {
		border-color: var(--color-brand-500);
		background: var(--color-brand-50);
	}
</style>
