<script lang="ts">
import { enhance } from '$app/forms';
import { page } from '$app/stores';
import { CURRENCY_CODES, CURRENCY_DEFS, formatPointValue } from '$lib/domain/point-display';
import type { CurrencyCode, PointUnitMode } from '$lib/domain/point-display';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';
import { APP_VERSION } from '$lib/version';

let { data, form } = $props();

let success = $state(false);
let submitting = $state(false);

// エクスポート
let exportLoading = $state(false);
let exportError = $state('');
let compactFormat = $state(false);
let includeFiles = $state(false);

// インポート
let importFile = $state<File | null>(null);
let importLoading = $state(false);
let importError = $state('');
let importPreview = $state<Record<string, number> | null>(null);
let importResult = $state<{
	childrenImported: number;
	activitiesCreated: number;
	activityLogsImported: number;
	activityLogsSkipped: number;
	pointLedgerImported: number;
	pointLedgerSkipped: number;
	errors: string[];
	warnings: string[];
} | null>(null);
let importStep = $state<'select' | 'preview' | 'done'>('select');

async function handleImportFileChange(e: Event) {
	const input = e.target as HTMLInputElement;
	importFile = input.files?.[0] ?? null;
	importError = '';
	importPreview = null;
	importResult = null;
	importStep = 'select';

	if (!importFile) return;
	if (!importFile.name.endsWith('.json')) {
		importError = 'JSONファイルを選択してください';
		importFile = null;
		return;
	}
	if (importFile.size > 10 * 1024 * 1024) {
		importError = 'ファイルサイズが大きすぎます（最大10MB）';
		importFile = null;
		return;
	}

	importLoading = true;
	try {
		const text = await importFile.text();
		const json = JSON.parse(text);
		const res = await fetch('/api/v1/import?mode=preview', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(json),
		});
		const data = await res.json();
		if (!res.ok) {
			throw new Error(data?.error?.message ?? 'プレビューに失敗しました');
		}
		importPreview = data.preview;
		importStep = 'preview';
	} catch (err) {
		importError = err instanceof Error ? err.message : 'ファイルの読み込みに失敗しました';
		importFile = null;
	} finally {
		importLoading = false;
	}
}

