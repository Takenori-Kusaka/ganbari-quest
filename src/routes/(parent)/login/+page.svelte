<script lang="ts">
import { enhance } from '$app/forms';
import { PIN_MAX_LENGTH } from '$lib/domain/validation/auth';
import Logo from '$lib/ui/components/Logo.svelte';
import NumPad from '$lib/ui/components/NumPad.svelte';

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

<div data-theme="admin" class="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-b from-[var(--color-brand-100)] to-[var(--color-brand-200)] p-4 relative">
	<!-- もどるボタン -->
	<a href="/switch" class="absolute top-4 left-4 text-[var(--color-text-muted)] text-sm no-underline px-3 py-2 rounded-[var(--radius-sm)] transition-colors hover:bg-black/5">
		← もどる
	</a>

	<div class="text-center mb-8">
		<Logo variant="symbol" size={56} />
		<h1 class="text-[1.375rem] font-bold text-[var(--color-text)] leading-relaxed m-0">
			おとうさん・おかあさんの<br />ページだよ
		</h1>
		<p class="text-sm text-[var(--color-text-muted)] mt-3 leading-relaxed">
			ここから先はおとうさん・おかあさんに<br />
			ひみつのばんごうを入れてもらってね
		</p>
	</div>

	{#if form?.error}
		<div class="mb-4 px-4 py-3 bg-red-100 text-red-700 rounded-[var(--radius-md)] text-sm font-medium">
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
		class="w-full max-w-[320px] mx-auto"
	>
		<input type="hidden" name="pin" value={pin} />

		<!-- ドット表示 -->
		<div class="flex justify-center gap-3 mb-8" aria-label="PIN入力状態">
			{#each Array(PIN_MAX_LENGTH) as _, i}
				<div
					class="w-4 h-4 rounded-full transition-all duration-200
						{i < pin.length ? 'bg-[var(--color-brand-600)] scale-110' : 'bg-[var(--color-neutral-300)]'}"
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
