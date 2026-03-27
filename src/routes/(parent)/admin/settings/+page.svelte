<script lang="ts">
import { enhance } from '$app/forms';
import { CURRENCY_CODES, CURRENCY_DEFS, formatPointValue } from '$lib/domain/point-display';
import type { CurrencyCode, PointUnitMode } from '$lib/domain/point-display';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';

let { data, form } = $props();

let success = $state(false);
let submitting = $state(false);

// エクスポート
let exportLoading = $state(false);
let exportError = $state('');

async function handleExport() {
	exportLoading = true;
	exportError = '';
	try {
		const res = await fetch('/api/v1/export');
		if (!res.ok) {
			const data = await res.json().catch(() => null);
			throw new Error(data?.error?.message ?? `エクスポートに失敗しました (${res.status})`);
		}
		const blob = await res.blob();
		const disposition = res.headers.get('Content-Disposition') ?? '';
		const filenameMatch = disposition.match(/filename="(.+)"/);
		const filename =
			filenameMatch?.[1] ?? `ganbari-quest-backup-${new Date().toISOString().split('T')[0]}.json`;
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	} catch (err) {
		exportError = err instanceof Error ? err.message : 'エクスポートに失敗しました';
	} finally {
		exportLoading = false;
	}
}

// ポイント表示設定
let pointSuccess = $state(false);
let pointSubmitting = $state(false);
let pointMode = $state<PointUnitMode>(data.pointSettings.mode);
let pointCurrency = $state<CurrencyCode>(data.pointSettings.currency);
let pointRate = $state(String(data.pointSettings.rate));

// フィードバック
let feedbackSuccess = $state(false);
let feedbackSubmitting = $state(false);
let feedbackCategory = $state('feature');
let feedbackText = $state('');

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

	<!-- データ管理 -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
		<h3 class="text-lg font-bold text-gray-700 mb-4">💾 データ管理</h3>

		{#if exportError}
			<ErrorAlert message={exportError} severity="error" action="retry" />
		{/if}

		<div class="space-y-4">
			<div>
				<p class="text-sm text-gray-600 mb-3">
					家族のデータをJSONファイルとしてダウンロードできます。バックアップや別環境への移行に使用できます。
				</p>
				<div class="bg-gray-50 rounded-lg p-3 mb-3">
					<p class="text-xs text-gray-500">エクスポート対象:</p>
					<ul class="text-xs text-gray-500 mt-1 space-y-0.5">
						<li>子供プロフィール・活動記録・ポイント履歴</li>
						<li>ステータス・実績・称号・ログインボーナス</li>
						<li>チェックリスト・キャリアプラン・誕生日振り返り</li>
						<li>活動マスタ・きせかえアイテム</li>
					</ul>
				</div>
				<button
					type="button"
					disabled={exportLoading}
					onclick={handleExport}
					class="w-full py-2 bg-green-500 text-white font-bold rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
				>
					{#if exportLoading}
						<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
						エクスポート中...
					{:else}
						データをエクスポート
					{/if}
				</button>
			</div>
		</div>
	</div>

	<!-- フィードバック -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
		<h3 class="text-lg font-bold text-gray-700 mb-4">💬 フィードバック・ご意見</h3>

		{#if feedbackSuccess}
			<SuccessAlert message="フィードバックを送信しました。ありがとうございます！" />
		{/if}

		{#if form?.feedbackError}
			<ErrorAlert message={form.feedbackError} severity="warning" action="fix_input" />
		{/if}

		<form
			method="POST"
			action="?/sendFeedback"
			use:enhance={() => {
				feedbackSubmitting = true;
				feedbackSuccess = false;
				return async ({ result, update }) => {
					feedbackSubmitting = false;
					if (result.type === 'success') {
						feedbackSuccess = true;
						feedbackText = '';
						feedbackCategory = 'feature';
					}
					await update();
				};
			}}
			class="flex flex-col gap-4"
		>
			<div>
				<label for="feedbackCategory" class="block text-sm font-medium text-gray-600 mb-1">
					カテゴリ
				</label>
				<select
					id="feedbackCategory"
					name="category"
					bind:value={feedbackCategory}
					class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
				>
					<option value="feature">機能要望</option>
					<option value="bug">バグ報告</option>
					<option value="other">その他</option>
				</select>
			</div>

			<div>
				<label for="feedbackText" class="block text-sm font-medium text-gray-600 mb-1">
					内容
				</label>
				<textarea
					id="feedbackText"
					name="text"
					bind:value={feedbackText}
					rows="4"
					maxlength="1000"
					required
					placeholder="ご意見・ご要望をお聞かせください..."
					class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 resize-y"
				></textarea>
				<p class="text-xs text-gray-400 mt-1 text-right">{feedbackText.length}/1000</p>
			</div>

			<button
				type="submit"
				disabled={feedbackSubmitting || feedbackText.length === 0}
				class="w-full py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
			>
				{feedbackSubmitting ? '送信中...' : 'フィードバックを送信'}
			</button>
		</form>
	</div>

	<!-- アプリ情報・リンク -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
		<h3 class="text-lg font-bold text-gray-700 mb-4">ℹ️ アプリ情報</h3>
		<ul class="space-y-3 text-sm">
			<li>
				<a href="https://takenori-kusaka.github.io/ganbari-quest/terms.html" target="_blank" rel="noopener" class="text-blue-500 hover:underline">📄 利用規約</a>
			</li>
			<li>
				<a href="https://takenori-kusaka.github.io/ganbari-quest/privacy.html" target="_blank" rel="noopener" class="text-blue-500 hover:underline">🔒 プライバシーポリシー</a>
			</li>
			<li>
				<span class="text-gray-500">バージョン: 1.0.0</span>
			</li>
		</ul>
	</div>
</div>
