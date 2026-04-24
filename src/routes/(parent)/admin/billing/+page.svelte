<script lang="ts">
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data } = $props();

const stripeEnabled = $derived(data.stripeEnabled);
const hasSubscription = $derived(data.hasSubscription);
const hasCustomer = $derived(data.hasCustomer);
const canAccessPortal = $derived(stripeEnabled && hasCustomer);
// #771: PIN 設定済みなら PIN 必須、未設定なら確認フレーズ
const pinConfigured = $derived(data.pinConfigured);

let portalLoading = $state(false);
let portalError = $state<string | null>(null);

// #771 Portal を開く前の PIN / 確認フレーズ入力
const CONFIRM_PHRASE = 'プランを変更します';
let showPortalConfirm = $state(false);
let portalPinValue = $state('');
let portalConfirmPhrase = $state('');

function requestPortal() {
	portalPinValue = '';
	portalConfirmPhrase = '';
	portalError = null;
	showPortalConfirm = true;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
async function openPortal() {
	portalError = null;

	// 事前バリデーション (サーバーと同じ判定だが UX のため先に弾く)
	if (pinConfigured) {
		if (
			!portalPinValue ||
			portalPinValue.length < 4 ||
			portalPinValue.length > 6 ||
			!/^\d+$/.test(portalPinValue)
		) {
			portalError = 'PINコード（4〜6桁の数字）を入力してください';
			return;
		}
	} else {
		if (portalConfirmPhrase !== CONFIRM_PHRASE) {
			portalError = `「${CONFIRM_PHRASE}」と入力してください`;
			return;
		}
	}

	portalLoading = true;
	try {
		const res = await fetch('/api/stripe/portal', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(
				pinConfigured ? { pin: portalPinValue } : { confirmPhrase: portalConfirmPhrase },
			),
		});
		if (!res.ok) {
			let message = '請求管理画面を開けませんでした';
			try {
				const body = (await res.json()) as { message?: string };
				const raw = body.message ?? '';
				if (raw === 'INVALID_PIN' || raw === 'PIN_REQUIRED') {
					message = 'PINコードが正しくありません';
				} else if (raw.startsWith('LOCKED_OUT')) {
					message = 'PIN認証のロックアウト中です。しばらく待ってから再度お試しください';
				} else if (raw === 'CONFIRM_PHRASE_REQUIRED') {
					message = `「${CONFIRM_PHRASE}」と入力してください`;
				} else if (raw) {
					message = raw;
				}
			} catch {
				/* noop */
			}
			portalError = message;
			// セキュリティのため PIN 入力値をクリア
			portalPinValue = '';
			return;
		}
		const body = (await res.json()) as { url?: string };
		if (body.url) {
			window.location.href = body.url;
		}
	} catch (err) {
		portalError = err instanceof Error ? err.message : '請求管理画面を開けませんでした';
	} finally {
		portalLoading = false;
	}
}

const statusLabel = $derived.by(() => {
	switch (data.status) {
		case SUBSCRIPTION_STATUS.ACTIVE:
			return { text: '有効', icon: '✅' };
		case SUBSCRIPTION_STATUS.GRACE_PERIOD:
			return { text: '猶予期間', icon: '⚠️' };
		case SUBSCRIPTION_STATUS.SUSPENDED:
			return { text: '停止中', icon: '⏸️' };
		case SUBSCRIPTION_STATUS.TERMINATED:
			return { text: '解約済み', icon: '❌' };
		default:
			return { text: data.status, icon: '❓' };
	}
});
</script>

