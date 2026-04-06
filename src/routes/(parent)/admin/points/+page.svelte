<script lang="ts">
import { enhance } from '$app/forms';
import { formatPointValue, getUnitLabel } from '$lib/domain/point-display';
import PageHelpButton from '$lib/ui/components/PageHelpButton.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);
const unit = $derived(getUnitLabel(ps.mode, ps.currency));
const isCurrencyMode = $derived(ps.mode === 'currency');

let selectedChildId = $state(0);
$effect(() => {
	const first = data.children[0];
	if (selectedChildId === 0 && first) {
		selectedChildId = first.id;
	}
});

/** 変換モード: 'preset' | 'manual' | 'receipt' */
let convertMode = $state<'preset' | 'manual' | 'receipt'>('preset');
let presetAmount = $state(500);
let manualInput = $state('');
let submitting = $state(false);
let convertResult = $state<{
	converted: boolean;
	message: string;
	convertedAmount: number;
	remainingBalance: number;
} | null>(null);

// Receipt OCR state
let receiptScanning = $state(false);
let receiptError = $state('');
let receiptAmount = $state(0);
let receiptRawText = $state('');
let receiptPreviewUrl = $state('');
let receiptConfirmed = $state(false);
let fileInput = $state<HTMLInputElement | null>(null);

const selectedChild = $derived(data.children.find((c) => c.id === selectedChildId));
const currentBalance = $derived(selectedChild?.balance?.balance ?? 0);
const maxConvertable = $derived(selectedChild?.balance?.convertableAmount ?? 0);

// 変換履歴
const convertHistory = $derived(selectedChild?.convertHistory ?? []);
let historyPeriod = $state<'this-month' | 'last-month' | 'all'>('all');
const filteredHistory = $derived.by(() => {
	if (historyPeriod === 'all') return convertHistory;
	const now = new Date();
	const year =
		historyPeriod === 'last-month' && now.getMonth() === 0
			? now.getFullYear() - 1
			: now.getFullYear();
	const month =
		historyPeriod === 'last-month'
			? now.getMonth() === 0
				? 12
				: now.getMonth()
			: now.getMonth() + 1;
	const prefix = `${year}-${String(month).padStart(2, '0')}`;
	return convertHistory.filter((h) => h.createdAt?.startsWith(prefix));
});
const thisMonthTotal = $derived.by(() => {
	const now = new Date();
	const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	return convertHistory
		.filter((h) => h.createdAt?.startsWith(monthStart))
		.reduce((sum, h) => sum + Math.abs(h.amount), 0);
});
const allTimeTotal = $derived(convertHistory.reduce((sum, h) => sum + Math.abs(h.amount), 0));

// Operation exclusion: prevent concurrent form/scan operations
const anyOperationBusy = $derived(submitting || receiptScanning);

const manualAmount = $derived(Math.floor(Number(manualInput) || 0));
const manualValid = $derived(manualAmount >= 1 && manualAmount <= currentBalance);
const receiptValid = $derived(
	receiptConfirmed && receiptAmount >= 1 && receiptAmount <= currentBalance,
);

const effectiveAmount = $derived(
	convertMode === 'preset'
		? presetAmount
		: convertMode === 'receipt'
			? receiptAmount
			: manualAmount,
);
const effectiveMode = $derived(convertMode);
const canSubmit = $derived(
	convertMode === 'preset'
		? maxConvertable >= 500
		: convertMode === 'receipt'
			? receiptValid
			: manualValid,
);

function resetReceipt() {
	receiptScanning = false;
	receiptError = '';
	receiptAmount = 0;
	receiptRawText = '';
	receiptPreviewUrl = '';
	receiptConfirmed = false;
}

async function handleReceiptFile(event: Event) {
	if (anyOperationBusy) return;
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) return;

	// Validate file
	if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
		receiptError = 'JPEG, PNG, WebP形式の画像を選択してください';
		return;
	}
	if (file.size > 5 * 1024 * 1024) {
		receiptError = '画像サイズは5MB以下にしてください';
		return;
	}

	resetReceipt();
	receiptScanning = true;

	// Preview
	receiptPreviewUrl = URL.createObjectURL(file);

	// Convert to base64
	const reader = new FileReader();
	reader.onload = async () => {
		const base64Full = reader.result as string;
		// Remove data:image/xxx;base64, prefix
		const base64Data = base64Full.split(',')[1];

		try {
			const res = await fetch('/api/v1/points/ocr-receipt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ image: base64Data, mimeType: file.type }),
			});

			if (!res.ok) {
				const errorBody = await res.json();
				receiptError = errorBody.error?.message ?? '読み取りに失敗しました';
				receiptScanning = false;
				return;
			}

			const data = await res.json();
			receiptAmount = data.amount;
			receiptRawText = data.rawText;
			receiptScanning = false;
		} catch {
			receiptError = '通信エラーが発生しました';
			receiptScanning = false;
		}
	};
	reader.readAsDataURL(file);

	// Reset input so same file can be re-selected
	input.value = '';
}
</script>

