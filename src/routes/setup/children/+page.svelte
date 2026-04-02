<script lang="ts">
import { enhance } from '$app/forms';
import { AGE_TIER_CONFIG, type UiMode, getDefaultUiMode } from '$lib/domain/validation/age-tier';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';

let { data, form } = $props();
let submitting = $state(false);
let addSuccess = $state(false);

let ageInput = $state<number | undefined>(undefined);
const autoUiMode = $derived(ageInput !== undefined ? getDefaultUiMode(ageInput) : null);
const autoUiLabel = $derived(autoUiMode ? AGE_TIER_CONFIG[autoUiMode].label : '');
</script>

<svelte:head>
	<title>子供登録 - がんばりクエスト セットアップ</title>
</svelte:head>

<h2 class="text-lg font-bold text-gray-700 mb-2">子供を登録しよう</h2>
<p class="text-sm text-gray-500 mb-4">
	がんばりクエストを使う子供を登録してください（1人以上）。
</p>

{#if form?.error}
	<ErrorAlert message={form.error} severity="warning" action="fix_input" />
{/if}

{#if addSuccess}
	<SuccessAlert message="子供を登録しました！" />
{/if}

<!-- Registered children list -->
{#if data.children.length > 0}
	<div class="mb-4">
		<h3 class="text-sm font-bold text-gray-600 mb-2">登録済み（{data.children.length}人）</h3>
		<div class="flex flex-col gap-2">
			{#each data.children as child (child.id)}
				<div class="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
					<span class="text-xl">
						{#if child.theme === 'pink'}
							👧
						{:else}
							👦
						{/if}
					</span>
					<div>
						<p class="font-bold text-sm text-gray-700">{child.nickname}</p>
						<p class="text-xs text-gray-500">
							{child.age}歳 / {AGE_TIER_CONFIG[child.uiMode as UiMode]?.label ?? child.uiMode}モード
						</p>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}

<!-- Add child form -->
<form
	method="POST"
	action="?/addChild"
	use:enhance={() => {
		submitting = true;
		addSuccess = false;
		return async ({ result, update }) => {
			submitting = false;
			if (result.type === 'success') {
				addSuccess = true;
				ageInput = undefined;
			}
			await update({ reset: true });
		};
	}}
	class="flex flex-col gap-3 mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200"
>
	<h3 class="text-sm font-bold text-gray-600">子供を追加</h3>

	<div>
		<label for="nickname" class="block text-sm font-medium text-gray-600 mb-1">ニックネーム</label>
		<input
			type="text"
			id="nickname"
			name="nickname"
			required
			placeholder="ゆうきちゃん"
			class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
		/>
	</div>

	<div>
		<label for="age" class="block text-sm font-medium text-gray-600 mb-1">年齢</label>
		<input
			type="number"
			id="age"
			name="age"
			min="0"
			max="18"
			required
			bind:value={ageInput}
			class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
		/>
		{#if autoUiMode}
			<p class="text-xs text-blue-500 mt-1">
				{autoUiLabel}モードが自動で設定されます
			</p>
		{/if}
	</div>

	<div>
		<label for="theme" class="block text-sm font-medium text-gray-600 mb-1">テーマカラー</label>
		<div class="grid grid-cols-2 gap-2">
			<label class="theme-option">
				<input type="radio" name="theme" value="pink" checked class="sr-only peer" />
				<div class="theme-card peer-checked:border-pink-400 peer-checked:bg-pink-50">
					<span class="text-2xl">👧</span>
					<span class="text-sm font-medium text-gray-700">ピンク</span>
				</div>
			</label>
			<label class="theme-option">
				<input type="radio" name="theme" value="blue" class="sr-only peer" />
				<div class="theme-card peer-checked:border-blue-400 peer-checked:bg-blue-50">
					<span class="text-2xl">👦</span>
					<span class="text-sm font-medium text-gray-700">ブルー</span>
				</div>
			</label>
		</div>
	</div>

	<button
		type="submit"
		disabled={submitting}
		class="w-full py-2 bg-green-500 text-white font-bold rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
	>
		{submitting ? '登録中...' : '追加する'}
	</button>
</form>

<!-- Next step button -->
{#if data.children.length > 0}
	<form method="POST" action="?/next">
		<button
			type="submit"
			class="w-full py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600 transition-colors"
		>
			次へ
		</button>
	</form>
{/if}

<style>
	.theme-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 12px 8px;
		border: 2px solid var(--color-neutral-200);
		border-radius: 12px;
		cursor: pointer;
		transition: all 0.15s;
	}

	.theme-card:hover {
		border-color: var(--color-neutral-300);
	}
</style>
