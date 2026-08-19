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
//
// ## なぜ「運営に届く」必要があるか (#4375 follow-up、オーナー決裁 2026-08-07)
//
// AI が使えない間、顧客は領収書の手入力に落ちる (有料機能が事実上死んでいる)。にもかかわらず
// #4366 merge 時点は `!isAiAvailable()` 分岐が log を 1 行も出さない完全な silent で、運営は
// それに気付けなかった。そこで「AI が使えない状態にある」ことを 1 行だけ log に出し、
// `infra/lib/ops-stack.ts` の MetricFilter + Alarm で観測可能にする。
//
// **顧客向け文言「運営が検知済み」の裏付けがこの経路**。alarm は `ALARM_NOTIFY_POLICY` で
// `notify: true` = Discord の障害通知に届く (オーナー決裁 2026-08-07)。ここを止めると
// 文言が嘘になるため、通知方針を降格するときは文言も同時に見直す。
//
// ただしこの alarm は AWS の `OpsStack` にしか無く、**自宅 NUC のセルフホスト家庭には
// 「運営」が居ない**。そのため顧客向け文言は配備で 2 本に分ける
// (`src/lib/server/ai/unavailable-message.ts` が実行モードから選ぶ)。
//
// **per-request では出さない。** 毎リクエスト logger を叩くと本物の異常が埋もれる
// (#4366 害 c) ため、理由ごとにプロセス内で 1 回だけに絞る。設定・権限を直す操作は
// deploy / 再起動を伴うので、プロセス生存中 1 回で運営の判断材料としては足りる。

import { logger } from '$lib/server/logger';

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
 * AI が使えない状態を運営に届けるための log 用語 (SSOT)。
 *
 * metric 化と alarm は `infra/lib/ops-stack.ts` の `AI_PROVIDER_UNAVAILABLE_LOG_TERM`
 * (CDK の tsconfig rootDir 制約で src を import できないため literal で持ち、
 * `tests/unit/infra/ai-provider-unavailable-alarm.test.ts` が drift を機械検証する)。
 */
export const AI_PROVIDER_UNAVAILABLE_LOG_TERM = '[ai-alert] ai-provider-unavailable';

/**
 * AI 呼び出しが **失敗して呼び出し側が fallback に落ちた**ことを表す log 用語 (SSOT、#4726)。
 *
 * ## なぜ latch と別の信号が要るか
 *
 * `AI_PROVIDER_UNAVAILABLE_LOG_TERM` は **可用性クラスの失敗** (権限 / 資格情報 / モデル未存在)
 * でしか出ない。#4726 の本番障害はそのどれでもない `ValidationException`
 * (base model ID を on-demand で呼べない) で、全リクエストが 100% fallback に落ちていたのに
 * `ganbari-quest-ai-provider-unavailable` alarm は 1 度も鳴らず、発見はオーナーの手動実行だった。
 *
 * `ValidationException` を可用性クラスに足すのは不可 — 入力起因の ValidationException で
 * AI 機能が全停止に倒れる (上の `UNAVAILABLE_MESSAGE_PATTERNS` の設計注意と同じ理由)。
 * したがって latch ではなく **「呼んで失敗した割合」** を観測する。
 *
 * ## 出力粒度
 *
 * `AI_PROVIDER_UNAVAILABLE_LOG_TERM` と違い **1 呼び出しにつき 1 行**出す (dedupe しない) —
 * 率を出すには分子・分母の実件数が要るため。件数は AI 呼び出し数そのもの
 * (有料機能の実行回数) に等しく、per-request で膨らむ性質の log ではない。
 * 載せてよいのは分類まで (provider 名 / 例外クラス名)。例外メッセージ本文・顧客入力は載せない。
 *
 * **成功・失敗を同じ log level (info) で出す。** 片方だけ level を上げると、`LOG_LEVEL` の
 * 設定 1 つで分母だけが消えて率が壊れる (「1 件でも失敗すれば 100%」に化ける)。
 * 対称性は `tests/unit/infra/ai-fallback-rate-alarm.test.ts` [C3] が固定する。
 *
 * metric 化と alarm は `infra/lib/ops-stack.ts` の同名定数
 * (CDK の tsconfig rootDir 制約で src を import できないため literal で持ち、
 * `tests/unit/infra/ai-fallback-rate-alarm.test.ts` が drift を機械検証する)。
 */
export const AI_CALL_FAILED_LOG_TERM = '[ai-alert] ai-call-failed';

/** AI 呼び出しが成功したことを表す log 用語 (SSOT、#4726)。fallback 率の**分母**を作る。 */
export const AI_CALL_SUCCEEDED_LOG_TERM = '[ai-alert] ai-call-succeeded';