<svelte:head>
	<title>ポイント管理 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6" data-tutorial="points-section">
	<div class="flex items-center justify-between mb-1">
		<div class="flex items-center gap-2">
			<h2 class="text-lg font-bold">⭐ ポイント</h2>
			<PageHelpButton />
		</div>
		<a
			href="/admin/settings#point-settings"
			class="text-xs text-gray-400 hover:text-blue-500 flex items-center gap-1 transition-colors"
		>
			<span>表示: {isCurrencyMode ? ps.currency : 'ポイント（P）'}</span>
			<span>⚙️</span>
		</a>
	</div>

	<!-- Balance Overview -->
	<div class="grid gap-3">
		{#each data.children as child}
			{#if child.balance}
				<div
					class="bg-white rounded-xl p-4 shadow-sm flex items-center gap-4 cursor-pointer transition-shadow
						{selectedChildId === child.id ? 'ring-2 ring-blue-400' : 'hover:shadow-md'}"
					role="button"
					tabindex="0"
					onclick={() => { selectedChildId = child.id; convertResult = null; }}
					onkeydown={(e) => { if (e.key === 'Enter') { selectedChildId = child.id; convertResult = null; } }}
				>
					<span class="text-2xl">👤</span>
					<div class="flex-1">
						<p class="font-bold text-gray-700">{child.nickname}</p>
					</div>
					<div class="text-right">
						<p class="text-lg font-bold text-amber-500">{fmtBal(child.balance.balance)}</p>
						<p class="text-xs text-gray-400">変換可能: {fmtBal(child.balance.convertableAmount)}</p>
					</div>
				</div>
			{/if}
		{/each}
	</div>

	<!-- Convert Form -->
	{#if selectedChild && currentBalance > 0}
		<Card padding="lg"><form
			method="POST"
			action="?/convert"
			use:enhance={({ cancel }) => {
				if (anyOperationBusy) { cancel(); return; }
				submitting = true;
				return async ({ result, update }) => {
					submitting = false;
					if (result.type === 'success' && result.data && 'converted' in result.data) {
						convertResult = result.data as typeof convertResult;
						manualInput = '';
						resetReceipt();
					}
					await update();
				};
			}}
			class="space-y-4"
		>
			<h3 class="font-bold text-gray-700">{selectedChild.nickname}のおこづかいにかえる</h3>
			{#if isCurrencyMode}
				<p class="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded mt-1">
					💡 変換した金額を実際にお子さまへお渡しください
				</p>
			{/if}
			<input type="hidden" name="childId" value={selectedChildId} />
			<input type="hidden" name="mode" value={effectiveMode} />
			<input type="hidden" name="amount" value={effectiveAmount} />

			<!-- Mode Tabs -->
			<div class="flex rounded-lg bg-gray-100 p-1">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="flex-1 py-2 text-sm rounded-md
						{convertMode === 'preset' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
					onclick={() => { convertMode = 'preset'; resetReceipt(); }}
				>
					かんたん
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="flex-1 py-2 text-sm rounded-md
						{convertMode === 'manual' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
					onclick={() => { convertMode = 'manual'; resetReceipt(); }}
				>
					自由入力
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="flex-1 py-2 text-sm rounded-md
						{convertMode === 'receipt' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
					onclick={() => { convertMode = 'receipt'; manualInput = ''; }}
				>
					領収書
				</Button>
			</div>

			<!-- Preset Mode -->
			{#if convertMode === 'preset'}
				<div>
					<span class="block text-sm font-bold text-gray-500 mb-2">変換{unit}数（{fmtBal(500)}単位）</span>
					{#if maxConvertable >= 500}
						<div class="flex gap-2 flex-wrap">
							{#each [500, 1000, 1500, 2000] as opt}
								{#if opt <= maxConvertable}
									<Button
										type="button"
										variant={presetAmount === opt ? 'primary' : 'ghost'}
										size="sm"
										class={presetAmount === opt ? '' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
										onclick={() => presetAmount = opt}
									>
										{fmtBal(opt)}
									</Button>
								{/if}
							{/each}
						</div>
					{:else}
						<p class="text-sm text-gray-400">{fmtBal(500)}以上で変換できます（現在 {fmtBal(currentBalance)}）</p>
					{/if}
				</div>

			<!-- Manual Mode -->
			{:else if convertMode === 'manual'}
				<FormField
					label="変換{unit}数（自由入力）"
					error={manualInput && manualAmount > currentBalance ? '残高を超えています' : manualInput && manualAmount < 1 ? '1P以上を入力してください' : undefined}
					hint="{isCurrencyMode ? '' : '1P = 1円 / '}残高: {fmtBal(currentBalance)}"
				>
					{#snippet children()}
						<div class="flex items-center gap-2">
							<input
								type="number"
								min="1"
								max={currentBalance}
								step="1"
								bind:value={manualInput}
								placeholder="金額を入力"
								class="flex-1 px-4 py-3 border-2 rounded-xl text-lg font-bold text-right
									{manualInput && !manualValid ? 'border-red-300 bg-red-50' : 'border-gray-200 focus:border-blue-400'}
									outline-none transition-colors"
								inputmode="numeric"
							/>
							<span class="text-lg font-bold text-gray-500">P</span>
						</div>
						<div class="flex items-center justify-end mt-2">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="text-xs text-blue-500 hover:text-blue-700"
								onclick={() => manualInput = String(currentBalance)}
							>
								全額変換
							</Button>
						</div>
					{/snippet}
				</FormField>

			<!-- Receipt OCR Mode -->
			{:else}
				<div class="space-y-3">
					<span class="block text-sm font-bold text-gray-500">領収書を撮影して金額を読み取り</span>

					<!-- File input (hidden, triggered by button) -->
					<input
						bind:this={fileInput}
						type="file"
						accept="image/jpeg,image/png,image/webp"
						capture="environment"
						class="hidden"
						onchange={handleReceiptFile}
					/>

					{#if !receiptPreviewUrl}
						<!-- Capture button -->
						<Button
							type="button"
							variant="ghost"
							size="lg"
							class="w-full py-8 border-2 border-dashed border-gray-300
								text-gray-400 hover:border-blue-400 hover:text-blue-500
								flex flex-col items-center gap-2"
							onclick={() => fileInput?.click()}
						>
							<span class="text-4xl">📸</span>
							<span class="text-sm font-bold">領収書を撮影 / 画像を選択</span>
							<span class="text-xs">JPEG, PNG, WebP（5MB以下）</span>
						</Button>
					{:else}
						<!-- Preview + Result -->
						<div class="space-y-3">
							<!-- Image preview -->
							<div class="relative">
								<img
									src={receiptPreviewUrl}
									alt="領収書プレビュー"
									class="w-full max-h-48 object-contain rounded-lg border border-gray-200"
								/>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="absolute top-2 right-2 bg-black/50 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm hover:bg-black/70"
									onclick={() => { resetReceipt(); }}
									aria-label="プレビューを閉じる"
								>
									✕
								</Button>
							</div>

							{#if receiptScanning}
								<!-- Scanning indicator -->
								<div class="text-center py-4">
									<div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
									<p class="text-sm text-gray-500 mt-2">金額を読み取り中...</p>
								</div>
							{:else if receiptError}
								<!-- Error -->
								<div class="bg-red-50 rounded-lg p-3 text-center">
									<p class="text-sm text-red-600 font-bold">{receiptError}</p>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										class="mt-2 text-xs text-blue-500 hover:text-blue-700"
										onclick={() => { resetReceipt(); fileInput?.click(); }}
									>
										再撮影する
									</Button>
								</div>
							{:else if receiptAmount > 0}
								<!-- OCR Result -->
								<div class="bg-blue-50 rounded-lg p-4 space-y-3">
									<div class="text-center">
										<p class="text-xs text-gray-500">読み取り結果</p>
										<p class="text-xs text-gray-400 mt-0.5">{receiptRawText}</p>
									</div>

									<!-- Editable amount -->
									<FormField label="" hint="金額が違う場合は修正できます">
										{#snippet children()}
											<div class="flex items-center justify-center gap-2">
												<input
													type="number"
													min="1"
													max={currentBalance}
													step="1"
													bind:value={receiptAmount}
													class="w-32 px-3 py-2 border-2 rounded-lg text-lg font-bold text-right
														{receiptAmount > currentBalance ? 'border-red-300' : 'border-blue-300 focus:border-blue-500'}
														outline-none transition-colors"
													inputmode="numeric"
												/>
												<span class="text-lg font-bold text-gray-500">円</span>
											</div>
										{/snippet}
									</FormField>

									{#if receiptAmount > currentBalance}
										<p class="text-xs text-red-500 text-center">残高（{fmtBal(currentBalance)}）を超えています</p>
									{:else}
										<!-- Confirm button -->
										{#if !receiptConfirmed}
											<Button
												type="button"
												variant="primary"
												size="sm"
												class="w-full"
												onclick={() => receiptConfirmed = true}
											>
												この金額で変換する
											</Button>
										{:else}
											<div class="text-center">
												<span class="inline-block bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full">
													金額確定済み
												</span>
											</div>
										{/if}
									{/if}
								</div>

								<!-- Retake button -->
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="w-full text-center text-xs text-gray-400 hover:text-gray-600"
									onclick={() => { resetReceipt(); fileInput?.click(); }}
								>
									別の領収書を撮影する
								</Button>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Convert Preview & Button -->
			{#if canSubmit}
				<div class="bg-amber-50 rounded-lg p-3 text-center space-y-1">
					<p class="text-sm text-amber-700">
						<span class="font-bold text-lg">{fmtBal(effectiveAmount)}</span>
						{#if !isCurrencyMode}→ <span class="font-bold text-lg">{effectiveAmount.toLocaleString()}円</span>分のおこづかい{/if}
					</p>
					<p class="text-xs text-amber-600">
						残高: {fmtBal(currentBalance)} → {fmtBal(currentBalance - effectiveAmount)}
						{#if thisMonthTotal > 0}
							／今月の合計: {fmtBal(thisMonthTotal)} → {fmtBal(thisMonthTotal + effectiveAmount)}
						{/if}
					</p>
				</div>
				<Button
					type="submit"
					variant="warning"
					size="md"
					class="w-full bg-amber-500 hover:bg-amber-600"
					disabled={submitting}
				>
					{#if submitting}
						変換中...
					{:else}
						{fmtBal(effectiveAmount)} を{isCurrencyMode ? '渡す' : '変換する'}
					{/if}
				</Button>
			{/if}
		</form></Card>
	{:else if selectedChild}
		<Card padding="lg" class="text-center text-gray-400">
			<p>変換可能な{unit}がありません</p>
		</Card>
	{/if}

	<!-- Result -->
	{#if convertResult}
		<div class="bg-green-50 rounded-xl p-4 border border-green-200 text-center">
			<p class="text-green-700 font-bold">{convertResult.message}</p>
			<p class="text-sm text-green-600 mt-1">残高: {fmtBal(convertResult.remainingBalance)}</p>
		</div>
	{/if}

	<!-- Convert History -->
	{#if selectedChild && convertHistory.length > 0}
		<Card padding="lg">
			<h3 class="font-bold text-gray-700 mb-4">おこづかい変換りれき</h3>

			<!-- Summary -->
			<div class="grid grid-cols-2 gap-3">
				<div class="bg-blue-50 rounded-lg p-3 text-center">
					<p class="text-xs text-gray-500">今月の合計</p>
					<p class="text-lg font-bold text-blue-600">{fmtBal(thisMonthTotal)}</p>
				</div>
				<div class="bg-purple-50 rounded-lg p-3 text-center">
					<p class="text-xs text-gray-500">累計</p>
					<p class="text-lg font-bold text-purple-600">{fmtBal(allTimeTotal)}</p>
				</div>
			</div>

			<!-- Period Filter -->
			<div class="flex rounded-lg bg-gray-100 p-1">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="flex-1 py-1.5 text-xs rounded-md
						{historyPeriod === 'this-month' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
					onclick={() => historyPeriod = 'this-month'}
				>
					今月
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="flex-1 py-1.5 text-xs rounded-md
						{historyPeriod === 'last-month' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
					onclick={() => historyPeriod = 'last-month'}
				>
					先月
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="flex-1 py-1.5 text-xs rounded-md
						{historyPeriod === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}"
					onclick={() => historyPeriod = 'all'}
				>
					全期間
				</Button>
			</div>

			<!-- History List -->
			{#if filteredHistory.length > 0}
				<div class="divide-y divide-gray-100">
					{#each filteredHistory as entry}
						<div class="flex items-center justify-between py-3">
							<div>
								<p class="text-sm text-gray-500">
									{entry.createdAt ? new Date(entry.createdAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) : '—'}
								</p>
							</div>
							<p class="font-bold text-amber-600">-{fmtBal(Math.abs(entry.amount))}</p>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-gray-400 text-center py-4">この期間の変換履歴はありません</p>
			{/if}
		</Card>
	{/if}
</div>
