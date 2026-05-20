<script lang="ts">
// #2320 (EPIC #2319 ①): notifications グループ — notification 1 section のみ。
// 旧 /admin/settings/+page.svelte 行 929 を移行。
// data-notif-* attribute 経由のクライアントスクリプトも同梱。

import { onMount } from 'svelte';
import { enhance } from '$app/forms';
import { APP_LABELS, PAGE_TITLES, SETTINGS_LABELS } from '$lib/domain/labels';
import { initNotificationStatusUi } from '$lib/features/admin/notification-status-ui';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { data, form } = $props();

// 通知ステータス UI 制御 (data-notif-* 属性経由でラベル読込)
onMount(() => {
	initNotificationStatusUi();
});
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

		<!-- ブラウザ通知ステータス -->
		<div
			class="mb-4 p-3 rounded-lg bg-[var(--color-surface-muted)] border border-[var(--color-border-default)]"
			data-notif-unsupported={SETTINGS_LABELS.notificationBrowserLabel}
			data-notif-blocked="ブロック中（ブラウザ設定で変更）"
			data-notif-unset="未設定"
			data-notif-active="有効"
			data-notif-inactive="無効"
			data-notif-pending="許可済み（未登録）"
			data-notif-device-unsupported="この端末は通知に対応していません"
		>
			<div class="flex items-center justify-between">
				<span class="text-sm font-medium text-[var(--color-text)]">
					{SETTINGS_LABELS.notificationBrowserLabel}
				</span>
				<span
					class="text-xs px-2 py-1 rounded-full"
					id="notification-status">{SETTINGS_LABELS.notificationChecking}</span
				>
			</div>
			<div id="notification-action" class="mt-2 hidden">
				<Button type="button" variant="primary" size="sm" id="notification-subscribe-btn">
					{SETTINGS_LABELS.notificationEnableAction}
				</Button>
			</div>
			<div id="notification-subscribed" class="mt-2 hidden">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="bg-[var(--color-neutral-200)] text-[var(--color-text)] hover:bg-[var(--color-neutral-300)]"
					id="notification-unsubscribe-btn"
				>
					{SETTINGS_LABELS.notificationDisableAction}
				</Button>
			</div>
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