async function handleImportExecute() {
	if (!importFile) return;
	importLoading = true;
	importError = '';
	try {
		const text = await importFile.text();
		const json = JSON.parse(text);
		const mode = importMode === 'replace' ? 'replace' : 'execute';
		const res = await fetch(`/api/v1/import?mode=${mode}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(json),
		});
		const data = await res.json();
		if (!res.ok) {
			throw new Error(data?.error?.message ?? 'インポートに失敗しました');
		}
		importResult = data.result;
		importStep = 'done';
	} catch (err) {
		importError = err instanceof Error ? err.message : 'インポートに失敗しました';
	} finally {
		importLoading = false;
	}
}

function resetImport() {
	importFile = null;
	importPreview = null;
	importResult = null;
	importError = '';
	importStep = 'select';
}

async function handleExport() {
	exportLoading = true;
	exportError = '';
	try {
		const params = new URLSearchParams();
		if (compactFormat) params.set('compact', '1');
		if (includeFiles) params.set('format', 'zip');
		const qs = params.toString() ? `?${params.toString()}` : '';
		const res = await fetch(`/api/v1/export${qs}`);
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

// ステータス減少設定
let decayIntensity = $state<string>('normal');
let decaySaving = $state(false);
let decaySuccess = $state(false);
// サーバーデータから減少設定を同期
$effect(() => {
	decayIntensity = data.decayIntensity ?? 'normal';
});

const DECAY_OPTIONS = [
	{ value: 'none', label: 'なし', desc: '減少しません（練習や導入期間向け）' },
	{ value: 'gentle', label: 'ゆるやか', desc: '通常の半分の速度で減少します' },
	{ value: 'normal', label: 'ふつう', desc: '猶予2日後にゆるやかに減少します' },
	{ value: 'strict', label: 'きびしめ', desc: '上級者向け。1.5倍の速度で減少します' },
] as const;

async function saveDecayIntensity() {
	decaySaving = true;
	decaySuccess = false;
	try {
		const res = await fetch('/api/v1/settings/decay', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ intensity: decayIntensity }),
		});
		if (!res.ok) throw new Error('Failed to save');
		decaySuccess = true;
		setTimeout(() => {
			decaySuccess = false;
		}, 3000);
	} finally {
		decaySaving = false;
	}
}

// ポイント表示設定
let pointSuccess = $state(false);
let pointSubmitting = $state(false);
let pointMode = $state<PointUnitMode>('point');
let pointCurrency = $state<CurrencyCode>('JPY');
let pointRate = $state('1');
// サーバーデータからポイント設定を同期
$effect(() => {
	pointMode = data.pointSettings.mode;
	pointCurrency = data.pointSettings.currency;
	pointRate = String(data.pointSettings.rate);
});

// フィードバック
let feedbackSuccess = $state(false);
let feedbackSubmitting = $state(false);
let feedbackCategory = $state('feature');
let feedbackText = $state('');
let feedbackEmail = $state('');
let feedbackInquiryId = $state('');

// データクリア
let clearConfirmText = $state('');
let clearSubmitting = $state(false);
let clearError = $state('');
let clearSuccess = $state(false);

// インポートモード
let importMode = $state<'add' | 'replace'>('replace');

// アカウント削除
let cancelConfirmText = $state('');
let cancelSubmitting = $state(false);
let cancelError = $state('');
let reactivateSubmitting = $state(false);

async function handleCancelAccount() {
	if (cancelConfirmText !== 'アカウントを削除します') return;
	cancelSubmitting = true;
	cancelError = '';
	try {
		const res = await fetch('/api/v1/admin/tenant/cancel', { method: 'POST' });
		const d = await res.json();
		if (!res.ok) throw new Error(d.error ?? '解約申請に失敗しました');
		window.location.reload();
	} catch (err) {
		cancelError = err instanceof Error ? err.message : '解約申請に失敗しました';
	} finally {
		cancelSubmitting = false;
	}
}

async function handleReactivate() {
	reactivateSubmitting = true;
	try {
		const res = await fetch('/api/v1/admin/tenant/reactivate', { method: 'POST' });
		const d = await res.json();
		if (!res.ok) throw new Error(d.error ?? '解約キャンセルに失敗しました');
		window.location.reload();
	} catch (err) {
		cancelError = err instanceof Error ? err.message : '解約キャンセルに失敗しました';
	} finally {
		reactivateSubmitting = false;
	}
}

const previewPoints = 100;
const previewFormatted = $derived(
	formatPointValue(previewPoints, pointMode, pointCurrency, Number.parseFloat(pointRate) || 1),
);
</script>

<svelte:head>
	<title>設定 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<!-- grace_period バナー -->
	{#if $page.data.tenantStatus === 'grace_period'}
		<div class="bg-red-50 border-2 border-red-300 rounded-xl p-6">
			<h3 class="text-lg font-bold text-red-700 mb-2">解約手続き中です</h3>
			<p class="text-sm text-red-600 mb-4">
				現在、アカウントは解約手続き中で読み取り専用モードです。
				期限までにキャンセルしないとデータが完全に削除されます。
			</p>
			{#if cancelError}
				<ErrorAlert message={cancelError} severity="error" action="retry" />
			{/if}
			<button
				type="button"
				disabled={reactivateSubmitting}
				onclick={handleReactivate}
				class="px-6 py-2 bg-green-500 text-white font-bold rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
			>
				{reactivateSubmitting ? 'キャンセル中...' : '解約をキャンセルして通常利用に戻る'}
			</button>
		</div>
	{/if}

	<!-- PIN変更 -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6" data-tutorial="pin-settings">
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

	<!-- ステータス減少設定 -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
		<h3 class="text-lg font-bold text-gray-700 mb-4">📊 ステータス減少設定</h3>
		<p class="text-sm text-gray-500 mb-4">
			活動をお休みした日のステータス減少の強さを設定できます。どの設定でも最初の2日間は減少しません。
		</p>

		{#if decaySuccess}
			<SuccessAlert message="ステータス減少設定を保存しました" />
		{/if}

		<div class="space-y-3 mb-4">
			{#each DECAY_OPTIONS as opt}
				<label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors {decayIntensity === opt.value ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}">
					<input
						type="radio"
						name="decayIntensity"
						value={opt.value}
						bind:group={decayIntensity}
						class="mt-0.5 accent-blue-500"
					/>
					<div>
						<span class="font-semibold text-gray-700">{opt.label}</span>
						<p class="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
					</div>
				</label>
			{/each}
		</div>

		<button
			type="button"
			onclick={saveDecayIntensity}
			disabled={decaySaving}
			class="w-full py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
		>
			{decaySaving ? '保存中...' : '設定を保存'}
		</button>
	</div>

	<!-- きょうだいチャレンジ設定 -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
		<h3 class="text-lg font-bold text-gray-700 mb-4">👥 きょうだいチャレンジ設定</h3>

		{#if form?.siblingSuccess}
			<div class="rounded-lg bg-green-50 p-3 text-sm text-green-700 mb-4">きょうだい設定を保存しました</div>
		{/if}
		{#if form?.siblingError}
			<div class="rounded-lg bg-red-50 p-3 text-sm text-red-700 mb-4">{form.siblingError}</div>
		{/if}

		<form method="POST" action="?/updateSiblingSettings" use:enhance class="space-y-4">
			<div>
				<label class="block text-sm font-semibold text-gray-600 mb-2">チャレンジモード</label>
				<div class="space-y-2">
					{#each [
						{ value: 'both', label: '協力＆競争（両方）', desc: '協力チャレンジと競争チャレンジの両方を利用' },
						{ value: 'cooperative', label: '協力のみ', desc: 'きょうだいで協力するチャレンジのみ' },
						{ value: 'competitive', label: '競争のみ', desc: 'きょうだい間の競争チャレンジのみ' },
					] as opt}
						<label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors {data.siblingMode === opt.value ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}">
							<input type="radio" name="siblingMode" value={opt.value} checked={data.siblingMode === opt.value} class="mt-0.5" />
							<div>
								<span class="text-sm font-medium text-gray-700">{opt.label}</span>
								<p class="text-xs text-gray-500">{opt.desc}</p>
							</div>
						</label>
					{/each}
				</div>
			</div>
			<label class="flex items-center gap-2">
				<input type="checkbox" name="siblingRankingEnabled" checked={data.siblingRankingEnabled === 'true'} class="h-4 w-4 rounded border-gray-300" />
				<span class="text-sm text-gray-700">きょうだいランキングを表示する</span>
			</label>
			<button type="submit" class="w-full py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600 transition-colors">
				設定を保存
			</button>
		</form>
	</div>

	<!-- ポイント表示設定 -->
	<div id="point-settings" class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
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
				<label class="flex items-center gap-2 mb-2 text-sm text-gray-600 cursor-pointer">
					<input type="checkbox" bind:checked={includeFiles} class="w-4 h-4 text-blue-500 rounded" />
					画像・音声ファイルも含める（ZIP形式）
				</label>
				{#if !includeFiles}
					<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
						<p class="text-xs text-yellow-600">画像・音声を含める場合は上のチェックをオンにしてください。ファイルサイズが大きくなる場合があります（最大100MB）。</p>
					</div>
				{/if}
				<label class="flex items-center gap-2 mb-3 text-sm text-gray-600 cursor-pointer">
					<input type="checkbox" bind:checked={compactFormat} class="w-4 h-4 text-blue-500 rounded" />
					圧縮形式でエクスポート（ファイルサイズを削減）
				</label>
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

			<hr class="my-4 border-gray-200" />

			<!-- インポート -->
			<div>
				<h4 class="text-sm font-bold text-gray-600 mb-2">データのインポート</h4>

				{#if importError}
					<ErrorAlert message={importError} severity="warning" action="fix_input" />
				{/if}

				{#if importStep === 'select'}
					<p class="text-sm text-gray-600 mb-3">
						エクスポートしたJSONファイルからデータを復元できます。
					</p>
					<div class="mb-3">
						<span class="block text-sm font-medium text-gray-600 mb-2">インポートモード</span>
						<div class="flex gap-3">
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="radio" value="replace" bind:group={importMode} class="w-4 h-4 text-orange-500" />
								<span class="text-sm">置換（既存データを削除してインポート）</span>
							</label>
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="radio" value="add" bind:group={importMode} class="w-4 h-4 text-orange-500" />
								<span class="text-sm">追加（既存データを残して追加）</span>
							</label>
						</div>
						{#if importMode === 'replace'}
							<p class="text-xs text-red-500 mt-1">既存の子供・活動ログ・ポイント等のデータをすべて削除してからインポートします。</p>
						{:else}
							<p class="text-xs text-gray-400 mt-1">新しい子供データとして追加されます（既存データは上書きされません）。</p>
						{/if}
					</div>
					<label class="block w-full py-2 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 transition-colors text-center cursor-pointer {importLoading ? 'opacity-50 pointer-events-none' : ''}">
						{#if importLoading}
							<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
							読み込み中...
						{:else}
							JSONファイルを選択
						{/if}
						<input type="file" accept=".json" onchange={handleImportFileChange} class="hidden" />
					</label>
				{:else if importStep === 'preview' && importPreview}
					<div class="bg-orange-50 rounded-lg p-4 mb-3">
						<p class="text-sm font-bold text-orange-700 mb-2">インポート内容の確認</p>
						<ul class="text-xs text-orange-700 space-y-1">
							<li>子供: {importPreview.children}人</li>
							<li>活動ログ: {importPreview.activityLogs}件</li>
							<li>ポイント履歴: {importPreview.pointLedger}件</li>
							<li>ステータス: {importPreview.statuses}件</li>
							<li>実績: {importPreview.achievements}件</li>
							<li>称号: {importPreview.titles}件</li>
							{#if (importPreview.loginBonuses ?? 0) > 0}
								<li>ログインボーナス: {importPreview.loginBonuses}件</li>
							{/if}
							{#if (importPreview.checklistTemplates ?? 0) > 0}
								<li>チェックリスト: {importPreview.checklistTemplates}件</li>
							{/if}
						</ul>
					</div>
					<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
						{#if importMode === 'replace'}
							<p class="text-xs text-red-600 font-bold">
								既存データをすべて削除してからインポートします。この操作は取り消せません。
							</p>
						{:else}
							<p class="text-xs text-yellow-700">
								インポートすると新しい子供データとして追加されます。この操作は取り消せません。
							</p>
						{/if}
					</div>
					<div class="flex gap-2">
						<button
							type="button"
							onclick={resetImport}
							class="flex-1 py-2 bg-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-400 transition-colors"
						>
							キャンセル
						</button>
						<button
							type="button"
							disabled={importLoading}
							onclick={handleImportExecute}
							class="flex-1 py-2 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
						>
							{#if importLoading}
								<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
								インポート中...
							{:else}
								インポートを実行
							{/if}
						</button>
					</div>
				{:else if importStep === 'done' && importResult}
					<div class="bg-green-50 rounded-lg p-4 mb-3">
						<p class="text-sm font-bold text-green-700 mb-2">インポート完了</p>
						<ul class="text-xs text-green-700 space-y-1">
							<li>子供: {importResult.childrenImported}人 作成</li>
							{#if importResult.activitiesCreated > 0}
								<li>活動マスタ: {importResult.activitiesCreated}件 新規作成</li>
							{/if}
							<li>活動ログ: {importResult.activityLogsImported}件{importResult.activityLogsSkipped > 0 ? `（${importResult.activityLogsSkipped}件スキップ）` : ''}</li>
							<li>ポイント: {importResult.pointLedgerImported}件{importResult.pointLedgerSkipped > 0 ? `（${importResult.pointLedgerSkipped}件スキップ）` : ''}</li>
							{#if (importResult.warnings?.length ?? 0) > 0}
								<li class="text-yellow-600 mt-2">
									警告 ({importResult.warnings.length}件):
									<ul class="ml-3 mt-1">
										{#each importResult.warnings.slice(0, 5) as warn}
											<li>{warn}</li>
										{/each}
										{#if importResult.warnings.length > 5}
											<li>...他 {importResult.warnings.length - 5}件</li>
										{/if}
									</ul>
								</li>
							{/if}
							{#if importResult.errors.length > 0}
								<li class="text-orange-600 mt-2">
									エラー ({importResult.errors.length}件):
									<ul class="ml-3 mt-1">
										{#each importResult.errors.slice(0, 5) as err}
											<li>{err}</li>
										{/each}
										{#if importResult.errors.length > 5}
											<li>...他 {importResult.errors.length - 5}件</li>
										{/if}
									</ul>
								</li>
							{/if}
						</ul>
					</div>
					<button
						type="button"
						onclick={resetImport}
						class="w-full py-2 bg-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-400 transition-colors"
					>
						閉じる
					</button>
				{/if}
			</div>
		</div>
	</div>

	<!-- データクリア -->
	<div class="bg-white rounded-xl shadow-sm border-2 border-red-200 p-6">
		<h3 class="text-lg font-bold text-red-600 mb-4">🗑️ データクリア</h3>

		{#if clearSuccess}
			<SuccessAlert message="データクリアが完了しました。ページを再読み込みしてください。" />
		{/if}

		{#if clearError}
			<ErrorAlert message={clearError} severity="error" action="retry" />
		{/if}

		{#if form?.clearError}
			<ErrorAlert message={form.clearError} severity="warning" action="fix_input" />
		{/if}

		<p class="text-sm text-gray-600 mb-3">
			すべての家族データ（子供・活動ログ・ポイント・ステータス等）を一括削除します。
			活動マスタ・カテゴリなどのシステムデータは保持されます。
		</p>

		{#if data.dataSummary}
			<div class="bg-red-50 rounded-lg p-4 mb-4">
				<p class="text-sm font-bold text-red-700 mb-2">現在のデータ件数</p>
				<ul class="text-xs text-red-700 space-y-1 columns-2">
					<li>子供: {data.dataSummary.children}人</li>
					<li>活動ログ: {data.dataSummary.activityLogs}件</li>
					<li>ポイント履歴: {data.dataSummary.pointLedger}件</li>
					<li>ステータス: {data.dataSummary.statuses}件</li>
					<li>実績: {data.dataSummary.achievements}件</li>
					<li>称号: {data.dataSummary.titles}件</li>
					<li>ログインボーナス: {data.dataSummary.loginBonuses}件</li>
					<li>チェックリスト: {data.dataSummary.checklistTemplates}件</li>
				</ul>
			</div>
		{/if}

		<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
			<p class="text-xs text-red-600 font-bold">
				この操作は取り消せません。事前にデータをエクスポートすることをお勧めします。
			</p>
		</div>

		<form
			method="POST"
			action="?/clearData"
			use:enhance={() => {
				clearSubmitting = true;
				clearSuccess = false;
				clearError = '';
				return async ({ result, update }) => {
					clearSubmitting = false;
					if (result.type === 'success') {
						clearSuccess = true;
						clearConfirmText = '';
					}
					await update();
				};
			}}
		>
			<div class="space-y-3">
				<label for="clearConfirm" class="block text-sm font-medium text-gray-600">
					確認のため「削除」と入力してください
				</label>
				<input
					type="text"
					id="clearConfirm"
					name="confirm"
					bind:value={clearConfirmText}
					placeholder="削除"
					class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300"
				/>
				<button
					type="submit"
					disabled={clearSubmitting || clearConfirmText !== '削除'}
					class="w-full py-2 bg-red-500 text-white font-bold rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{clearSubmitting ? 'データクリア中...' : 'すべてのデータを削除'}
				</button>
			</div>
		</form>
	</div>

	<!-- フィードバック -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6" data-tutorial="feedback-section">
		<h3 class="text-lg font-bold text-gray-700 mb-4">💬 フィードバック・ご意見</h3>

		{#if feedbackSuccess}
			<SuccessAlert message={feedbackInquiryId
				? `お問い合わせを受け付けました。受付番号: ${feedbackInquiryId}\n${feedbackEmail ? '入力いただいたメールアドレスに確認メールをお送りしました。' : ''}`
				: 'お問い合わせありがとうございます。今後の参考とさせていただきます。'} />
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
				feedbackInquiryId = '';
				return async ({ result, update }) => {
					feedbackSubmitting = false;
					if (result.type === 'success') {
						feedbackSuccess = true;
						feedbackInquiryId = (result.data as { inquiryId?: string })?.inquiryId ?? '';
						feedbackText = '';
						feedbackCategory = 'feature';
						feedbackEmail = '';
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

			<div>
				<label for="feedbackEmail" class="block text-sm font-medium text-gray-600 mb-1">
					返信先メールアドレス
					<span class="text-xs text-gray-400 ml-1">（任意）</span>
				</label>
				<input
					type="email"
					id="feedbackEmail"
					name="email"
					bind:value={feedbackEmail}
					placeholder="reply@example.com"
					maxlength="254"
					class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
				/>
				<p class="text-xs text-gray-400 mt-1">
					ご入力いただいた場合、内容によってはメールでご返信する場合があります
				</p>
			</div>

			<button
				type="submit"
				disabled={feedbackSubmitting || feedbackText.length === 0}
				class="w-full py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
			>
				{feedbackSubmitting ? '送信中...' : 'フィードバックを送信'}
			</button>
		</form>
		<p class="text-xs text-gray-400 mt-3 text-center">
			技術的なご質問・使い方の相談は
			<a href="https://discord.gg/5pWkf4Z5" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline">Discord コミュニティ</a>
			でも受け付けています
		</p>
	</div>

	<!-- アプリ情報・リンク -->
	<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
		<h3 class="text-lg font-bold text-gray-700 mb-4">ℹ️ アプリ情報</h3>
		<ul class="space-y-3 text-sm">
			<li>
				<a href="https://www.ganbari-quest.com/terms.html" target="_blank" rel="noopener" class="text-blue-500 hover:underline">📄 利用規約</a>
			</li>
			<li>
				<a href="https://www.ganbari-quest.com/privacy.html" target="_blank" rel="noopener" class="text-blue-500 hover:underline">🔒 プライバシーポリシー</a>
			</li>
			<li>
				<a href="https://discord.gg/5pWkf4Z5" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline">💬 Discord コミュニティ</a>
			</li>
			<li>
				<a href="https://github.com/Takenori-Kusaka/ganbari-quest" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline">🐙 GitHub</a>
			</li>
			<li>
				<span class="text-gray-500">バージョン: {APP_VERSION}</span>
			</li>
		</ul>
	</div>

	<!-- アカウント削除（cognito モードの owner のみ） -->
	{#if $page.data.authMode === 'cognito' && $page.data.tenantStatus !== 'grace_period'}
		<div class="bg-white rounded-xl shadow-sm border-2 border-red-200 p-6">
			<h3 class="text-lg font-bold text-red-600 mb-2">アカウント削除</h3>
			<div class="text-sm text-gray-600 space-y-2 mb-4">
				<p>アカウントを削除すると、30日間の猶予期間の後に以下のデータが完全に削除されます。</p>
				<ul class="list-disc ml-5 text-gray-500 space-y-1">
					<li>子供のプロフィール・活動記録・ポイント履歴</li>
					<li>アバター画像・音声ファイル</li>
					<li>設定・チェックリスト・キャリアプラン</li>
					<li>メンバーシップ・招待情報</li>
				</ul>
				<p class="text-red-500 font-medium">
					削除後のデータ復旧はできません。事前にデータをエクスポートすることを強くお勧めします。
				</p>
			</div>

			{#if cancelError}
				<ErrorAlert message={cancelError} severity="error" action="retry" />
			{/if}

			<div class="mt-4 space-y-3">
				<label for="cancelConfirm" class="block text-sm font-medium text-gray-600">
					確認のため「アカウントを削除します」と入力してください
				</label>
				<input
					type="text"
					id="cancelConfirm"
					bind:value={cancelConfirmText}
					placeholder="アカウントを削除します"
					class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300"
				/>
				<button
					type="button"
					disabled={cancelSubmitting || cancelConfirmText !== 'アカウントを削除します'}
					onclick={handleCancelAccount}
					class="w-full py-2 bg-red-500 text-white font-bold rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{cancelSubmitting ? '処理中...' : 'アカウント削除を申請する'}
				</button>
			</div>
		</div>
	{/if}

	<!-- ログアウト（cognito モードのみ） -->
	{#if $page.data.authMode === 'cognito'}
		<div class="bg-white rounded-xl shadow-sm border border-red-100 p-6">
			<h3 class="text-lg font-bold text-gray-700 mb-2">ログアウト</h3>
			<p class="text-sm text-gray-500 mb-4">
				このデバイスからがんばりクエストのアカウントからログアウトします。再度ログインするにはメールアドレスとパスワードが必要です。
			</p>
			<a
				href="/auth/signout"
				class="inline-block px-4 py-2 bg-red-50 text-red-600 text-sm font-medium rounded-lg border border-red-200 hover:bg-red-100 transition-colors"
			>
				アカウントからログアウト
			</a>
		</div>
	{/if}
</div>