/** 例外から「載せてよい分類」だけを取り出す。メッセージ本文は載せない。 */
function errorClassOf(err: unknown): string {
	if (err instanceof Error && err.name) return err.name;
	const name = (err as { name?: unknown } | null)?.name;
	return typeof name === 'string' && name.length > 0 ? name : 'UnknownError';
}

/**
 * AI が使えない理由。**分類までが載せてよい上限**で、識別子・顧客情報・例外メッセージ本文は
 * 載せない (`src/lib/server/stripe/alert.ts` / `[auth-alert]` 系の既存規約と同じ)。
 *
 * - `not-configured`: env が配られていない (`isAvailable()` が呼ぶ前に false)
 * - `latched`: 呼んでみて権限・資格情報の欠落で落ち、以降呼ばない状態に倒れた
 */
export type AiUnavailableReason = 'not-configured' | 'latched';

/** 既に log を出した理由。プロセス内で理由ごとに 1 回だけ出すための重複抑止。 */
const reportedReasons = new Set<AiUnavailableReason>();

/** 理由ごとにプロセス内 1 回だけ log を出す。2 回目以降は何もしない。 */
function reportAiUnavailable(reason: AiUnavailableReason): void {
	if (reportedReasons.has(reason)) return;
	reportedReasons.add(reason);
	logger.warn(`${AI_PROVIDER_UNAVAILABLE_LOG_TERM} reason=${reason}`);
}

/**
 * 「呼ぶ前の可用性 guard で使えないと分かった」ことを報告する。
 *
 * 理由は latch 済みかどうかから導出する — サービス層は latch の有無を知らないので、
 * ここで解決しないと ops log に誤った理由が載る。
 */
export function reportAiUnavailableAtGuard(providerName: string): void {
	reportAiUnavailable(isProviderLatchedUnavailable(providerName) ? 'latched' : 'not-configured');
}

/**
 * provider を「使えない」と記録する。以降 `isProviderLatchedUnavailable()` が true を返す。
 *
 * 呼び出し側 (各 provider の converse 系) は、例外を握り潰さず **rethrow したうえで** 記録する。
 * サービス層のフォールバック経路は従来どおり動く。
 *
 * log は **latch へ遷移した最初の 1 回だけ**出す。ここは latch 遷移の単一点なので、
 * 「既に latch 済み = 既に報告済み」で早期 return すれば per-request の log 連発は原理的に起きない。
 */
export function markProviderUnavailable(providerName: string): void {
	if (latched.has(providerName)) return;
	latched.add(providerName);
	reportAiUnavailable('latched');
}

/** provider が可用性クラスのエラーで latch されているか。 */
export function isProviderLatchedUnavailable(providerName: string): boolean {
	return latched.has(providerName);
}

/** テスト用。プロセス内 latch と報告済みフラグを全解除する (本番コードから呼ばない)。 */
export function resetAiAvailabilityLatch(): void {
	latched.clear();
	reportedReasons.clear();
}

/**
 * converse 系の実行を包み、以下 2 つを行う。例外はそのまま投げ直す。
 *
 * 1. 可用性クラスの失敗だけを latch する (#4366)
 * 2. **1 呼び出し = 1 行**で成功 / 失敗の outcome を log に出す (#4726、fallback 率の分子・分母)
 *
 * 「握り潰して false を返す」のではなく rethrow するのは、サービス層が既に `try/catch` で
 * フォールバックを持っており、そこに縮退の責務を集約しているため (#4366 (b))。
 *
 * **包む範囲は「SDK 呼び出し」ではなく「使える結果を得るまで」**にすること (#4726)。
 * レスポンスの取り出しに失敗した場合 (tool_use ブロック無し / JSON パース不能) も
 * サービス層は fallback に落ちるため、そこを外に出すと fallback 率が実態より小さく出る。
 */
export async function withAvailabilityTracking<T>(
	providerName: string,
	run: () => Promise<T>,
): Promise<T> {
	try {
		const result = await run();
		logger.info(`${AI_CALL_SUCCEEDED_LOG_TERM} provider=${providerName}`);
		return result;
	} catch (err) {
		if (isAiUnavailableError(err)) {
			markProviderUnavailable(providerName);
		}
		// **成功と同じ level (info) で出す。** 分子だけ warn にすると `LOG_LEVEL=warn` を配った
		// 瞬間に分母 (成功) が消え、fallback 率が「1 件でも失敗すれば 100%」に化ける
		// (失敗の重大さは呼び出し側の logger.error が別に出しており、ここは metric の材料)。
		// LOG_LEVEL を上げれば両方消える = 率は算出されず alarm は無風になる (誤発火しない側)。
		logger.info(`${AI_CALL_FAILED_LOG_TERM} provider=${providerName} error=${errorClassOf(err)}`);
		throw err;
	}
}
