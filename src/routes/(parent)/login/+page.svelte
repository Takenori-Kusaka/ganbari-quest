<script lang="ts">
import { enhance } from '$app/forms';
import { PIN_MAX_LENGTH } from '$lib/domain/validation/auth';
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

<div data-theme="admin" class="login-page">
	<!-- もどるボタン -->
	<a href="/switch" class="back-link">
		← もどる
	</a>

	<div class="login-header">
		<div class="login-icon">👨‍👩‍👧</div>
		<h1 class="login-title">おとうさん・おかあさんの<br />ページだよ</h1>
		<p class="login-hint">
			ここから先はおとうさん・おかあさんに<br />
			ひみつのばんごうを入れてもらってね
		</p>
	</div>

	{#if form?.error}
		<div class="login-error">
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
		class="login-form"
	>
		<input type="hidden" name="pin" value={pin} />

		<!-- ドット表示 -->
		<div class="pin-dots" aria-label="PIN入力状態">
			{#each Array(PIN_MAX_LENGTH) as _, i}
				<div
					class="pin-dot {i < pin.length ? 'pin-dot--filled' : ''}"
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

<style>
	.login-page {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: linear-gradient(to bottom, #eff6ff, #dbeafe);
		padding: 16px;
		position: relative;
	}

	.back-link {
		position: absolute;
		top: 16px;
		left: 16px;
		color: #6b7280;
		font-size: 0.875rem;
		text-decoration: none;
		padding: 8px 12px;
		border-radius: 8px;
		transition: background 0.15s;
	}

	.back-link:hover {
		background: rgba(0, 0, 0, 0.05);
	}

	.login-header {
		text-align: center;
		margin-bottom: 32px;
	}

	.login-icon {
		font-size: 3.5rem;
		margin-bottom: 12px;
	}

	.login-title {
		font-size: 1.375rem;
		font-weight: 700;
		color: #374151;
		line-height: 1.5;
		margin: 0;
	}

	.login-hint {
		font-size: 0.875rem;
		color: #6b7280;
		margin-top: 12px;
		line-height: 1.6;
	}

	.login-error {
		margin-bottom: 16px;
		padding: 12px 16px;
		background: #fee2e2;
		color: #b91c1c;
		border-radius: 12px;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.login-form {
		width: 100%;
		max-width: 320px;
		margin: 0 auto;
	}

	.pin-dots {
		display: flex;
		justify-content: center;
		gap: 12px;
		margin-bottom: 32px;
	}

	.pin-dot {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #d1d5db;
		transition: all 0.2s;
	}

	.pin-dot--filled {
		background: #3b82f6;
		transform: scale(1.1);
	}
</style>
