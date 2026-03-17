<script lang="ts">
import { enhance } from '$app/forms';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';

let { data, form } = $props();
let submitting = $state(false);
let addSuccess = $state(false);
</script>

<svelte:head>
	<title>子供登録 - がんばりクエスト セットアップ</title>
</svelte:head>

<h2 class="text-lg font-bold text-gray-700 mb-2">子供を登録</h2>
<p class="text-sm text-gray-500 mb-4">
	がんばりクエストを使う子供を登録してください（1人以上）。
</p>

{#if form?.error}
	<ErrorAlert message={form.error} severity="warning" action="fix_input" />
{/if}

{#if addSuccess}
	<SuccessAlert message="子供を登録しました" />
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
						<p class="text-xs text-gray-500">{child.age}歳 / {child.uiMode === 'baby' ? 'ベビーモード' : 'キッズモード'}</p>
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
			class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
		/>
	</div>

	<div class="grid grid-cols-2 gap-3">
		<div>
			<label for="theme" class="block text-sm font-medium text-gray-600 mb-1">テーマカラー</label>
			<select
				id="theme"
				name="theme"
				class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
			>
				<option value="pink">ピンク</option>
				<option value="blue">ブルー</option>
			</select>
		</div>

		<div>
			<label for="uiMode" class="block text-sm font-medium text-gray-600 mb-1">UIモード</label>
			<select
				id="uiMode"
				name="uiMode"
				class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
			>
				<option value="kinder">キッズ（3歳〜）</option>
				<option value="baby">ベビー（0〜2歳）</option>
			</select>
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
