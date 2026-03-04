<script lang="ts">
	import { enhance } from '$app/forms';
	import { ErrorAlert } from '$lib/ui/components';
	import { PIN_MIN_LENGTH, PIN_MAX_LENGTH } from '$lib/domain/validation/auth';

	let { form } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>PIN設定 - がんばりクエスト セットアップ</title>
</svelte:head>

<h2 class="text-lg font-bold text-gray-700 mb-2">管理用PINコードを設定</h2>
<p class="text-sm text-gray-500 mb-4">
	親の管理画面にアクセスするためのPINコード（{PIN_MIN_LENGTH}〜{PIN_MAX_LENGTH}桁の数字）を設定してください。
</p>

{#if form?.error}
	<ErrorAlert message={form.error} severity="warning" action="fix_input" />
{/if}

<form
	method="POST"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			submitting = false;
			await update();
		};
	}}
	class="flex flex-col gap-4"
>
	<div>
		<label for="pin" class="block text-sm font-medium text-gray-600 mb-1">PINコード</label>
		<input
			type="password"
			id="pin"
			name="pin"
			inputmode="numeric"
			pattern="[0-9]*"
			minlength={PIN_MIN_LENGTH}
			maxlength={PIN_MAX_LENGTH}
			required
			class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 text-center text-lg tracking-widest"
		/>
	</div>

	<div>
		<label for="confirmPin" class="block text-sm font-medium text-gray-600 mb-1">PINコード（確認）</label>
		<input
			type="password"
			id="confirmPin"
			name="confirmPin"
			inputmode="numeric"
			pattern="[0-9]*"
			minlength={PIN_MIN_LENGTH}
			maxlength={PIN_MAX_LENGTH}
			required
			class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 text-center text-lg tracking-widest"
		/>
	</div>

	<button
		type="submit"
		disabled={submitting}
		class="w-full py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
	>
		{submitting ? '設定中...' : '次へ'}
	</button>
</form>
