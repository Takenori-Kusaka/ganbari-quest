<script lang="ts">
// #2320 (EPIC #2319 ①): notifications グループ — notification 1 section のみ。
// 旧 /admin/settings/+page.svelte 行 929 を移行。
// #3186: 旧 data-notif-* 属性 + 命令的 notification-status-ui.ts を撤廃し、
// Svelte 5 reactive ($state) + getPushStatus / subscribeToPush + Toast 構成に置換。
// ユーザ向けステータスは ON/OFF + 異常系 (ブロック/非対応) に集約 (内部状態ジャーゴン排除)。

import { onMount } from 'svelte';
import { enhance } from '$app/forms';
import { APP_LABELS, PAGE_TITLES, SETTINGS_LABELS } from '$lib/domain/labels';
import {
	getPushStatus,
	getPushStatusSync,
	type PushStatus,
	subscribeToPush,
	unsubscribeFromPush,
} from '$lib/features/admin/push-subscription';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import { showToast } from '$lib/ui/primitives/Toast.svelte';

let { data, form } = $props();

// #3186: 通知ステータスを reactive に保持。内部の permission↔subscription 差は
// getPushStatus() が 'unsupported'/'blocked'/'off'/'on' の 4 値に隠蔽する。
// 'checking' は初期化中の一瞬のみ (バッジ・ボタンを出さない)。
let status = $state<PushStatus | 'checking'>('checking');
let busy = $state(false);

onMount(() => {
	// 同期判定で即座に確定 (unsupported / blocked / off)。'checking' で固まらせない。
	status = getPushStatusSync();
	// 購読済み (on) のみ非同期で後追い更新。失敗時は同期値を維持。
	void getPushStatus()
		.then((s) => {
			status = s;
		})
		.catch(() => {});
});

// 「通知をオンにする」: loading 表示 + 成功/失敗 Toast。silent no-op を撲滅 (#3186)。
async function enableNotifications() {
	busy = true;
	try {
		const sub = await subscribeToPush();
		if (sub) {
			status = 'on';
			showToast(SETTINGS_LABELS.notificationEnableSuccess, undefined, 'success');
		} else {
			// null = 非対応 / 拒否 / VAPID 未設定 等。現在状態を取り直して反映し失敗を必ず通知。
			status = await getPushStatus().catch(() => 'unsupported' as PushStatus);
			showToast(SETTINGS_LABELS.notificationEnableFailure, undefined, 'error');
		}
	} catch {
		showToast(SETTINGS_LABELS.notificationEnableFailure, undefined, 'error');
	} finally {
		busy = false;
	}
}

// 「通知をオフにする」: enableNotifications と対称。解除失敗時も silent no-op を撲滅 (#3186)。
async function disableNotifications() {
	busy = true;
	try {
		await unsubscribeFromPush();
		status = 'off';
		showToast(SETTINGS_LABELS.notificationDisableSuccess, undefined, 'success');
	} catch {
		// 解除失敗 (サーバー非 2xx 等)。現在状態を取り直して反映し失敗を必ず通知。
		status = await getPushStatus().catch(() => 'unsupported' as PushStatus);
		showToast(SETTINGS_LABELS.notificationDisableFailure, undefined, 'error');
	} finally {
		busy = false;
	}
}
</script>

