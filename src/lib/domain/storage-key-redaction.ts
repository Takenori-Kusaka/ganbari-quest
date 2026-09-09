/**
 * ストレージ key から秘密 (クラウド共有 export の PIN) を伏せる — ログ・例外メッセージ用。
 *
 * ## なぜ domain に置くか
 *
 * PIN を含む key を外へ出しうる場所が **service 層と repo 層の両方**にあるため。
 * service (`cloud-export-service`) だけに置くと、repo (`s3/storage-repo`) が生 key を
 * ログに出す経路が閉じない — 実際そうなっていた (#4867 adversarial 実測)。
 * key の形についての純粋な文字列関数なので、両方から import できる domain に置く。
 *
 * ## 何を守るか
 *
 * クラウド共有 export の key は `exports/<tenantId>/<pinCode>/<file>` で、**PIN をそのまま
 * 含む**。この PIN は他家庭のフル PII バックアップ (子供の氏名・生年月日・顔写真・音声を
 * 含む ZIP) を引き当てる唯一の材料で、`fetchCloudExportByPin` は **tenant 述語なしで**引く。
 * 本番の logger は CloudWatch へ出るため、ログ閲覧権限が「他家庭の PII を落とせる」に化ける。
 *
 * ## 方針は fail-closed
 *
 * 「決まった形に一致したときだけ伏せる」実装は、想定外の形で素通りする (初版がこれで、
 * `exports/<pin>` や `tenants/<t>/exports/<pin>/...` が漏れた)。本実装は逆に、
 * **`exports` セグメント以降は原則すべて伏せ**、末尾の file 名だけ残す。
 * 加えて PIN の文字種・長さに一致するセグメントは、key のどこにあっても伏せる。
 *
 * tenantId まで伏せるのは意図的。呼び出し側は tenantId を**別のフィールド**として持って
 * いるので、key から失っても運用は困らない (むしろ key に混ぜないほうが安全)。
 */

/** PIN の文字種・長さ (`cloud-export-service` の `PIN_CHARS` / `PIN_LENGTH` と対応)。 */
const PIN_LIKE_SEGMENT = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

/** 伏せたことが読み手に分かる置換文字列 (空にすると「元から無い」と区別できない)。 */
const REDACTED = '<redacted>';

/**
 * ストレージ key をログ・例外メッセージへ出す前に必ず通す。
 *
 * - `exports/...` 配下は、末尾の file 名を除いて伏せる (PIN がどのセグメントに居ても閉じる)
 * - それ以外の key でも、PIN と同じ文字種・長さのセグメントは伏せる
 * - 空文字・想定外の形でも例外を投げない (ログ経路で throw しない)
 */
export function redactStorageKey(key: string): string {
	if (!key) return key;
	const segments = key.split('/');
	const exportsAt = segments.indexOf('exports');
	const lastIndex = segments.length - 1;
	const hasFilename = (segments[lastIndex] ?? '').includes('.');

	return segments
		.map((seg, i) => {
			if (!seg) return seg;
			// `exports` 以降は原則すべて伏せる (末尾の file 名だけ残す)
			if (exportsAt >= 0 && i > exportsAt && !(hasFilename && i === lastIndex)) {
				return REDACTED;
			}
			// key のどこであっても PIN の形をしたセグメントは伏せる
			if (PIN_LIKE_SEGMENT.test(seg)) return REDACTED;
			return seg;
		})
		.join('/');
}

/** 複数 key を含みうる文字列 (S3 の部分失敗サマリ等) を伏せる。 */
export function redactStorageKeysInText(text: string): string {
	if (!text) return text;
	// `exports/…` で始まる連続部分 (区切りは空白 / カンマ / 引用符 / 閉じ括弧) を key とみなす
	return text.replace(/(?:[\w.-]+\/)*exports\/[^\s,'")]*/g, (m) => redactStorageKey(m));
}
