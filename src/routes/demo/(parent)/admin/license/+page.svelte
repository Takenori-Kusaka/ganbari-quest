<script lang="ts">
// /demo/admin/license — デモ版プラン・お支払い画面 (#790, #817)
// 本番 /admin/license の見た目に合わせつつ、Stripe 決済はデモトースト、
// ライセンスキー適用はモックフロー（入力→確認ダイアログ→プラン変化アニメーション）で再現。

import { onMount } from 'svelte';
import { getPlanLabel } from '$lib/domain/labels';
import { getLicenseHighlights } from '$lib/domain/plan-features';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data } = $props();

const license = $derived(data.license);
const planStats = $derived(data.planStats);

let selectedTier = $state<'standard' | 'family'>('standard');
let billingInterval = $state<'monthly' | 'yearly'>('monthly');
let showDemoToast = $state(false);
let hydrated = $state(false);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

// #817: ライセンスキー適用モックフロー
let licenseKeyInput = $state('');
let showApplyConfirm = $state(false);
let agreedLicenseOnce = $state(false);
let applyLoading = $state(false);
let showLicenseHelp = $state(false);
// モック: 適用成功後にプランが切り替わる演出
let appliedPlan = $state<'free' | 'standard' | 'family'>('free');
let showApplySuccess = $state(false);

const currentPlanLabel = $derived(getPlanLabel(appliedPlan));

// E2E hydration マーカー (data-hydrated 属性でハンドラ attach 完了を検知可能にする)
onMount(() => {
	hydrated = true;
});

function notifyDemoOnly() {
	clearTimeout(toastTimer);
	showDemoToast = true;
	toastTimer = setTimeout(() => {
		showDemoToast = false;
	}, 3000);
}

/** #817: デモ用ライセンスキー適用モック。入力値に応じてプランを変更する演出 */
function handleMockApply() {
	applyLoading = true;
	// 500ms の擬似遅延でリアルな体験を模擬
	setTimeout(() => {
		// キー入力に "FAMILY" が含まれていればファミリー、それ以外はスタンダード
		const key = licenseKeyInput.toUpperCase();
		appliedPlan = key.includes('FAMILY') ? 'family' : 'standard';
		applyLoading = false;
		showApplyConfirm = false;
		showApplySuccess = true;
		licenseKeyInput = '';
		agreedLicenseOnce = false;
		// 5秒後に成功メッセージを非表示
		setTimeout(() => {
			showApplySuccess = false;
		}, 5000);
	}, 500);
}
</script>