<svelte:head>
	<title>{SETTINGS_LABELS.groupNotificationsTitle} | {PAGE_TITLES.settings}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<Card padding="lg">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">
			{SETTINGS_LABELS.notificationSectionTitle}
		</h3>

		{#if form?.notificationSuccess}
			<div
				class="rounded-lg bg-[var(--color-feedback-success-bg)] p-3 text-sm text-[var(--color-feedback-success-text)] mb-4"
			>
				{SETTINGS_LABELS.notificationSaved}
			</div>
		{/if}
		{#if form?.notificationError}
			<div
				class="rounded-lg bg-[var(--color-feedback-error-bg)] p-3 text-sm text-[var(--color-feedback-error-text)] mb-4"
			>
				{form.notificationError}
			</div>
		{/if}

		<!-- ブラウザ通知ステータス (#3186: ON/OFF + 異常系のみ。内部状態ジャーゴンを出さず、
		     通知できないとき (非対応/ブロック) はボタンを disabled にして理由を 1 行で示す) -->
		<div
			class="mb-4 p-3 rounded-lg bg-[var(--color-surface-muted)] border border-[var(--color-border-default)]"
			data-testid="notification-browser-status"
		>
			<div class="flex items-center justify-between">
				<span class="text-sm font-medium text-[var(--color-text)]">
					{SETTINGS_LABELS.notificationBrowserLabel}
				</span>
				{#if status === 'on'}
					<span
						class="text-xs px-2 py-1 rounded-full bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]"
						data-testid="notification-status-badge"
					>
						{SETTINGS_LABELS.notificationStatusOn}
					</span>
				{:else if status === 'blocked'}
					<span
						class="text-xs px-2 py-1 rounded-full bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]"
						data-testid="notification-status-badge"
					>
						{SETTINGS_LABELS.notificationStatusBlocked}
					</span>
				{:else if status === 'checking'}
					<span class="text-xs px-2 py-1 rounded-full text-[var(--color-text-muted)]">
						{SETTINGS_LABELS.notificationChecking}
					</span>
				{/if}
			</div>

			{#if status === 'on'}
				<div class="mt-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						loading={busy}
						onclick={disableNotifications}
						data-testid="notification-disable-btn"
					>
						{SETTINGS_LABELS.notificationDisableAction}
					</Button>
				</div>
			{:else if status === 'off'}
				<div class="mt-2">
					<Button
						type="button"
						variant="primary"
						size="sm"
						loading={busy}
						onclick={enableNotifications}
						data-testid="notification-enable-btn"
					>
						{busy
							? SETTINGS_LABELS.notificationEnableActionLoading
							: SETTINGS_LABELS.notificationEnableAction}
					</Button>
				</div>
			{:else if status === 'blocked'}
				<p class="mt-2 text-xs text-[var(--color-text-muted)]" data-testid="notification-blocked-note">
					{SETTINGS_LABELS.notificationBlockedNote}
				</p>
			{:else if status === 'unsupported'}
				<div class="mt-2">
					<Button type="button" variant="primary" size="sm" disabled data-testid="notification-enable-btn">
						{SETTINGS_LABELS.notificationEnableAction}
					</Button>
					<p class="mt-2 text-xs text-[var(--color-text-muted)]" data-testid="notification-unsupported-note">
						{SETTINGS_LABELS.notificationUnsupportedNote}
					</p>
				</div>
			{/if}
		</div>

		<form
			method="POST"
			action="?/updateNotificationSettings"
			use:enhance
			class="space-y-4"
		>
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					name="remindersEnabled"
					checked={data.notificationSettings.remindersEnabled}
					class="h-4 w-4 rounded border-[var(--color-border-strong)]"
				/>
				<span class="text-sm text-[var(--color-text)]">
					{SETTINGS_LABELS.notificationReminderLabel}
				</span>
			</label>
			{#if data.notificationSettings.remindersEnabled}
				<div class="ml-6">
					<FormField
						label="リマインダー時刻"
						type="time"
						name="reminderTime"
						value={data.notificationSettings.reminderTime}
					/>
				</div>
			{/if}
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					name="streakEnabled"
					checked={data.notificationSettings.streakEnabled}
					class="h-4 w-4 rounded border-[var(--color-border-strong)]"
				/>
				<span class="text-sm text-[var(--color-text)]">
					{SETTINGS_LABELS.notificationStreakLabel}
				</span>
			</label>
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					name="achievementsEnabled"
					checked={data.notificationSettings.achievementsEnabled}
					class="h-4 w-4 rounded border-[var(--color-border-strong)]"
				/>
				<span class="text-sm text-[var(--color-text)]">
					{SETTINGS_LABELS.notificationAchievementLabel}
				</span>
			</label>
			<div class="border-t border-[var(--color-border-default)] pt-4 mt-4">
				<FormField label="サイレント時間帯" hint="この時間帯は通知を送信しません">
					{#snippet children()}
						<div class="flex items-center gap-2">
							<input
								type="time"
								name="quietStart"
								value={data.notificationSettings.quietStart}
								class="text-sm border border-[var(--input-border)] rounded-[var(--input-radius)] bg-[var(--input-bg)] px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-[var(--input-border-focus)] transition-colors"
							/>
							<span class="text-sm text-[var(--color-text-muted)]">
								{SETTINGS_LABELS.notificationQuietSeparator}
							</span>
							<input
								type="time"
								name="quietEnd"
								value={data.notificationSettings.quietEnd}
								class="text-sm border border-[var(--input-border)] rounded-[var(--input-radius)] bg-[var(--input-bg)] px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-opacity-30 focus:border-[var(--input-border-focus)] transition-colors"
							/>
						</div>
					{/snippet}
				</FormField>
			</div>
			<Button type="submit" variant="primary" size="md" class="w-full">
				{SETTINGS_LABELS.notificationSaveAction}
			</Button>
		</form>
	</Card>
</div>
