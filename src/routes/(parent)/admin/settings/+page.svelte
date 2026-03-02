<script lang="ts">
import { enhance } from '$app/forms';

let { form } = $props();

let success = $state(false);
let submitting = $state(false);
</script>

<svelte:head>
	<title>せってい - がんばりクエスト管理</title>
</svelte:head>

<div class="max-w-md mx-auto">
	<h2 class="text-xl font-bold text-gray-700 mb-6">せってい</h2>

	<!-- PIN変更 -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
		<h3 class="text-lg font-bold text-gray-700 mb-4">🔒 PINコード変更</h3>

		{#if success}
			<div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-700">
				PINコードを変更しました
			</div>
		{/if}

		{#if form?.error}
			<div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
				{form.error}
			</div>
		{/if}

		<form
			method="POST"
			action="?/changePin"
			use:enhance={() => {
				submitting = true;
				success = false;
				return async ({ result, update }) => {
					submitting = false;
					if (result.type === 'success') {
						success = true;
					}
					await update();
				};
			}}
			class="flex flex-col gap-4"
		>
			<div>
				<label for="currentPin" class="block text-sm font-medium text-gray-600 mb-1"
					>現在のPIN</label
				>
				<input
					type="password"
					id="currentPin"
					name="currentPin"
					inputmode="numeric"
					pattern="[0-9]*"
					maxlength="8"
					required
					class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 text-center text-lg tracking-widest"
				/>
			</div>

			<div>
				<label for="newPin" class="block text-sm font-medium text-gray-600 mb-1"
					>新しいPIN（4〜8桁）</label
				>
				<input
					type="password"
					id="newPin"
					name="newPin"
					inputmode="numeric"
					pattern="[0-9]*"
					minlength="4"
					maxlength="8"
					required
					class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 text-center text-lg tracking-widest"
				/>
			</div>

			<div>
				<label for="confirmPin" class="block text-sm font-medium text-gray-600 mb-1"
					>新しいPIN（確認）</label
				>
				<input
					type="password"
					id="confirmPin"
					name="confirmPin"
					inputmode="numeric"
					pattern="[0-9]*"
					minlength="4"
					maxlength="8"
					required
					class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 text-center text-lg tracking-widest"
				/>
			</div>

			<button
				type="submit"
				disabled={submitting}
				class="w-full py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
			>
				{submitting ? '変更中...' : 'PINを変更'}
			</button>
		</form>
	</div>
</div>
