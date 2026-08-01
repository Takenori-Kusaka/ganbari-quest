// src/lib/server/notify-privacy.ts
//
// 運用者向け外部通知 (Discord) の payload から**顧客識別子**を落とす単一強制点 (#4174 Q3 / #4192)。
//
// ## なぜ要るか
//
// Discord は運用者の機器ではなく外部 SaaS で、embed は**チャットログとして永続化**される。
// `#3971` (バックアップを暗号化しない) の前提は「控えは運用者自身の機器内に留まる」であり、
// その前提は通知には成り立たない。したがって通知に載せてよいものを次のとおり分ける:
//
// | 載せてよい | 載せない |
// |---|---|
// | 事象の種別 / 発生時刻 / 件数 / エラー種別 / 環境名 / job 名 | tenantId / childId / メールアドレス / 家族名 |
// | requestId (ログを引くための鍵。顧客識別子ではない) | 顧客データそのもの (活動名 / ごほうび名 等) |
//
// 「どの家族に起きたか」は **認証された場所 (CloudWatch Logs / DB) で requestId から引く**。
// 通知は「起きた」を伝えるのが役割で、「誰に起きた」を伝える役割は持たない。
//
// ## どこで効かせるか
//
// **呼び出し側ではなく送出側で redact する** (単一強制点)。callsite ごとの注意に依存すると、
// 新しい alert が 1 つ増えるたびに漏れる。`discord-alert.ts` / `discord-notify-service.ts` の
// embed 組み立てが本 module を必ず通る。
//
// ## 残る穴 (accepted residual、ADR-0061)
//
// 自由記述 (error message / stack) に**日本語の氏名や活動名がそのまま含まれる**場合、機械的には
// 検出できない (任意の日本語文字列と区別が付かない)。本 module が落とせるのは
// email / 電話 / カード / UUID / 長い数字列 / URL path 中の id といった**形が決まっているもの**まで。
// したがって embed に載せる field は「こちらが決めた項目だけ」に閉じ、
// 顧客データを field 名で足さない設計 (`buildAlertEmbed` / `buildIncidentEmbed`) を併用する。

import { redactPii } from '$lib/server/stripe/pii-redaction';

/** 顧客識別子を落とした跡に残すマーカー。 */
export const NOTIFY_REDACTION_MARKERS = {
	/** UUID (tenantId / childId / activityId 等の内部 id) */
	ID: '<ID_REDACTED>',
	/** URL path 中の可変セグメント */
	PATH_SEGMENT: ':id',
} as const;

/** UUID v1-v8 (ハイフン区切り 8-4-4-4-12)。tenantId / childId の実体。 */
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * URL path の可変セグメント判定。
 *
 * - UUID
 * - 数値のみ (childId / tenantId の legacy 数値 id、`/children/903` 等)
 * - 20 文字以上の id 風 token (cuid / nanoid / base64url)
 *
 * ルート名 (`admin` / `children` / `api` / `v1`) は残す。**どの画面で落ちたか**は triage に要り、
 * かつ顧客識別子ではない。
 */
function isVariablePathSegment(segment: string): boolean {
	if (segment.length === 0) return false;
	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
	if (/^\d+$/.test(segment)) return true;
	if (segment.length >= 20 && /^[A-Za-z0-9_-]+$/.test(segment)) return true;
	return false;
}

/**
 * URL path から可変セグメント (id) を落とす。
 *
 * @example
 *   redactPathIds('/api/v1/admin/children/903')
 *   // => '/api/v1/admin/children/:id'
 */
export function redactPathIds(path: string | undefined): string | undefined {
	if (path === undefined || path === '') return path;
	// query string は落とす (`?childId=903` 等が丸ごと顧客識別子になりうるため、値だけでなく全体を捨てる)
	const [pathname] = path.split('?');
	if (pathname === undefined) return path;
	return pathname
		.split('/')
		.map((segment) =>
			isVariablePathSegment(segment) ? NOTIFY_REDACTION_MARKERS.PATH_SEGMENT : segment,
		)
		.join('/');
}

/**
 * 通知に載せる自由記述テキスト (message / errorSummary / stack) から顧客識別子を落とす。
 *
 * - email / 電話番号 / カード番号 → `redactPii` (#2738 / #2749 で bypass 3 種対応済) に委譲する
 * - UUID (tenantId / childId 等) → `<ID_REDACTED>`
 * - 文中に現れる URL path の id → `:id`
 *
 * `redactPii` は Stripe 領域で書かれたが中身は汎用 (email / phone / card)。同じ判定を 2 本持つと
 * 片方だけ強化されて穴が空くため、**新規実装せず再利用する** (ADR-0014 / #1350)。
 */
export function redactNotificationText(text: string | undefined): string | undefined {
	if (text === undefined || text === '') return text;
	const withoutPii = redactPii(text);
	const withoutIds = withoutPii.replace(UUID_PATTERN, NOTIFY_REDACTION_MARKERS.ID);
	// 文中の `/api/v1/admin/children/903` 等も落とす (path 単体 field 以外の混入経路)。
	//
	// **URL path に見えるものだけ**を対象にする。`attempt 2/3` や `1/2 完了` のような
	// 通常文の分数を path とみなして `2/:id` に潰すと、triage 情報を壊す (実測で踏んだ)。
	//   - 直前が英数字でない (= 語の途中の `/` を拾わない)
	//   - `/` を 2 つ以上含む (= 単一の区切り記号ではなく階層を持つ)
	return withoutIds.replace(IN_TEXT_PATH_PATTERN, (match, prefix: string, path: string) => {
		if ((path.match(/\//g) ?? []).length < 2) return match;
		return `${prefix}${redactPathIds(path) ?? path}`;
	});
}

/**
 * 文中の URL path 候補。`prefix` は直前の 1 文字 (英数字でないこと) を捕捉して戻すための group。
 * lookbehind を使わないのは、対象 runtime (Node / workerd) 差を持ち込まないため。
 */
const IN_TEXT_PATH_PATTERN = /(^|[^A-Za-z0-9])(\/[A-Za-z0-9_\-/.]*)/g;
