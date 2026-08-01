// #3970 (E3 / EPIC #4119) — 「off-site に置いたつもり」が実際には NUC 内だった、を検出する。
//
// ## 塞ぐ穴
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
// ## なぜ「別デバイスか」で判定しないのか (初版からの設計変更)
//
// 初版は保存先と稼働中 DB の `fs.stat().dev` を比較していた。**本番 NUC は Windows 上の
// Docker で、bind mount は仮想ファイルシステム層を経由する**。そこで報告される device id が
// ホスト側の物理デバイスの違いを反映する保証は無く、
//
//   - 両 bind が同一の仮想 FS 由来なら → NAS が正常でも毎晩 critical (誤報)
//   - bind ごとに別 device が振られるなら → NAS 断のローカル fallback も「別デバイス」で ok (不発)
//
// のどちらかになる。**どちらでも検出器として価値が無い**。実機で確かめずに入れれば
// 「入れたから安全になった」という前進の錯覚を作る (#4159 adversarial review business 軸)。
//
// ## 代わりに見るもの: 退避先に置いた目印が見えているか
//
// 運用者が退避先を用意するとき、そこに **目印ファイルを 1 つ置く** (`OFFSITE_MARKER_FILENAME`)。
// 検査はバックアップ後に「保存先からその目印が読めるか」だけを見る。
//
//   - 正しくマウントされている  → 目印が読める        → ok
//   - マウントが外れて Docker が空ディレクトリを作った → 目印が無い → critical
//   - 別のディレクトリを掴んでいる                     → 目印が無い → critical
//
// **仮想 FS の device 意味論に一切依存しない**。かつ「差し替えたつもりが別物」も同時に捕まえる。
// 運用者の手間は退避先を作るときの 1 コマンドだけで、`HOST_BACKUP_DIR` を設定する同じ作業に含まれる。

/** 退避先に置く目印のファイル名。運用者が退避先を用意するときに作る。 */
export const OFFSITE_MARKER_FILENAME = '.ganbari-offsite';

/** off-site 判定に必要な、実ファイルシステムから読んだ事実。 */
export interface OffsiteProbe {
	/** off-site 複製を期待しているか (退避先を設定しているか)。 */
	expected: boolean;
	/**
	 * 保存先にある目印ファイルの中身。
	 *
	 * - `string` — 読めた (空文字も含む)
	 * - `null`   — 存在しない = **マウントされていない疑い**
	 * - `'unreadable'` — 存在するが読めない (権限 / I/O エラー) = 判定不能
	 */
	marker: string | null | 'unreadable';
}

export type OffsiteVerdict =
	/** off-site を期待していない。判定対象外 (警告しない)。 */
	| { level: 'not-expected' }
	/** 目印が読めた。退避先が正しくマウントされている。 */
	| { level: 'ok' }
	/** 目印を読めず判定できない。「問題なし」には丸めない。 */
	| { level: 'unknown'; reason: 'marker-unreadable' }
	/** 目印が無い = 退避先が見えていない。**筐体の喪失で控えごと全損する**。 */
	| { level: 'critical'; reason: 'marker-missing' };

/**
 * 退避先が実際に見えているかを判定する。
 *
 * 取得 (dump) の成否とは独立した検査である点が重要 — **取得は成功しているのに
 * 控えが NUC 内にしか無い**、という状態こそが本関数の検出対象。
 */
export function judgeOffsiteReplication(probe: OffsiteProbe): OffsiteVerdict {
	if (!probe.expected) return { level: 'not-expected' };
	if (probe.marker === 'unreadable') return { level: 'unknown', reason: 'marker-unreadable' };
	if (probe.marker === null) return { level: 'critical', reason: 'marker-missing' };
	return { level: 'ok' };
}

/**
 * 判定結果を運用者向けの文面にする。
 *
 * **受け手は非エンジニアの家族**なので、内部の変数名やファイルパスを主語にしない。
 * 「何が起きているか」「何をすればよいか」を日常語で書く (#4159 adversarial review UX 軸)。
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
				'バックアップの控えを置く場所を確認できませんでした。' +
				'バックアップ自体は取れています。' +
				'外付けディスクや NAS が読み取り専用になっていないかを確認してください。'
			);
		case 'critical':
			return (
				'バックアップの控えが、指定した保管場所に届いていません。' +
				'バックアップ自体は取れていますが、**いまは本体の中にしか控えがありません**。' +
				'この状態でこの機械が壊れると、記録も控えも一緒に失われます。' +
				'外付けディスクや NAS の電源・接続を確認して、つなぎ直してから本体を再起動してください。'
			);
	}
}

/**
 * 前回と同じ判定なら通知しない (毎晩同じ警告を投げない)。
 *
 * 同じ警告が毎晩届くと数日で無視され、**同じ通知先を共有している本物の失敗 alert
 * (#4129 / #4087) まで一緒に見られなくなる** (#4159 adversarial review UX 軸)。
 * 状態が変わったときだけ通知する。
 */
export function shouldNotifyOffsite(
	current: OffsiteVerdict,
	previousLevel: OffsiteVerdict['level'] | null,
): boolean {
	if (current.level === 'not-expected' || current.level === 'ok') return false;
	return current.level !== previousLevel;
}
