<script lang="ts">
import { enhance } from '$app/forms';
import { CURRENCY_CODES, CURRENCY_DEFS, formatPointValue } from '$lib/domain/point-display';
import type { CurrencyCode, PointUnitMode } from '$lib/domain/point-display';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';

let { data, form } = $props();

let success = $state(false);
let submitting = $state(false);

// ポイント表示設定
let pointSuccess = $state(false);
let pointSubmitting = $state(false);
let pointMode = $state<PointUnitMode>(data.pointSettings.mode);
let pointCurrency = $state<CurrencyCode>(data.pointSettings.currency);
let pointRate = $state(String(data.pointSettings.rate));

const previewPoints = 100;
const previewFormatted = $derived(
	formatPointValue(previewPoints, pointMode, pointCurrency, Number.parseFloat(pointRate) || 1),
);
</script>

<svelte:head>
	<title>せってい - がんばりクエスト管理</title>
</svelte:head>

<div class="space-y-6">
	<h2 class="text-xl font-bold text-gray-700 mb-6">せってい</h2>

	<!-- PIN変更 -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
		<h3 class="text-lg font-bold text-gray-700 mb-4">🔒 PINコード変更</h3>

		{#if success}
			<SuccessAlert message="PINコードを変更しました" />
		{/if}

		{#if form?.error}
			<ErrorAlert message={form.error} severity="warning" action="fix_input" />
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

	<!-- ポイント表示設定 -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
		<h3 class="text-lg font-bold text-gray-700 mb-4">💰 ポイント表示設定</h3>

		{#if pointSuccess}
			<SuccessAlert message="ポイント表示設定を保存しました" />
		{/if}

		{#if form?.pointError}
			<ErrorAlert message={form.pointError} severity="warning" action="fix_input" />
		{/if}

		<form
			method="POST"
			action="?/updatePointSettings"
			use:enhance={() => {
				pointSubmitting = true;
				pointSuccess = false;
				return async ({ result, update }) => {
					pointSubmitting = false;
					if (result.type === 'success') {
						pointSuccess = true;
					}
					await update();
				};
			}}
			class="flex flex-col gap-4"
		>
			<div>
				<span class="block text-sm font-medium text-gray-600 mb-2">表示モード</span>
				<div class="flex gap-3">
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="radio"
							name="point_unit_mode"
							value="point"
							bind:group={pointMode}
							class="w-4 h-4 text-blue-500"
						/>
						<span class="text-sm">ポイント（P）</span>
					</label>
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="radio"
							name="point_unit_mode"
							value="currency"
							bind:group={pointMode}
							class="w-4 h-4 text-blue-500"
						/>
						<span class="text-sm">通貨で表示</span>
					</label>
				</div>
			</div>

			{#if pointMode === 'currency'}
				<div>
					<label for="pointCurrency" class="block text-sm font-medium text-gray-600 mb-1">
						通貨
					</label>
					<select
						id="pointCurrency"
						name="point_currency"
						bind:value={pointCurrency}
						class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
					>
						{#each CURRENCY_CODES as code}
							<option value={code}>
								{CURRENCY_DEFS[code].flag} {code} ({CURRENCY_DEFS[code].symbol})
							</option>
						{/each}
					</select>
				</div>

				<div>
					<label for="pointRate" class="block text-sm font-medium text-gray-600 mb-1">
						レート（1P = ？{CURRENCY_DEFS[pointCurrency].symbol}）
					</label>
					<input
						type="number"
						id="pointRate"
						name="point_rate"
						bind:value={pointRate}
						min="0.001"
						max="10000"
						step="any"
						required
						class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
					/>
					<p class="text-xs text-gray-400 mt-1">
						例: 1P = 1円なら「1」、1P = 0.01ドルなら「0.01」
					</p>
				</div>
			{/if}

			<!-- プレビュー -->
			<div class="bg-gray-50 rounded-lg p-4">
				<p class="text-sm text-gray-500 mb-1">プレビュー（{previewPoints}P の場合）</p>
				<p class="text-2xl font-bold text-[var(--color-point,#f59e0b)]">
					{previewFormatted}
				</p>
			</div>

			<button
				type="submit"
				disabled={pointSubmitting}
				class="w-full py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
			>
				{pointSubmitting ? '保存中...' : 'ポイント設定を保存'}
			</button>
		</form>
	</div>
</div>
