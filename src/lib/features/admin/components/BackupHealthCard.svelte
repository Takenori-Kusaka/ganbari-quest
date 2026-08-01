<script lang="ts">
// #4087 (E3 / EPIC #4119) — バックアップ状態を家族 (非エンジニア) に見せるカード。
//
// ## なぜ component に切り出すか
//
// 表示条件が `DATA_SOURCE=pglite` かつ backup status file 存在で、**SS 撮影に使う demo 環境
// (`DATA_SOURCE=demo`) では原理的に描画されない**。page に直書きすると 3 状態 (ok / warn /
// critical) の見た目を誰も確認できないまま入ることになる。component 単体なら Storybook で
// 3 状態とも描画でき、demo 環境に依存しない (PO 決裁 2026-08-01)。
//
// ## 表示方針 (ADR-0012 anti-engagement)
//
// 常時表示の煽りにはせず、設定画面内の静的表示に留める。**子供画面には一切出さない。**
// 判定そのものは `$lib/domain/backup-health.ts` (純粋関数) が持ち、本 component は描画のみ。

import type { BackupHealthVerdict } from '$lib/domain/backup-health';
import { formatCount, SETTINGS_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

interface Props {
	health: BackupHealthVerdict;
}

let { health }: Props = $props();

// server は判定結果だけを渡すので、表示用の日時は経過時間から復元する。
// (server 側で文字列整形すると TZ が server 依存になり、#4015 のローカル TZ 事故と同型になる)
const lastSuccessDisplay = $derived(
	health.hoursSinceLastSuccess == null
		? null
		: new Date(Date.now() - health.hoursSinceLastSuccess * 3_600_000).toLocaleString('ja-JP'),
);
</script>

<Card padding="lg">
	<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">
		{SETTINGS_LABELS.backupSectionTitle}
	</h3>
	<div data-testid="backup-health" data-level={health.level}>
		{#if health.level === 'ok'}
			<Alert variant="success" message={SETTINGS_LABELS.backupOkTitle} />
		{:else if health.level === 'warn'}
			<Alert variant="warning" message={SETTINGS_LABELS.backupWarnTitle} />
		{:else}
			<Alert variant="danger" message={SETTINGS_LABELS.backupCriticalTitle} />
		{/if}

		<ul class="mt-3 space-y-1 text-sm text-[var(--color-text-muted)]">
			<li>
				{SETTINGS_LABELS.backupLastSuccessLabel}{lastSuccessDisplay === null
					? SETTINGS_LABELS.backupNeverSucceeded
					: lastSuccessDisplay}
			</li>
			{#if health.consecutiveFailures > 0}
				<li>
					{SETTINGS_LABELS.backupConsecutiveFailuresLabel}{formatCount(health.consecutiveFailures)}
				</li>
			{/if}
			<!-- level と独立に出す: critical のときも「届かない」ことは対処が変わるため (#4087 AC1) -->
			{#if health.notificationMissing}
				<li class="text-[var(--color-feedback-warning-text)]">
					{SETTINGS_LABELS.backupNotificationMissing}
				</li>
			{/if}
		</ul>

		{#if health.level !== 'ok'}
			<p class="mt-3 text-sm text-[var(--color-text-muted)]">
				<!--
					#4162: ローテーション保留だけのときは専用文言を出す。汎用の「相談してください」
					だけだと必要な行動が分からず「job が壊れた」と読まれてしまう。

					reason を直接表示するのではなく reason に応じた固定文を選ぶ形は維持する
					(内部 enum を家族向け UI に露出させない)。#4153 の QM 申し送りが懸念していた
					「取得は成功しているのに critical」の混在自体が本 Issue で解消済み。
				-->
				{health.reason === 'rotation-blocked'
					? SETTINGS_LABELS.backupRotationBlockedHint
					: SETTINGS_LABELS.backupActionHint}
			</p>
		{/if}
	</div>
</Card>
