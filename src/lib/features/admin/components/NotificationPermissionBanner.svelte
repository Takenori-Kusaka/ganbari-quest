<script lang="ts">
import { FEATURES_LABELS } from '$lib/domain/labels';
import {
	getNotificationPermission,
	isPushSupported,
	subscribeToPush,
} from '$lib/features/admin/push-subscription';
import { showToast } from '$lib/ui/primitives/Toast.svelte';

// #2115 (Bug fix: loading / try-catch / Toast / fallback)
// #2116 (透明性 UX: 2 段階開示 informed consent)
//
// 重要な状態管理:
// - loading: subscribe 実行中の二重クリック防止 + ボタン disable
// - permission: $effect で再評価 (許可済み環境では visible=false に)
// - errorState: 失敗時 inline fallback UI 表示用
// - disclosureOpen: <details> open/close 状態 (デフォルト closed = 第 1 段階のみ表示)

let dismissed = $state(false);
let subscribed = $state(false);
// 初期値は同期評価 (SSR 時は isPushSupported=false なので supported=false で render、
// hydration 後 client mount で $effect が更新する。Browser 直 mount でも 1 回 reactive sync)。
let supported = $state(isPushSupported());
let permission = $state<NotificationPermission>(
	isPushSupported() ? getNotificationPermission() : 'default',
);
let loading = $state(false);
let errorState = $state<'denied' | 'generic' | null>(null);

const L = FEATURES_LABELS.notificationBanner;

// hydration 後の再評価 (SSR → CSR で window が出現するケースのみ意味あり)
$effect(() => {
	const next = isPushSupported();
	if (next !== supported) {
		supported = next;
	}
	if (next) {
		const p = getNotificationPermission();
		if (p !== permission) {
			permission = p;
		}
	}
});

// visible は通常 permission='default' のみ。ただし subscribe 失敗時 (errorState!==null) は
// permission が denied になっても error fallback UI を見せるためバナーを残す。
const visible = $derived(
	supported && !dismissed && !subscribed && (permission === 'default' || errorState !== null),
);

async function handleSubscribe() {
	// #2115 AC2: 二重クリック防止 + disable
	if (loading) return;
	loading = true;
	errorState = null;

	try {
		// #2115 AC1: try/catch でフィードバック保証
		const sub = await subscribeToPush();

		// #2115 AC5: permission を再評価
		if (supported) {
			permission = getNotificationPermission();
		}

		if (sub) {
			// #2115 AC3: 成功 Toast + バナー消滅
			subscribed = true;
			showToast(L.toastSuccessTitle, L.toastSuccessDesc, 'success');
		} else {
			// 許可ダイアログで拒否された / unsupported / VAPID 取得失敗等 (subscribeToPush が null を返したケース)
			// permission 再評価結果に基づき、denied なら denied UI / それ以外は generic
			errorState = permission === 'denied' ? 'denied' : 'generic';
		}
	} catch (err) {
		// #2115 AC1 / AC4: 例外時 inline fallback UI + Toast (silent 失敗防止)
		console.error('[NotificationPermissionBanner] subscribe failed', err);
		// permission 状態を再評価して denied / generic を出し分け
		if (supported) {
			permission = getNotificationPermission();
		}
		errorState = permission === 'denied' ? 'denied' : 'generic';
	} finally {
		loading = false;
	}
}
</script>

