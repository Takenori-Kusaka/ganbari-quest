// #2320 (EPIC #2319 ①): notifications page の通知 status UI 制御。
//
// 旧 /admin/settings/+page.svelte の inline `<script>` ブロック (plain JS) を
// TypeScript module に切出し、`<script lang="ts">` 統合時の complexity 違反
// (cognitiveComplexity 48 超) を helper 分離で 20 以下に抑える。
// onMount 内から `initNotificationStatusUi()` 1 行呼出しのみで完結する設計。

interface NotificationLabels {
	deviceUnsupported: string;
	blocked: string;
	unset: string;
	active: string;
	inactive: string;
	pending: string;
}

const CLASS_DEFAULT = 'text-xs px-2 py-1 rounded-full';
const CLASS_NEUTRAL = `${CLASS_DEFAULT} bg-[var(--color-neutral-200)] text-[var(--color-text)]`;
const CLASS_ERROR = `${CLASS_DEFAULT} bg-[var(--color-feedback-error-bg-strong)] text-[var(--color-feedback-error-text)]`;
const CLASS_WARNING = `${CLASS_DEFAULT} bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]`;
const CLASS_SUCCESS = `${CLASS_DEFAULT} bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]`;

function setStatus(el: HTMLElement | null, text: string, cls: string): void {
	if (!el) return;
	el.textContent = text;
	el.className = cls;
}

function show(el: HTMLElement | null): void {
	el?.classList.remove('hidden');
}

function hide(el: HTMLElement | null): void {
	el?.classList.add('hidden');
}

function readLabels(container: HTMLElement | null): NotificationLabels {
	return {
		deviceUnsupported: container?.dataset.notifDeviceUnsupported ?? '',
		blocked: container?.dataset.notifBlocked ?? '',
		unset: container?.dataset.notifUnset ?? '',
		active: container?.dataset.notifActive ?? '',
		inactive: container?.dataset.notifInactive ?? '',
		pending: container?.dataset.notifPending ?? '',
	};
}

function isPushApiSupported(): boolean {
	return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function syncSubscriptionStatus(
	L: NotificationLabels,
	statusEl: HTMLElement | null,
	actionEl: HTMLElement | null,
	subscribedEl: HTMLElement | null,
): Promise<void> {
	const reg = await navigator.serviceWorker.ready;
	const sub = await reg.pushManager.getSubscription();
	if (sub) {
		setStatus(statusEl, L.active, CLASS_SUCCESS);
		show(subscribedEl);
	} else {
		setStatus(statusEl, L.pending, CLASS_WARNING);
		show(actionEl);
	}
}

async function applyInitialStatus(
	L: NotificationLabels,
	statusEl: HTMLElement | null,
	actionEl: HTMLElement | null,
	subscribedEl: HTMLElement | null,
): Promise<void> {
	if (!isPushApiSupported()) {
		setStatus(statusEl, L.deviceUnsupported, CLASS_NEUTRAL);
		return;
	}
	const permission = Notification.permission;
	if (permission === 'denied') {
		setStatus(statusEl, L.blocked, CLASS_ERROR);
		return;
	}
	if (permission === 'default') {
		setStatus(statusEl, L.unset, CLASS_WARNING);
		show(actionEl);
		return;
	}
	await syncSubscriptionStatus(L, statusEl, actionEl, subscribedEl);
}

function bindSubscribeButton(
	subscribeBtn: HTMLElement | null,
	L: NotificationLabels,
	statusEl: HTMLElement | null,
	actionEl: HTMLElement | null,
	subscribedEl: HTMLElement | null,
): void {
	if (!subscribeBtn) return;
	subscribeBtn.addEventListener('click', async () => {
		const { subscribeToPush } = await import('$lib/features/admin/push-subscription');
		const sub = await subscribeToPush();
		if (!sub) return;
		setStatus(statusEl, L.active, CLASS_SUCCESS);
		hide(actionEl);
		show(subscribedEl);
	});
}

function bindUnsubscribeButton(
	unsubscribeBtn: HTMLElement | null,
	L: NotificationLabels,
	statusEl: HTMLElement | null,
	actionEl: HTMLElement | null,
	subscribedEl: HTMLElement | null,
): void {
	if (!unsubscribeBtn) return;
	unsubscribeBtn.addEventListener('click', async () => {
		const { unsubscribeFromPush } = await import('$lib/features/admin/push-subscription');
		await unsubscribeFromPush();
		setStatus(statusEl, L.inactive, CLASS_NEUTRAL);
		hide(subscribedEl);
		show(actionEl);
	});
}

/**
 * 通知ステータス UI を初期化。onMount 内から 1 行呼ぶだけで完結。
 */
export async function initNotificationStatusUi(): Promise<void> {
	const statusEl = document.getElementById('notification-status');
	const actionEl = document.getElementById('notification-action');
	const subscribedEl = document.getElementById('notification-subscribed');
	const subscribeBtn = document.getElementById('notification-subscribe-btn');
	const unsubscribeBtn = document.getElementById('notification-unsubscribe-btn');
	const notifContainer = statusEl?.closest('[data-notif-active]') as HTMLElement | null;
	const L = readLabels(notifContainer);

	await applyInitialStatus(L, statusEl, actionEl, subscribedEl);
	bindSubscribeButton(subscribeBtn, L, statusEl, actionEl, subscribedEl);
	bindUnsubscribeButton(unsubscribeBtn, L, statusEl, actionEl, subscribedEl);
}
