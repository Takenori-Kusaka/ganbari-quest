// src/lib/domain/backup-health.ts
// #4087 (E3 / EPIC #4119) — バックアップ状態を「人間が行動できる 1 つの判定」に落とす純粋関数。
//
// ── なぜ検出と通知を分けて、さらに判定を独立させるのか ────────────────────────
// 2026-07-31 の実害は「検出はできていたが誰にも届かなかった」形だった。backup script は
// fail-closed で毎晩 throw していたが、通知経路が Discord webhook 1 本しかなく、その webhook が
// 未設定だったため **18 日間 alert が 0 通**だった (#4119)。
// 「検出を強くする」だけでは埋まらない穴なので、判定 (本 module) → 通知 / 表示 (呼び出し側) を
// 分離し、**同じ判定を push (Discord) と pull (health / admin 画面) の両方から使う**。
//
// ── push だけでは原理的に足りない ──────────────────────────────────────────
// job の中から投げる通知は **job が起動しなかった場合に発火しない**。2026-07-31 の failure は
// 「起動して落ちた」形だったが、cron 停止 / コンテナ停止 / crontab 消失では 1 通も出ない。
// したがって「最後に成功してから何時間経ったか」= **外から見た鮮度**を一次情報にする。
// consecutiveFailures (#4129 AC4) は「落ち続けている」を、staleness は「動いていない」を捕まえる。
//
// ── しきい値の根拠 ────────────────────────────────────────────────────────
// 日次 03:00 実行 (docker-compose の crond) なので、正常なら最後の成功から最大 24h + 実行時間。
// 26h を超えたら「1 回飛んだ」、50h を超えたら「2 回連続で飛んだ」と読める。
// 1 回飛んだだけで critical にすると、再起動やメンテのたびに狼少年になる (ADR-0012 整合)。

/** 判定の深刻度。UI の色分けと通知の強さを 1 箇所で決める。 */
export type BackupHealthLevel = 'ok' | 'warn' | 'critical';

/** 判定の根拠。**なぜその level になったか**を人間が読める形で持つ (level だけだと行動できない)。 */
export type BackupHealthReason =
	| 'never-succeeded'
	| 'stale-critical'
	| 'stale-warn'
	| 'consecutive-failures-critical'
	| 'last-run-failed'
	| 'rotation-blocked'
	| 'no-notification-channel'
	| 'healthy';

/** 本 module が判定に使う入力。`PgliteBackupStatus` の部分集合 + 通知経路の有無。 */
export interface BackupHealthInput {
	/** 最後に成功した時刻 (ISO 8601)。一度も成功していなければ null。 */
	lastSuccessAt: string | null;
	/** 連続失敗回数 (#4129 AC4)。成功で 0 に戻る。 */
	consecutiveFailures: number;
	/** 直近の失敗メッセージ (表示用、判定には使わない)。 */
	lastFailureMessage: string | null;
	/**
	 * 失敗通知の宛先が 1 つでも設定されているか。
	 *
	 * false = **失敗しても誰にも届かない状態**。これ自体を warn として可視化する
	 * (「通知できないので黙る」を無くす、#4087 AC1)。
	 */
	notificationConfigured: boolean;
	/**
	 * ローテーション guard (#4129 AC2) が止めている世代数。止まっていなければ 0。
	 *
	 * **取得の成否とは独立した事実**である点が本 field の存在理由 (#4162)。guard 発火時は
	 * 「新世代の確定は成功したが、古い世代の削除だけを意図的に止めた」状態で、
	 * **バックアップは毎晩正常に増えている**。これを failure として 1 つの状態に潰すと、
	 * 判定が `stale-critical` (= 「job が動いていない」) に倒れ、**診断が真逆**になる。
	 * 実際に必要な行動は「古い世代を退避して手で削除する」であって job の再起動ではない。
	 */
	rotationPendingCount: number;
}

export interface BackupHealthVerdict {
	level: BackupHealthLevel;
	reason: BackupHealthReason;
	/** 最後の成功からの経過時間 (h)。一度も成功していなければ null。 */
	hoursSinceLastSuccess: number | null;
	consecutiveFailures: number;
	/** 直近の失敗メッセージ (表示用)。 */
	lastFailureMessage: string | null;
	/** 通知経路が無いこと自体の警告。level とは独立に立つ (critical でも同時に出したい)。 */
	notificationMissing: boolean;
	/** ローテーション guard が止めている世代数 (#4162)。0 なら止まっていない。 */
	rotationPendingCount: number;
}

