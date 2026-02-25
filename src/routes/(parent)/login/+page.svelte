<script lang="ts">
	import NumPad from '$lib/ui/components/NumPad.svelte';
	import { enhance } from '$app/forms';
	import { PIN_MAX_LENGTH } from '$lib/domain/validation/auth';

	let { form } = $props();

	let pin = $state('');
	let loading = $state(false);
	let formEl: HTMLFormElement | undefined = $state();

	function handleInput(digit: string) {
		if (pin.length < PIN_MAX_LENGTH) {
			pin += digit;
		}
	}

	function handleDelete() {
		pin = pin.slice(0, -1);
	}

	function handleSubmit() {
		if (pin.length >= 4 && formEl) {
			formEl.requestSubmit();
		}
	}
</script>

<div data-theme="admin" class="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-blue-100 p-4">
	<div class="text-center mb-8">
		<div class="text-5xl mb-4">🔒</div>
		<h1 class="text-2xl font-bold text-gray-700">おやのログイン</h1>
		<p class="text-sm text-gray-500 mt-2">PINコードをにゅうりょくしてください</p>
	</div>

	{#if form?.error}
		<div class="mb-4 px-4 py-3 bg-red-100 text-red-700 rounded-xl text-sm font-medium">
			{form.error}
		</div>
	{/if}

	<form
		method="POST"
		bind:this={formEl}
		use:enhance={() => {
			loading = true;
			return async ({ update }) => {
				loading = false;
				pin = '';
				await update();
			};
		}}
		class="w-full max-w-xs mx-auto"
	>
		<input type="hidden" name="pin" value={pin} />

		<!-- ドット表示 -->
		<div class="flex justify-center gap-3 mb-8" aria-label="PIN入力状態">
			{#each Array(PIN_MAX_LENGTH) as _, i}
				<div
					class="w-4 h-4 rounded-full transition-all duration-200 {i < pin.length
						? 'bg-blue-500 scale-110'
						: 'bg-gray-300'}"
				></div>
			{/each}
		</div>

		<NumPad
			onInput={handleInput}
			onDelete={handleDelete}
			onSubmit={handleSubmit}
			disabled={loading}
		/>
	</form>
</div>
