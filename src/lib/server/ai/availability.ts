// src/lib/server/ai/availability.ts
// AI provider の「使えなさ」を扱う共通レイヤー (#4366)
//
// ## なぜ要るか
//
// `isAvailable()` は「AI を呼んでよいか」を **呼ぶ前に** 答える契約だが、呼ばずに判定できるのは
// **設定 (env) が配られているか** までである。IAM 権限やモデルアクセスの有無は、実際に呼ぶまで
// 確定しない。#4366 の欠陥はここを取り違えて「判定できないもの」を `true` と申告したことにある。
//
// そこで責務を 2 つに割る:
//
// | 何を | どこで | いつ分かるか |
// |---|---|---|
// | 設定が配られているか | 各 provider の `isAvailable()` | 呼ぶ前に確定する |
// | 権限・モデルアクセスがあるか | 本 file の latch (呼び出し失敗の記録) | 1 回呼んで初めて分かる |
//
// 呼び出しが **可用性クラスのエラー** (権限なし / 資格情報なし / モデル未存在 / API キー不正) で
// 落ちたら、その provider を latch して以降 `isAvailable()` を `false` にする。これにより
// 「毎リクエストごとに無駄な往復と `logger.error` を出し、本物の異常がログに埋もれる」(#4366 害 c)
// が 1 回で止まる。設定・権限を直す操作は必ず deploy / 再起動を伴うので、プロセス生存中は
// 一方向 latch でよい (Lambda は cold start でクリアされる)。
//
// **一時的なエラー (throttling / timeout / 5xx / ネットワーク断) は latch しない。**
// 一過性の失敗で AI 機能を恒久停止させないため、分類は可用性クラスに限定する。

/**
 * 可用性クラスとみなす例外名。
 *
 * AWS SDK は `err.name` に API のエラーコードを載せる。Gemini SDK は名前を持たないことがあるため
 * `UNAVAILABLE_MESSAGE_PATTERNS` と 401/403 でも判定する。
 */
const UNAVAILABLE_ERROR_NAMES = new Set([
	'AccessDeniedException',
	'UnrecognizedClientException',
	'ExpiredTokenException',
	'InvalidSignatureException',
	'CredentialsProviderError',
	'CredentialsError',
	'ResourceNotFoundException',
	'UnauthorizedException',
]);

/** 例外名が無い SDK 向けのメッセージ判定。**一時的な失敗にマッチする語を入れないこと。** */
const UNAVAILABLE_MESSAGE_PATTERNS: RegExp[] = [
	/access\s*denied/i,
	/not\s*authorized/i,
	/permission[\s_-]?denied/i,
	/unauthorized/i,
	/api[\s_-]?key[\s_-]?(?:is\s*)?(?:not\s*valid|invalid)/i,
	/invalid\s*api[\s_-]?key/i,
	/could\s*not\s*load\s*credentials/i,
	/credentials?\s*(?:is|are)?\s*(?:missing|not\s*(?:configured|found))/i,
	/is\s*not\s*configured/i,
];

/** 可用性クラスとみなす HTTP ステータス (認証・認可の拒否のみ)。 */
const UNAVAILABLE_HTTP_STATUSES = new Set([401, 403]);

interface SdkErrorShape {
	name?: unknown;
	message?: unknown;
	$metadata?: { httpStatusCode?: unknown };
	status?: unknown;
}

/**
 * 例外が「この provider は今の設定では使えない」ことを示すか判定する。
 *
 * true になるのは **設定・権限・資格情報の欠落**に起因するものだけ。throttling / timeout /
 * 5xx / パースエラーのような一時的・入力起因の失敗は false を返す (それらで AI 機能を
 * 恒久停止させない)。
 */
export function isAiUnavailableError(err: unknown): boolean {
	if (err === null || err === undefined) return false;
	const e = err as SdkErrorShape;

	if (typeof e.name === 'string' && UNAVAILABLE_ERROR_NAMES.has(e.name)) return true;

	const httpStatus = e.$metadata?.httpStatusCode ?? e.status;
	if (typeof httpStatus === 'number' && UNAVAILABLE_HTTP_STATUSES.has(httpStatus)) return true;

	const message = typeof e.message === 'string' ? e.message : String(err);
	return UNAVAILABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/** latch 済み provider 名。プロセス生存中のみ保持する (再起動 = 設定変更の機会でクリア)。 */
const latched = new Set<string>();

/**
 * provider を「使えない」と記録する。以降 `isProviderLatchedUnavailable()` が true を返す。
 *
 * 呼び出し側 (各 provider の converse 系) は、例外を握り潰さず **rethrow したうえで** 記録する。
 * サービス層のフォールバック経路は従来どおり動く。
 */
export function markProviderUnavailable(providerName: string): void {
	latched.add(providerName);
}

/** provider が可用性クラスのエラーで latch されているか。 */
export function isProviderLatchedUnavailable(providerName: string): boolean {
	return latched.has(providerName);
}

/** テスト用。プロセス内 latch を全解除する (本番コードから呼ばない)。 */
export function resetAiAvailabilityLatch(): void {
	latched.clear();
}

/**
 * converse 系の実行を包み、可用性クラスの失敗だけを latch して例外はそのまま投げ直す。
 *
 * 「握り潰して false を返す」のではなく rethrow するのは、サービス層が既に `try/catch` で
 * フォールバックを持っており、そこに縮退の責務を集約しているため (#4366 (b))。
 */
export async function withAvailabilityTracking<T>(
	providerName: string,
	run: () => Promise<T>,
): Promise<T> {
	try {
		return await run();
	} catch (err) {
		if (isAiUnavailableError(err)) {
			markProviderUnavailable(providerName);
		}
		throw err;
	}
}