/** 「1 回飛んだ」と読める閾値 (h)。日次 03:00 + 実行時間 + 余裕。 */
export const BACKUP_STALE_WARN_HOURS = 26;
/** 「2 回連続で飛んだ」と読める閾値 (h)。ここまで来たら偶発ではない。 */
export const BACKUP_STALE_CRITICAL_HOURS = 50;
/** 連続失敗が偶発でないと判断する回数。1 回目は warn に留める (再起動時の 1 回で騒がない)。 */
export const BACKUP_CONSECUTIVE_FAILURE_CRITICAL = 2;

/**
 * バックアップ状態から「いま人間が行動すべきか」を判定する。
 *
 * 判定順は **深刻な方から**。stale (動いていない) を failure (落ちている) より先に見るのは、
 * job が起動していない方が気づきにくく、かつ push 通知では捕まらないため。
 *
 * @param input 状態ファイル由来の値 + 通知経路の有無
 * @param now 判定時刻 (テストで固定するための注入点)
 */
export function evaluateBackupHealth(input: BackupHealthInput, now: Date): BackupHealthVerdict {
	const hoursSinceLastSuccess =
		input.lastSuccessAt === null
			? null
			: (now.getTime() - new Date(input.lastSuccessAt).getTime()) / 3_600_000;

	const base = {
		hoursSinceLastSuccess,
		consecutiveFailures: input.consecutiveFailures,
		lastFailureMessage: input.lastFailureMessage,
		notificationMissing: !input.notificationConfigured,
		rotationPendingCount: input.rotationPendingCount,
	};

	// 一度も成功していない = 「バックアップがある」と言えない状態。
	// 2026-07-12 の cutover 以降、実際にこの状態が 18 日続いた (#4119)。
	if (hoursSinceLastSuccess === null) {
		return { ...base, level: 'critical', reason: 'never-succeeded' };
	}

	if (hoursSinceLastSuccess >= BACKUP_STALE_CRITICAL_HOURS) {
		return { ...base, level: 'critical', reason: 'stale-critical' };
	}

	if (input.consecutiveFailures >= BACKUP_CONSECUTIVE_FAILURE_CRITICAL) {
		return { ...base, level: 'critical', reason: 'consecutive-failures-critical' };
	}

	if (hoursSinceLastSuccess >= BACKUP_STALE_WARN_HOURS) {
		return { ...base, level: 'warn', reason: 'stale-warn' };
	}

	if (input.consecutiveFailures > 0) {
		return { ...base, level: 'warn', reason: 'last-run-failed' };
	}

	// #4162: ローテーションだけが止まっている状態。**取得は成功し続けている**ので
	// critical ではなく warn。stale / consecutive-failures より後に見るのは、
	// 「取れていない」方が常に重いため (取れているが片付いていない、は次に重い)。
	//
	// guard は自己解除しない — 溢れは毎晩 1 ずつ増えるので、人が退避して手で削除するまで続く。
	// したがってこの warn は「放置すれば消える」類ではなく、**行動を促すもの**である。
	if (input.rotationPendingCount > 0) {
		return { ...base, level: 'warn', reason: 'rotation-blocked' };
	}

	// 直近は成功しているが、次に失敗したとき誰にも届かない状態。
	// 「今は取れている」と「壊れたら気づける」は別なので、後者が欠けていることを warn で出す。
	if (!input.notificationConfigured) {
		return { ...base, level: 'warn', reason: 'no-notification-channel' };
	}

	return { ...base, level: 'ok', reason: 'healthy' };
}

/**
 * 失敗通知の宛先が 1 つでも設定されているかを env から判定する (#4087 AC1)。
 *
 * 判定を 1 箇所に置くのは、`scripts/backup-nuc.cjs` (通知を送る側) と `/api/health` /
 * admin 画面 (通知経路の有無を表示する側) で **同じ env 名の集合**を見るため。
 * 片方だけ増やすと「送れているのに『届かない』と出る」逆の嘘が生まれる。
 *
 * 名前は `backup-nuc.cjs` の DISCORD_WEBHOOK 解決と一致させること。
 */
export function isBackupNotificationConfigured(env: {
	DISCORD_ALERT_WEBHOOK_URL?: string;
	DISCORD_WEBHOOK_INCIDENT?: string;
}): boolean {
	return Boolean(env.DISCORD_ALERT_WEBHOOK_URL || env.DISCORD_WEBHOOK_INCIDENT);
}