<svelte:head>
	<title>請求書・支払い管理 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<h1 class="text-lg font-bold text-[var(--color-text-primary)]">請求書・支払い管理</h1>

	<!-- サブスクリプション概要 -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h2 class="text-base font-semibold text-[var(--color-text-secondary)] mb-4">サブスクリプション状況</h2>

		<div class="billing-info-grid">
			<div class="billing-info-item">
				<span class="billing-info-label">ステータス</span>
				<span class="billing-info-value">{statusLabel.icon} {statusLabel.text}</span>
			</div>

			{#if hasSubscription}
				<div class="billing-info-item">
					<span class="billing-info-label">Stripe 連携</span>
					<span class="billing-info-value">✅ 連携済み</span>
				</div>
			{:else}
				<div class="billing-info-item">
					<span class="billing-info-label">Stripe 連携</span>
					<span class="billing-info-value">未連携</span>
				</div>
			{/if}

			{#if data.planExpiresAt}
				<div class="billing-info-item">
					<span class="billing-info-label">有効期限</span>
					<span class="billing-info-value">
						{new Date(data.planExpiresAt).toLocaleDateString('ja-JP')}
					</span>
				</div>
			{/if}
		</div>
		{/snippet}
	</Card>

	<!-- Stripe Customer Portal セクション -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h2 class="text-base font-semibold text-[var(--color-text-secondary)] mb-2">請求書・支払い方法</h2>
		<p class="text-sm text-[var(--color-text-muted)] mb-4">
			Stripe の管理画面で以下の操作ができます:
		</p>

		<ul class="billing-feature-list">
			<li>過去の請求書の確認・ダウンロード</li>
			<li>支払い方法（クレジットカード）の変更</li>
			<li>月額 / 年額プランの切り替え</li>
			<li>次回請求日の確認</li>
		</ul>

		{#if portalError && !showPortalConfirm}
			<Alert variant="danger" class="mb-3">
				{#snippet children()}
				{portalError}
				{/snippet}
			</Alert>
		{/if}

		{#if !stripeEnabled}
			<Alert variant="info" class="mb-3">
				{#snippet children()}
				決済機能は現在準備中です
				{/snippet}
			</Alert>
		{:else if canAccessPortal}
			<Button
				variant="primary"
				size="md"
				class="w-full"
				disabled={portalLoading}
				data-testid="billing-open-portal"
				onclick={requestPortal}
			>
				{portalLoading ? '読み込み中...' : '請求管理画面を開く'}
			</Button>
			<p class="text-xs text-[var(--color-text-tertiary)] text-center mt-2">
				Stripe の安全な管理画面に移動します
			</p>
			<p class="text-xs text-[var(--color-feedback-warning-text)] text-center mt-1">
				⚠️ {pinConfigured ? '親 PIN' : '確認フレーズ'}の入力が必要です
			</p>
		{:else}
			<Alert variant="info" class="mb-3">
				{#snippet children()}
				{#if !hasCustomer}
					サブスクリプションが未開始のため、請求情報はまだありません。
					<a href="/admin/license" class="underline text-[var(--color-text-link)]">プランを選択</a>すると利用可能になります。
				{:else}
					Stripe Customer Portal を利用するには、サブスクリプションが必要です。
				{/if}
				{/snippet}
			</Alert>
		{/if}
		{/snippet}
	</Card>

	<!-- /admin/license へのリンク -->
	<div class="billing-nav-links">
		<a href="/admin/license" class="billing-nav-link" data-testid="billing-to-license">
			<span class="billing-nav-link__icon">💎</span>
			<span class="billing-nav-link__text">
				<span class="billing-nav-link__title">プラン管理</span>
				<span class="billing-nav-link__hint">プランの選択・変更・トライアル開始</span>
			</span>
			<span class="billing-nav-link__arrow">&rarr;</span>
		</a>
	</div>
</div>

<!-- #771: 請求管理画面を開く前の PIN / 確認フレーズ確認ダイアログ -->
<Dialog bind:open={showPortalConfirm} title="請求管理画面を開く">
	{#snippet children()}
	<div class="space-y-3 text-sm text-[var(--color-text-primary)]">
		<p>
			Stripeの管理画面に移動します。この画面から支払い方法の変更・プラン切り替えが可能です。
		</p>
		<p class="text-[var(--color-feedback-warning-text)] font-semibold">
			⚠️ 誤操作を防ぐため、
			{pinConfigured ? '親 PIN コード（4〜6桁）' : '確認フレーズ'}を入力してください。
		</p>

		{#if pinConfigured}
			<div class="space-y-2">
				<label for="billing-portal-pin" class="block text-sm font-medium text-[var(--color-text-primary)]">
					親 PIN コード（4〜6桁）
				</label>
				<input
					id="billing-portal-pin"
					type="password"
					inputmode="numeric"
					pattern="[0-9]*"
					maxlength={6}
					minlength={4}
					bind:value={portalPinValue}
					placeholder="PIN を入力"
					autocomplete="off"
					data-testid="billing-portal-pin-input"
					class="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
				/>
			</div>
		{:else}
			<div class="space-y-2">
				<label for="billing-portal-confirm-phrase" class="block text-sm font-medium text-[var(--color-text-primary)]">
					確認のため「{CONFIRM_PHRASE}」と入力してください
				</label>
				<input
					id="billing-portal-confirm-phrase"
					type="text"
					bind:value={portalConfirmPhrase}
					placeholder={CONFIRM_PHRASE}
					autocomplete="off"
					data-testid="billing-portal-confirm-phrase-input"
					class="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
				/>
			</div>
		{/if}

		{#if portalError}
			<Alert variant="danger">
				{#snippet children()}
				{portalError}
				{/snippet}
			</Alert>
		{/if}
	</div>
	<div class="mt-4 flex justify-end gap-2">
		<Button
			type="button"
			variant="secondary"
			size="md"
			onclick={() => {
				showPortalConfirm = false;
				portalPinValue = '';
				portalConfirmPhrase = '';
				portalError = null;
			}}
			disabled={portalLoading}
		>
			キャンセル
		</Button>
		<Button
			type="button"
			variant="primary"
			size="md"
			onclick={openPortal}
			disabled={portalLoading}
			data-testid="billing-portal-confirm-button"
		>
			{portalLoading ? '確認中…' : '請求管理画面へ'}
		</Button>
	</div>
	{/snippet}
</Dialog>

<style>
	.billing-info-grid {
		display: grid;
		gap: 0.75rem;
	}

	.billing-info-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-border-light);
	}

	.billing-info-item:last-child {
		border-bottom: none;
	}

	.billing-info-label {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.billing-info-value {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.billing-feature-list {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
		display: grid;
		gap: 0.5rem;
	}

	.billing-feature-list li {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		padding-left: 1.25rem;
		position: relative;
	}

	.billing-feature-list li::before {
		content: '✓';
		position: absolute;
		left: 0;
		color: var(--color-action-success);
		font-weight: 700;
	}

	.billing-nav-links {
		display: grid;
		gap: 0.5rem;
	}

	.billing-nav-link {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: var(--color-surface-card);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg, 12px);
		text-decoration: none;
		transition: border-color 0.15s;
	}

	.billing-nav-link:hover {
		border-color: var(--color-border-focus);
	}

	.billing-nav-link__icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.billing-nav-link__text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.billing-nav-link__title {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.billing-nav-link__hint {
		font-size: 0.7rem;
		color: var(--color-text-tertiary);
	}

	.billing-nav-link__arrow {
		font-size: 0.85rem;
		color: var(--color-text-tertiary);
		flex-shrink: 0;
	}
</style>