<svelte:head>
	<title>プラン・お支払い（デモ） - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6" data-testid="demo-license-page" data-hydrated={hydrated ? 'true' : 'false'}>
	<!-- デモ説明 -->
	<Alert variant="info" data-testid="demo-license-notice">
		{#snippet children()}
			<p class="text-sm font-semibold mb-1">これはデモ画面です</p>
			<p class="text-xs">
				本番の /admin/license と同じ画面構成ですが、Stripe決済・ライセンスキー適用・
				トライアル開始はすべて無効化されています。クリックしても課金は発生しません。
			</p>
		{/snippet}
	</Alert>

	<!-- #817: 適用成功メッセージ -->
	{#if showApplySuccess}
		<Alert variant="success" data-testid="demo-apply-success">
			{#snippet children()}
				<p class="text-sm font-semibold">ライセンスキーが適用されました（デモ）</p>
				<p class="text-xs mt-1">
					プランが <strong>{currentPlanLabel}</strong> に変更されました。
					これはデモの模擬動作です。実際のプラン変更は行われていません。
				</p>
			{/snippet}
		</Alert>
	{/if}

	<!-- 現在のプラン -->
	<Card variant="default" padding="lg">
		{#snippet children()}
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">現在のプラン（デモ）</h3>

			<div class="grid gap-4">
				<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
					<span class="text-sm text-[var(--color-text-muted)]">プラン</span>
					<span class="text-sm font-semibold text-[var(--color-text-primary)]" data-testid="demo-current-plan">{currentPlanLabel}</span>
				</div>
				<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
					<span class="text-sm text-[var(--color-text-muted)]">ステータス</span>
					<span class="text-xs font-medium px-2.5 py-1 rounded-full bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]">
						✅ 有効
					</span>
				</div>
				<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
					<span class="text-sm text-[var(--color-text-muted)]">家族名</span>
					<span class="text-sm text-[var(--color-text-primary)]">{license.tenantName}</span>
				</div>
				<div class="flex items-center justify-between py-2">
					<span class="text-sm text-[var(--color-text-muted)]">登録日</span>
					<span class="text-sm text-[var(--color-text-primary)]">
						{new Date(license.createdAt).toLocaleDateString('ja-JP')}
					</span>
				</div>
			</div>
		{/snippet}
	</Card>

	<!-- プラン利用状況（デモ版: PlanStatusCard は CTA が /admin/license にハードコードされているため使わない） -->
	{#if planStats}
		<Card variant="default" padding="lg">
			{#snippet children()}
				<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-3">プラン利用状況</h3>
				<div class="grid grid-cols-3 gap-4">
					<div class="flex flex-col gap-0.5">
						<span class="text-xs text-[var(--color-text-tertiary)]">カスタム活動</span>
						<span class="text-sm font-semibold text-[var(--color-text-primary)]">
							{planStats.activityCount} / {planStats.activityMax === null ? '無制限' : planStats.activityMax}
						</span>
					</div>
					<div class="flex flex-col gap-0.5">
						<span class="text-xs text-[var(--color-text-tertiary)]">こども</span>
						<span class="text-sm font-semibold text-[var(--color-text-primary)]">
							{planStats.childCount} / {planStats.childMax === null ? '無制限' : planStats.childMax}
						</span>
					</div>
					<div class="flex flex-col gap-0.5">
						<span class="text-xs text-[var(--color-text-tertiary)]">データ保持</span>
						<span class="text-sm font-semibold text-[var(--color-text-primary)]">
							{planStats.retentionDays === null ? '無制限' : `${planStats.retentionDays}日間`}
						</span>
					</div>
				</div>
			{/snippet}
		</Card>
	{/if}

	<!-- 無料トライアル（デモ版） -->
	<Card variant="default" padding="lg">
		{#snippet children()}
			<div class="text-center">
				<p class="text-lg font-bold text-[var(--color-text-primary)] mb-1">
					7日間 無料でお試し
				</p>
				<p class="text-sm text-[var(--color-text-muted)] mb-4">
					スタンダードプランの全機能を体験できます
				</p>
				<Button
					type="button"
					variant="primary"
					size="md"
					class="w-full"
					onclick={notifyDemoOnly}
					data-testid="demo-trial-start-button"
				>
					無料トライアルを開始する
				</Button>
				<p class="text-xs text-[var(--color-text-tertiary)] mt-2">
					デモではトライアルは開始できません
				</p>
			</div>
		{/snippet}
	</Card>

	<!-- #817: ライセンスキー適用（デモ版 — 本番同等のモックフロー） -->
	<Card variant="default" padding="lg">
		{#snippet children()}
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">
				💎 ライセンスキーをお持ちの方
			</h3>
			<p class="text-sm text-[var(--color-text-muted)] mb-3">
				買い切りライセンスキーをお持ちの場合は、こちらで適用できます。
			</p>
			<div class="space-y-3">
				<label for="demoLicenseKey" class="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
					ライセンスキー
				</label>
				<input
					id="demoLicenseKey"
					type="text"
					bind:value={licenseKeyInput}
					placeholder="GQ-XXXX-XXXX-XXXX"
					autocomplete="off"
					class="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
					data-testid="demo-license-key-input"
				/>

				<!-- #799: 折りたたみヘルプ -->
				<div>
					<button
						type="button"
						class="text-xs text-[var(--color-text-link)] underline hover:no-underline"
						aria-expanded={showLicenseHelp}
						onclick={() => { showLicenseHelp = !showLicenseHelp; }}
						data-testid="demo-license-help-toggle"
					>
						{showLicenseHelp ? '▼' : '▶'} ライセンスキーについて
					</button>
					{#if showLicenseHelp}
						<div
							class="mt-2 p-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] border border-[var(--color-border-default)] text-xs text-[var(--color-text-muted)] leading-relaxed space-y-1.5"
							data-testid="demo-license-help"
						>
							<p><strong class="text-[var(--color-text-primary)]">一回限りの使用</strong>: 一度有効化すると、他のアカウントでは使用できません。</p>
							<p><strong class="text-[var(--color-text-primary)]">プラン自動付与</strong>: キーに対応するプランが自動で付与されます。</p>
							<p><strong class="text-[var(--color-text-primary)]">紐付け先</strong>: 現在のアカウント（家族）に紐付き、他の家族に付け替えできません。</p>
							<p><strong class="text-[var(--color-text-primary)]">取り消し不可</strong>: 適用後の取り消しはできません。</p>
						</div>
					{/if}
				</div>

				<Button
					type="button"
					variant="primary"
					size="md"
					class="w-full"
					disabled={!licenseKeyInput.trim()}
					onclick={() => {
						agreedLicenseOnce = false;
						showApplyConfirm = true;
					}}
					data-testid="demo-license-key-apply-button"
				>
					ライセンスキーを適用
				</Button>
				<p class="text-xs text-[var(--color-text-tertiary)] text-center">
					デモでは実際の適用は行われません（画面の変化を体験できます）
				</p>
			</div>

			<!-- #817: 確認ダイアログ（本番同等） -->
			<Dialog
				bind:open={showApplyConfirm}
				title="ライセンスキーを有効化しますか？"
				testid="demo-license-key-confirm-dialog"
			>
				{#snippet children()}
				<div class="space-y-3 text-sm text-[var(--color-text-primary)]">
					<p>入力されたライセンスキーを現在のアカウントに適用します。</p>
					<ul class="list-disc pl-5 text-[var(--color-text-muted)] space-y-1">
						<li><strong>一回限り</strong>使用可能です（適用後は他アカウントで使えなくなります）</li>
						<li>キーに対応する<strong>プラン</strong>が自動で付与されます</li>
						<li>このキーは<strong>「デモファミリー」</strong>に紐付けられます</li>
						<li>適用を<strong>取り消すことはできません</strong></li>
					</ul>
					<div class="rounded-lg bg-[var(--color-surface-muted)] px-3 py-2">
						<p class="text-[10px] text-[var(--color-text-tertiary)] mb-0.5">入力されたキー</p>
						<p class="font-mono text-xs text-[var(--color-text-secondary)] break-all" data-testid="demo-license-key-confirm-display">
							{licenseKeyInput}
						</p>
					</div>

					<label class="flex items-start gap-2 cursor-pointer pt-1">
						<input
							type="checkbox"
							bind:checked={agreedLicenseOnce}
							class="mt-0.5 w-4 h-4 shrink-0 accent-[var(--theme-primary)]"
							data-testid="demo-license-key-once-checkbox"
						/>
						<span class="text-xs text-[var(--color-text-muted)] leading-relaxed">
							このライセンスキーが<strong class="text-[var(--color-text-primary)]">一回限り使用</strong>であり、
							他のアカウントでは使えなくなることに同意します
						</span>
					</label>

					<Alert variant="info">
						{#snippet children()}
							<p class="text-xs">これはデモの模擬操作です。実際のキー消費やプラン変更は行われません。</p>
						{/snippet}
					</Alert>
				</div>
				<div class="mt-4 flex justify-end gap-2">
					<Button
						type="button"
						variant="secondary"
						size="md"
						onclick={() => (showApplyConfirm = false)}
						disabled={applyLoading}
					>
						キャンセル
					</Button>
					<Button
						type="button"
						variant="primary"
						size="md"
						disabled={applyLoading || !agreedLicenseOnce}
						data-testid="demo-license-key-confirm-button"
						onclick={handleMockApply}
					>
						{applyLoading ? '適用中…' : '適用する'}
					</Button>
				</div>
				{/snippet}
			</Dialog>
		{/snippet}
	</Card>

	<!-- プラン管理 -->
	<Card variant="default" padding="lg">
		{#snippet children()}
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">プラン管理</h3>

			<div class="grid gap-4">
				<!-- 請求間隔切り替え -->
				<div class="flex justify-center gap-2 mb-2">
					<button
						type="button"
						class="interval-btn"
						class:active={billingInterval === 'monthly'}
						onclick={() => (billingInterval = 'monthly')}
					>
						月額
					</button>
					<button
						type="button"
						class="interval-btn"
						class:active={billingInterval === 'yearly'}
						onclick={() => (billingInterval = 'yearly')}
					>
						年額（17% OFF）
					</button>
				</div>

				<!-- スタンダードプラン -->
				<div
					class="plan-card"
					class:selected={selectedTier === 'standard'}
					role="button"
					tabindex="0"
					onclick={() => (selectedTier = 'standard')}
					onkeydown={(e) => e.key === 'Enter' && (selectedTier = 'standard')}
				>
					<div class="flex items-center justify-between mb-2">
						<div>
							<p class="font-semibold text-[var(--color-text-primary)]">スタンダード</p>
							<p class="text-xs text-[var(--color-text-muted)]">子供無制限・活動無制限・1年保持</p>
						</div>
						{#if billingInterval === 'monthly'}
							<p class="text-xl font-bold text-[var(--color-feedback-info-text)]">
								¥500<span class="text-sm font-normal text-[var(--color-text-muted)]">/月</span>
							</p>
						{:else}
							<p class="text-xl font-bold text-[var(--color-feedback-info-text)]">
								¥5,000<span class="text-sm font-normal text-[var(--color-text-muted)]">/年</span>
							</p>
						{/if}
					</div>
					<ul class="text-xs text-[var(--color-text-muted)] space-y-1 mb-3">
						{#each getLicenseHighlights('standard') as highlight}
							<li>{highlight}</li>
						{/each}
					</ul>
				</div>

				<!-- ファミリープラン -->
				<div
					class="plan-card recommended"
					class:selected={selectedTier === 'family'}
					role="button"
					tabindex="0"
					onclick={() => (selectedTier = 'family')}
					onkeydown={(e) => e.key === 'Enter' && (selectedTier = 'family')}
				>
					<span class="recommend-badge">おすすめ</span>
					<div class="flex items-center justify-between mb-2">
						<div>
							<p class="font-semibold text-[var(--color-text-primary)]">ファミリー</p>
							<p class="text-xs text-[var(--color-text-muted)]">家族みんなで見守る+永久保持</p>
						</div>
						{#if billingInterval === 'monthly'}
							<p class="text-xl font-bold text-[var(--color-stat-purple)]">
								¥780<span class="text-sm font-normal text-[var(--color-text-muted)]">/月</span>
							</p>
						{:else}
							<p class="text-xl font-bold text-[var(--color-stat-purple)]">
								¥7,800<span class="text-sm font-normal text-[var(--color-text-muted)]">/年</span>
							</p>
						{/if}
					</div>
					<ul class="text-xs text-[var(--color-text-muted)] space-y-1 mb-3">
						{#each getLicenseHighlights('family') as highlight}
							<li>{highlight}</li>
						{/each}
					</ul>
				</div>

				<!-- 購入ボタン（デモ） -->
				<Button
					type="button"
					variant="primary"
					size="md"
					class="w-full"
					onclick={notifyDemoOnly}
					data-testid="demo-checkout-button"
				>
					{selectedTier === 'family' ? 'ファミリー' : 'スタンダード'}プランで始める
				</Button>

				<p class="text-xs text-[var(--color-text-tertiary)] text-center">
					デモでは実際の決済は行われません
				</p>
			</div>
		{/snippet}
	</Card>

	<!-- 支払い履歴 -->
	<Card variant="default" padding="lg">
		{#snippet children()}
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">支払い履歴</h3>
			<p class="text-sm text-[var(--color-text-tertiary)] text-center py-4">
				支払い履歴はまだありません
			</p>
		{/snippet}
	</Card>

	{#if showDemoToast}
		<div class="demo-toast" role="status" data-testid="demo-toast">
			デモでは実際の操作はできません
		</div>
	{/if}
</div>

<style>
	.interval-btn {
		padding: 6px 16px;
		font-size: 0.8rem;
		font-weight: 600;
		border-radius: 8px;
		border: 1px solid var(--color-border-default);
		background: var(--color-surface-card);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}

	.interval-btn.active {
		background: var(--color-action-primary);
		color: var(--color-text-inverse);
		border-color: var(--color-action-primary);
	}

	.plan-card {
		position: relative;
		border: 2px solid var(--color-border-default);
		border-radius: 12px;
		padding: 16px;
		cursor: pointer;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	.plan-card:hover {
		border-color: var(--color-border-focus);
	}

	.plan-card.selected {
		border-color: var(--color-action-primary);
		box-shadow: 0 0 0 1px var(--color-action-primary);
	}

	.recommend-badge {
		position: absolute;
		top: -10px;
		left: 16px;
		background: var(--color-action-primary);
		color: var(--color-text-inverse);
		font-size: 0.7rem;
		font-weight: 700;
		padding: 2px 10px;
		border-radius: 9999px;
	}

	.demo-toast {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--color-feedback-info-bg-strong);
		color: var(--color-feedback-info-text);
		padding: 12px 20px;
		border-radius: 8px;
		font-size: 0.875rem;
		font-weight: 600;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		z-index: 1000;
	}
</style>