{#if visible}
	<div class="notification-banner" data-testid="notification-permission-banner">
		<div class="notification-banner__main">
			<div class="notification-banner__icon" aria-hidden="true">🔔</div>
			<div class="notification-banner__content">
				<p class="notification-banner__title">{L.title}</p>
				<!-- #2116 AC2: 第 1 段階 (頻度 / 内容 / 送信先 / quiet hours の一目把握) -->
				<p class="notification-banner__desc" data-testid="notification-banner-desc-compact">
					{L.descCompact}
				</p>
			</div>
			<div class="notification-banner__actions">
				<button
					type="button"
					class="notification-banner__cta"
					onclick={handleSubscribe}
					disabled={loading}
					aria-busy={loading}
					data-testid="notification-banner-cta"
				>
					{loading ? L.loadingLabel : L.ctaBtn}
				</button>
				<button
					type="button"
					class="notification-banner__dismiss"
					onclick={() => (dismissed = true)}
					disabled={loading}
					data-testid="notification-banner-dismiss"
				>
					{L.dismissBtn}
				</button>
			</div>
		</div>

		<!-- #2115 AC4: inline 失敗 fallback UI (errorState 時のみ) -->
		{#if errorState}
			<div
				class="notification-banner__error"
				role="alert"
				data-testid="notification-banner-error"
			>
				<p class="notification-banner__error-title">{L.errorTitle}</p>
				<p class="notification-banner__error-desc">
					{errorState === 'denied' ? L.errorDescDenied : L.errorDescGeneric}
				</p>
				<a
					href="/admin/settings"
					class="notification-banner__error-link"
					data-testid="notification-banner-settings-link"
				>
					{L.errorSettingsLinkLabel}
				</a>
			</div>
		{/if}

		<!-- #2116 AC3-4: 2 段階開示 (詳細を見る) -->
		<details
			class="notification-banner__disclosure"
			data-testid="notification-banner-disclosure"
		>
			<summary class="notification-banner__disclosure-summary">
				{L.disclosureLabel}
			</summary>
			<div class="notification-banner__disclosure-body">
				<dl class="notification-banner__kind-list">
					<dt>{L.disclosureContent.reminderTitle}</dt>
					<dd>{L.disclosureContent.reminderExample}</dd>
					<dt>{L.disclosureContent.streakWarningTitle}</dt>
					<dd>{L.disclosureContent.streakWarningExample}</dd>
					<dt>{L.disclosureContent.achievementTitle}</dt>
					<dd>{L.disclosureContent.achievementExample}</dd>
				</dl>
				<p class="notification-banner__disclosure-note">
					{L.disclosureParentOnly}
				</p>
				<p class="notification-banner__disclosure-note">
					{L.disclosureQuietHours}
				</p>
				<p class="notification-banner__disclosure-note">
					{L.disclosureOffNote}
					<a href="/admin/settings" class="notification-banner__disclosure-link">
						{L.disclosureSettingsLinkLabel}
					</a>
				</p>
			</div>
		</details>
	</div>
{/if}

<style>
	.notification-banner {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 16px;
		background: var(--color-surface-card);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.notification-banner__main {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.notification-banner__icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.notification-banner__content {
		flex: 1;
		min-width: 0;
	}

	.notification-banner__title {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text-primary);
		margin: 0;
	}

	.notification-banner__desc {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin: 2px 0 0;
		line-height: 1.4;
	}

	.notification-banner__actions {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex-shrink: 0;
	}

	.notification-banner__cta {
		padding: 6px 12px;
		border: none;
		border-radius: 8px;
		background: var(--color-action-primary);
		color: var(--color-text-inverse);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}

	.notification-banner__cta:hover:not(:disabled) {
		opacity: 0.9;
	}

	.notification-banner__cta:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.notification-banner__dismiss {
		padding: 4px 8px;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 0.6875rem;
		cursor: pointer;
		text-align: center;
	}

	.notification-banner__dismiss:hover:not(:disabled) {
		text-decoration: underline;
	}

	.notification-banner__dismiss:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.notification-banner__error {
		padding: 8px 12px;
		background: var(--color-feedback-error-bg);
		border: 1px solid var(--color-feedback-error-border);
		border-radius: 8px;
		color: var(--color-feedback-error-text);
	}

	.notification-banner__error-title {
		font-size: 0.8125rem;
		font-weight: 700;
		margin: 0;
	}

	.notification-banner__error-desc {
		font-size: 0.75rem;
		margin: 2px 0 4px;
	}

	.notification-banner__error-link {
		font-size: 0.75rem;
		color: var(--color-text-link);
		text-decoration: underline;
	}

	.notification-banner__disclosure {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.notification-banner__disclosure-summary {
		cursor: pointer;
		font-weight: 600;
		padding: 4px 0;
		color: var(--color-text-link);
	}

	.notification-banner__disclosure-summary:hover {
		text-decoration: underline;
	}

	.notification-banner__disclosure-body {
		padding: 8px 4px 4px;
		line-height: 1.5;
	}

	.notification-banner__kind-list {
		margin: 0 0 8px;
	}

	.notification-banner__kind-list dt {
		font-weight: 700;
		color: var(--color-text-primary);
		margin-top: 6px;
	}

	.notification-banner__kind-list dd {
		margin: 2px 0 0 1em;
		color: var(--color-text-secondary);
	}

	.notification-banner__disclosure-note {
		margin: 4px 0 0;
	}

	.notification-banner__disclosure-link {
		color: var(--color-text-link);
		text-decoration: underline;
		margin-left: 4px;
	}
</style>
