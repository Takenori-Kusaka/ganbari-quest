/**
 * ストレージ key / メッセージから秘密 (クラウド共有 export の PIN) を伏せる — ログ・例外・
 * DB の failureReason・顧客画面へ出す文言のすべてで使う。
 *
 * ## なぜ domain に置くか
 *
 * PIN を含む文字列を外へ出しうる場所が **service 層・repo 層・route 層のすべて**にある。
 * 1 箇所に置いて全部から使う (#4867 adversarial 実測: service だけ直しても repo 層と
 * 退会経路と build 失敗経路から漏れていた)。
 *
 * ## 何を守るか
 *
 * クラウド共有 export の key は `exports/<tenantId>/<pinCode>/<file>` で **PIN をそのまま
 * 含む**。この PIN は他家庭のフル PII バックアップ (子供の氏名・生年月日・顔写真・音声を
 * 含む ZIP) を引き当てる唯一の材料で、`fetchCloudExportByPin` は **tenant 述語なしで**引く。
 *
 * ## 伏せるのは PIN だけ — テナントは残す
 *
 * 初版は `exports` セグメント以降を全部伏せたため、出力が
 * `exports/<redacted>/<redacted>/backup.zip` の **2 定数のいずれか**にしかならず、
 * 「どの家庭のどの成果物か」を運用が追えなくなった (#4767 が「消せていない実体が残ったことを
 * 必ず記録する」ためにログを足した目的を失う)。**PIN の位置だけを伏せ、テナントと file 名は残す。**
 */

/** PIN の文字種・長さ (`cloud-export-service` の `PIN_CHARS` / `PIN_LENGTH` と対応)。 */
const PIN_LIKE = '[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}';
const PIN_LIKE_SEGMENT = new RegExp(`^${PIN_LIKE}$`);
/** 文中に裸で現れる PIN (前後が英数でないこと)。 */
const BARE_PIN = new RegExp(`(?<![A-Za-z0-9])${PIN_LIKE}(?![A-Za-z0-9])`, 'g');

/** 伏せたことが読み手に分かる置換文字列 (空にすると「元から無い」と区別できない)。 */
const REDACTED = '<pin>';

/**
 * ストレージ key をログ・例外メッセージ・顧客文言へ出す前に必ず通す。
 *
 * - `exports/<tenant>/<pin>/…` の **pin の位置**を伏せる (tenant と file 名は残す)
 * - key のどこにあっても **PIN の形をしたセグメント**は伏せる (`exports/<pin>` 等、
 *   想定外の形で素通りさせない = fail-closed)
 * - ただし `tenants/<id>/…` の id 位置は伏せない (無関係な key の誤爆を避ける)
 * - `/` と `\\` の両方を区切りとして扱う (Windows / NUC の local FS エラー対策)
 * - 空文字・想定外の形でも例外を投げない (ログ経路で throw しない)
 */
export function redactStorageKey(key: string): string {
	if (!key) return key;
	// `/` と `\` の両方を区切りとして扱う (Windows / NUC の local FS エラーは `\` で来る)
	const segments = key.split(/[/\\]/);
	const tenantsAt = segments.indexOf('tenants');

	const redacted = segments.map((seg, i) => {
		if (!seg) return seg;
		// `tenants/<id>` の id は伏せない (無関係な key の誤爆を避ける)
		if (tenantsAt >= 0 && i === tenantsAt + 1) return seg;
		// PIN は生成規則上かならずこの文字種・長さなので、**形で拾えば位置に依存しない**。
		// 位置で決め打ちすると `exports/<tenant>/<pin>/<file>` 以外の形 (`exports/<pin>` /
		// `tenants/<t>/exports/<pin>/<file>`) で外したり、file 名を誤爆したりする。
		if (PIN_LIKE_SEGMENT.test(seg)) return REDACTED;
		return seg;
	});

	// 区切り文字は元の並びを保って戻す
	let out = '';
	let si = 0;
	for (let i = 0; i < key.length; i++) {
		const ch = key[i] as string;
		if (ch === '/' || ch === '\\') {
			out += (redacted[si] ?? '') + ch;
			si++;
		}
	}
	out += redacted[si] ?? '';
	return out;
}

/**
 * key を含みうる**任意の文字列**を伏せる (S3 の部分失敗サマリ / 例外 message /
 * DB の failureReason / 顧客画面に出す文言)。
 *
 * path 形になっていない**裸の PIN** も伏せる — 実測で `pin K7M2QX not found` のような
 * message が現に出る経路があり、path だけを見ていると素通りする。
 */
export function redactStorageKeysInText(text: string): string {
	if (!text) return text;
	const withKeys = text.replace(/(?:[\w.-]+[/\\])*exports[/\\][^\s,'")]*/g, (m) =>
		redactStorageKey(m),
	);
	return withKeys.replace(BARE_PIN, REDACTED);
}
