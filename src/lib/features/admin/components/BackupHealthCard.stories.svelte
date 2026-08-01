<script module lang="ts">
// #4087 — バックアップ状態カードの 3 状態を Storybook で確認可能にする。
//
// 本 component の表示条件は `DATA_SOURCE=pglite` かつ backup status file 存在で、
// **SS 撮影に使う demo 環境 (`DATA_SOURCE=demo`) では原理的に描画されない**。
// Storybook なら component 単体で描画できるため、3 状態の見た目を誰も確認できないまま
// merge される事態を避けられる (PO 決裁 2026-08-01)。
import { defineMeta } from '@storybook/addon-svelte-csf';
import type { BackupHealthVerdict } from '$lib/domain/backup-health';
import BackupHealthCard from './BackupHealthCard.svelte';

const { Story } = defineMeta({
	title: 'Features/Admin/BackupHealthCard',
	component: BackupHealthCard,
	tags: ['autodocs'],
});

/** 正常時。直近成功 + 失敗 0 + 通知経路あり。 */
const OK: BackupHealthVerdict = {
	level: 'ok',
	reason: 'healthy',
	hoursSinceLastSuccess: 3,
	consecutiveFailures: 0,
	lastFailureMessage: null,
	notificationMissing: false,
	rotationPendingCount: 0,
};

/** 通知経路が無いだけの warn。**取れてはいるが、壊れても届かない**状態 (#4087 AC1)。 */
const WARN_NO_CHANNEL: BackupHealthVerdict = {
	level: 'warn',
	reason: 'no-notification-channel',
	hoursSinceLastSuccess: 5,
	consecutiveFailures: 0,
	lastFailureMessage: null,
	notificationMissing: true,
	rotationPendingCount: 0,
};

/**
 * 2026-07-31 の実害と同じ状態 (#4119)。
 * cutover 以降 1 度も成功せず、18 晩連続で失敗し、通知経路も無かった。
 */
const CRITICAL_REAL_INCIDENT: BackupHealthVerdict = {
	level: 'critical',
	reason: 'never-succeeded',
	hoursSinceLastSuccess: null,
	consecutiveFailures: 18,
	lastFailureMessage: 'CRON_SECRET が未設定です (/api/cron/pglite-backup の認証に必要)',
	notificationMissing: true,
	rotationPendingCount: 0,
};

/** ジョブが起動しなかったケース。**失敗 0 回でも成功が古ければ critical** (#4087 AC3)。 */
const CRITICAL_STALE: BackupHealthVerdict = {
	level: 'critical',
	reason: 'stale-critical',
	hoursSinceLastSuccess: 72,
	consecutiveFailures: 0,
	lastFailureMessage: null,
	notificationMissing: false,
	rotationPendingCount: 0,
};
/**
 * ローテーションだけが止まっている状態 (#4162)。
 * **取得は成功し続けている**ので critical ではなく warn。必要な行動は
 * 「古い控えを移して消す」であり、job の再起動ではない。
 */
const WARN_ROTATION_BLOCKED: BackupHealthVerdict = {
	level: 'warn',
	reason: 'rotation-blocked',
	hoursSinceLastSuccess: 4,
	consecutiveFailures: 0,
	lastFailureMessage: null,
	notificationMissing: false,
	rotationPendingCount: 4,
};
/**
 * 7 晩放置して昇格した状態 (#4162)。**取得は成功し続けている**ので
 * 「バックアップが取れていません」とは出さない。放置の危険だけを足す。
 */
const CRITICAL_ROTATION_BLOCKED: BackupHealthVerdict = {
	level: 'critical',
	reason: 'rotation-blocked-critical',
	hoursSinceLastSuccess: 4,
	consecutiveFailures: 0,
	lastFailureMessage: null,
	notificationMissing: false,
	rotationPendingCount: 9,
};
</script>

<Story name="Ok" args={{ health: OK }} />
<Story name="WarnNoNotificationChannel" args={{ health: WARN_NO_CHANNEL }} />
<Story name="CriticalNeverSucceeded" args={{ health: CRITICAL_REAL_INCIDENT }} />
<Story name="CriticalStale" args={{ health: CRITICAL_STALE }} />
<Story name="WarnRotationBlocked" args={{ health: WARN_ROTATION_BLOCKED }} />
<Story name="CriticalRotationBlocked" args={{ health: CRITICAL_ROTATION_BLOCKED }} />

<Story name="AllStates">
	<div class="flex flex-col gap-4">
		<BackupHealthCard health={OK} />
		<BackupHealthCard health={WARN_NO_CHANNEL} />
		<BackupHealthCard health={CRITICAL_REAL_INCIDENT} />
		<BackupHealthCard health={CRITICAL_STALE} />
		<BackupHealthCard health={WARN_ROTATION_BLOCKED} />
		<BackupHealthCard health={CRITICAL_ROTATION_BLOCKED} />
	</div>
</Story>
