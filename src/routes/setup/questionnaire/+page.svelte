<script lang="ts">
import { enhance } from '$app/forms';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();
const firstChild = data.children[0];
const childAge = firstChild?.age ?? 5;

// 課題の選択肢
const challengeOptions = [
	{ value: 'morning', label: 'あさの じゅんびが おそい', icon: '⏰' },
	{ value: 'homework', label: 'しゅくだいを じぶんから やらない', icon: '📝' },
	{ value: 'chores', label: 'おてつだいを しない', icon: '🧹' },
	{ value: 'exercise', label: 'そとで あそばない・うんどうぶそく', icon: '🏃' },
	{ value: 'picky', label: 'すききらいが おおい', icon: '🍽️' },
	{ value: 'balanced', label: 'とくに こまっていない（バランスよく）', icon: '✨' },
];

// 活動量の選択肢
const activityLevelOptions = [
	{ value: 'few', label: 'すこしずつ（3〜5こ）', description: 'はじめてでも むりなく' },
	{ value: 'normal', label: 'ふつう（5〜10こ）', description: 'おすすめ' },
	{ value: 'many', label: 'たくさん（10こ いじょう）', description: 'いろいろ きろくしたい' },
];

// チェックリストプリセット
const presetOptions = [
	{ value: 'morning-routine', label: 'あさのしたく', icon: '☀️', ageMin: 0 },
	{ value: 'evening-routine', label: 'よるのじゅんび', icon: '🌙', ageMin: 0 },
	{ value: 'after-school', label: 'がっこうからかえったら', icon: '🎒', ageMin: 6 },
	{ value: 'weekend-chores', label: 'しゅうまつのおてつだい', icon: '🧹', ageMin: 4 },
];

// 年齢で表示するプリセットをフィルタ
const availablePresets = presetOptions.filter((p) => childAge >= p.ageMin);

let selectedChallenges = $state<string[]>([]);
let activityLevel = $state('normal');
let selectedPresets = $state<string[]>(availablePresets.map((p) => p.value));
let submitting = $state(false);

function toggleChallenge(value: string) {
	if (value === 'balanced') {
		selectedChallenges = selectedChallenges.includes('balanced') ? [] : ['balanced'];
		return;
	}
	selectedChallenges = selectedChallenges.filter((c) => c !== 'balanced');
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
	📋 かんたんアンケート
</h2>
<p class="text-sm text-[var(--color-text-muted)] text-center mb-4">
	お子さまに合った設定を自動でご用意します
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
			Q1. お子さまの課題は？（いくつでも）
		</legend>
		<div class="grid gap-2">
			{#each challengeOptions as option (option.value)}
				<button
					type="button"
					class="option-button"
					class:option-button--selected={selectedChallenges.includes(option.value)}
					onclick={() => toggleChallenge(option.value)}
				>
					<span class="text-lg">{option.icon}</span>
					<span class="text-sm">{option.label}</span>
				</button>
				{#if selectedChallenges.includes(option.value)}
					<input type="hidden" name="challenges" value={option.value} />
				{/if}
			{/each}
		</div>
	</fieldset>

	<!-- Q2: 活動量 -->
	<fieldset class="mb-5">
		<legend class="text-sm font-semibold mb-2">
			Q2. 1にちに どれくらい きろくする？
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
							おすすめ
						</span>
					{/if}
				</label>
			{/each}
		</div>
	</fieldset>

	<!-- Q3: チェックリスト -->
	<fieldset class="mb-5">
		<legend class="text-sm font-semibold mb-2">
			Q3. チェックリストを自動作成する？
		</legend>
		<p class="text-xs text-[var(--color-text-muted)] mb-2">
			えらんだリストが自動で作成されます（あとから変更できます）
		</p>
		<div class="grid gap-2">
			{#each availablePresets as preset (preset.value)}
				<button
					type="button"
					class="option-button"
					class:option-button--selected={selectedPresets.includes(preset.value)}
					onclick={() => togglePreset(preset.value)}
				>
					<span class="text-lg">{preset.icon}</span>
					<span class="text-sm">{preset.label}</span>
					{#if selectedPresets.includes(preset.value)}
						<span class="ml-auto text-xs text-[var(--color-success)]">✓</span>
					{/if}
				</button>
				{#if selectedPresets.includes(preset.value)}
					<input type="hidden" name="checklistPresets" value={preset.value} />
				{/if}
			{/each}
		</div>
	</fieldset>

	<div class="flex flex-col gap-2 mt-6">
		<Button type="submit" variant="primary" size="lg" class="w-full" disabled={submitting}>
			{submitting ? 'せっていちゅう...' : 'この設定ではじめる！'}
		</Button>
	</div>
</form>

<form method="POST" action="?/skip" use:enhance>
	<div class="text-center mt-3">
		<button type="submit" class="text-sm text-[var(--color-text-muted)] underline hover:text-[var(--color-text-secondary)]">
			あとで設定する（スキップ）
		</button>
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
