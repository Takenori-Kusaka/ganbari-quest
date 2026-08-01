// #3970 (E3 / EPIC #4119) — 「off-site に置いたつもり」が実際には NUC 内だった、を検出する。
//
// ## なぜ必要か
//
// off-site 化は `HOST_BACKUP_DIR` で **compose の bind mount 先を差し替える**方式で行う
// (#4149)。この方式には静かな失敗経路がある:
//
//   NAS がダウンしている / マウントが外れている状態で compose を上げると、Docker は
//   **その path にローカルの空ディレクトリを作って** bind する。書き込みは成功し、
//   バックアップは「取れた」と記録され、**NUC の中にしか控えが無い状態が無音で続く**。
//
// これは #3950 (「毎晩成功していたが実際は更新の止まった SQLite を 18 回コピーしていた」) と
// **同型の事故が一段上の粒度で再発した**ものになる。取得の成否だけを見ていると気づけない。
//
// ## 何を見て判定するか
//
// **保存先が稼働中 DB と同じファイルシステム上にあるか** (`fs.stat().dev` の一致) を見る。
// 別筐体 / NAS / 外付けメディアであれば device が異なる。同一なら「差し替えたつもりが
// ローカルに落ちている」か「そもそも差し替えていない」かのどちらかで、いずれも
// **筐体の喪失で控えごと全損する**という同じ結末になる。
//
// device 比較にしたのは、path 文字列の見た目 (`/mnt/nas/...`) が当てにならないため。
// 上記の fallback ではまさに「NAS らしい path なのに実体はローカル」になる。
//
// ## 期待していない家庭を警告しない
//
// off-site を運用しない家庭 (ローカル 1 箇所を受容する選択、#3970 の「受容する場合」) まで
// 警告すると、警告が常態化して読まれなくなる。**off-site を期待している場合のみ**判定する。

/** off-site 判定に必要な、実ファイルシステムから読んだ事実。 */
export interface OffsiteProbe {
	/** off-site 複製を期待しているか (HOST_BACKUP_DIR 相当の設定があるか)。 */
	expected: boolean;
	/** バックアップ保存先の filesystem device id。取得できなければ null。 */
	backupDeviceId: number | null;
	/** 稼働中 DB (PGDATA) の filesystem device id。取得できなければ null。 */
	liveDataDeviceId: number | null;
}

export type OffsiteVerdict =
	/** off-site を期待していない。判定対象外 (警告しない)。 */
	| { level: 'not-expected' }
	/** 保存先が稼働中 DB と別デバイス上にある。期待どおり。 */
	| { level: 'ok' }
	/** device を読めず判定できない。取得の成否とは別に、判定不能である事実を伝える。 */
	| { level: 'unknown'; reason: 'device-unreadable' }
	/** off-site のはずが稼働中 DB と同一デバイス上にある。**筐体の喪失で全損する**。 */
	| { level: 'critical'; reason: 'same-filesystem-as-live-data' };

/**
 * off-site 複製が実際に NUC 外へ出ているかを判定する。
 *
 * 取得 (dump) の成否とは独立した検査である点が重要 — **取得は成功しているのに
 * 控えが NUC 内にしか無い**、という状態こそが本関数の検出対象。
 */
export function judgeOffsiteReplication(probe: OffsiteProbe): OffsiteVerdict {
	if (!probe.expected) return { level: 'not-expected' };

	if (probe.backupDeviceId === null || probe.liveDataDeviceId === null) {
		return { level: 'unknown', reason: 'device-unreadable' };
	}

	if (probe.backupDeviceId === probe.liveDataDeviceId) {
		return { level: 'critical', reason: 'same-filesystem-as-live-data' };
	}

	return { level: 'ok' };
}

/**
 * 判定結果を運用者向けの 1 行にする。alert / log に同じ文言を使う。
 *
 * `null` を返すのは「伝えることが無い」場合のみ (対象外 / 期待どおり)。
 */
export function describeOffsiteVerdict(verdict: OffsiteVerdict): string | null {
	switch (verdict.level) {
		case 'not-expected':
		case 'ok':
			return null;
		case 'unknown':
			return (
				'[pglite-backup] off-site 複製の確認ができませんでした ' +
				'(保存先または稼働中 DB のファイルシステム情報を読めません)。' +
				'バックアップの取得自体は成功しています。'
			);
		case 'critical':
			return (
				'[pglite-backup] off-site を設定していますが、保存先が稼働中 DB と同じ ' +
				'ファイルシステム上にあります。**この筐体を失うと控えごと全損します**。' +
				'マウントが外れている状態で起動すると、Docker がその path にローカルの空 ' +
				'ディレクトリを作り、書き込みが成功してしまいます (HOST_BACKUP_DIR の指す先が ' +
				'マウントされているかを確認してください)。なおバックアップの取得自体は成功しています。'
			);
	}
}
