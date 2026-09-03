import { json } from '@sveltejs/kit';
import {
	ACTIVITY_PIN_ERROR_LABELS,
	IMPORT_LABELS,
	PLAN_GATE_LABELS,
	SETTINGS_LABELS,
} from '$lib/domain/labels';
// #2057: 「管理画面」 → 「ご家族の見守り画面」 rename atom 参照
import { ADMIN_VIEW_TERMS } from '$lib/domain/terms';
import { logger } from '$lib/server/logger';

export type ErrorCode =
	| 'VALIDATION_ERROR'
	| 'CANCEL_EXPIRED'
	| 'ALREADY_RECORDED'
	| 'DAILY_LIMIT_REACHED'
	| 'PIN_LIMIT_EXCEEDED'
	| 'ALREADY_CLAIMED'
	| 'INSUFFICIENT_POINTS'
	| 'INVALID_PIN'
	| 'UNAUTHORIZED'
	| 'LOCKED_OUT'
	| 'NOT_FOUND'
	| 'PLAN_LIMIT_EXCEEDED'
	| 'EXPORT_NOT_READY'
	| 'EXPORT_FAILED'
	| 'IMPORT_RESTORE_FAILED'
	| 'EXPORT_DELETE_FAILED'
	| 'INTERNAL_ERROR';

export type ErrorSeverity = 'info' | 'warning' | 'error';
export type ErrorAction = 'retry' | 'fix_input' | 'contact_admin' | 'none';

interface ErrorDefinition {
	status: number;
	userMessage: string;
	severity: ErrorSeverity;
	action: ErrorAction;
}

const ERROR_DEFINITIONS: Record<ErrorCode, ErrorDefinition> = {
	VALIDATION_ERROR: {
		status: 400,
		userMessage: '入力内容に問題があります。内容を確認してもう一度お試しください。',
		severity: 'warning',
		action: 'fix_input',
	},
	CANCEL_EXPIRED: {
		status: 400,
		userMessage: 'キャンセル期限を過ぎています。',
		severity: 'info',
		action: 'none',
	},
	ALREADY_RECORDED: {
		status: 409,
		userMessage: 'この活動は既に記録済みです。',
		severity: 'info',
		action: 'none',
	},
	DAILY_LIMIT_REACHED: {
		status: 409,
		userMessage: 'きょうはこれ以上きろくできません。',
		severity: 'info',
		action: 'none',
	},
	/**
	 * 活動のピン留め (おきにいり) がカテゴリ上限に達した (PO 回答 2026-09-03 §4 #2 follow-up)。
	 *
	 * 旧実装は上限も不在も `VALIDATION_ERROR` (400) に畳んでいたため、client は
	 * **顧客向け文言に「上限」が含まれるかの部分一致**で種別を見分けるしかなかった。文言は
	 * labels SSOT から組み立てられる = 変わる値なので、部分一致はいずれ外れる (ADR-0061 /
	 * `plan-limit-error-required-tier.test.ts` が別 endpoint で禁じている判定形と同型)。
	 *
	 * 上限に達するのは入力の誤りではなく既存の状態 (既に 5 件ピン済み) なので、`DAILY_LIMIT_REACHED`
	 * と同じ 409 / info / none に揃える (ADR-0062 §1 権限・状態起因)。プラン由来の上限ではないため
	 * `PLAN_LIMIT_EXCEEDED` は使わない (アップグレード導線を出してはいけない)。
	 */
	PIN_LIMIT_EXCEEDED: {
		status: 409,
		userMessage: ACTIVITY_PIN_ERROR_LABELS.limitExceeded,
		severity: 'info',
		action: 'none',
	},
	ALREADY_CLAIMED: {
		status: 409,
		userMessage: 'このボーナスは既に受け取り済みです。',
		severity: 'info',
		action: 'none',
	},
	INSUFFICIENT_POINTS: {
		status: 400,
		userMessage: 'ポイントが足りません。もう少し活動を記録してから再度お試しください。',
		severity: 'warning',
		action: 'none',
	},
	INVALID_PIN: {
		status: 401,
		userMessage: 'おやカギコードが正しくありません。もう一度入力してください。',
		severity: 'warning',
		action: 'fix_input',
	},
	UNAUTHORIZED: {
		status: 401,
		userMessage: `ログインが必要です。${ADMIN_VIEW_TERMS.canonical}からログインしてください。`,
		severity: 'warning',
		action: 'fix_input',
	},
	LOCKED_OUT: {
		status: 429,
		userMessage: '連続で間違えたため、しばらくログインできません。時間をおいてお試しください。',
		severity: 'error',
		action: 'retry',
	},
	NOT_FOUND: {
		status: 404,
		userMessage: 'お探しのデータが見つかりませんでした。',
		severity: 'warning',
		action: 'none',
	},
	PLAN_LIMIT_EXCEEDED: {
		status: 403,
		userMessage: PLAN_GATE_LABELS.standardOrAboveGenericWithUpgrade,
		severity: 'info',
		action: 'none',
	},
	// #4717: クラウド共有データが生成待ち (pending/building)。時間をおけば解決するので retry を促す。
	EXPORT_NOT_READY: {
		status: 409,
		userMessage: SETTINGS_LABELS.cloudImportNotReady,
		severity: 'info',
		action: 'retry',
	},
	// #4717: クラウド共有データの生成が失敗している。受け取る側の操作では解決しない。
	EXPORT_FAILED: {
		status: 409,
		userMessage: SETTINGS_LABELS.cloudImportBuildFailed,
		severity: 'error',
		action: 'none',
	},
	// #4752 (PO 回答 2026-09-03 条件 2): 置換インポートが失敗し、旧データへの自動復元も途中で止まった
	// (半端な状態)。500 にすると client (error-notify, ADR-0062 §2) が body を捨てて「時間をおいて再度
	// お試しください」だけを出し、半端な状態であることも復旧手段も顧客に届かない (再試行を促すのは
	// 誤った回復行動)。EXPORT_FAILED (#4717) と同じ「状態起因 409」として文言を通し、次の行動を
	// contact_admin (運営連絡) にする。message は route が復旧コード入り
	// (IMPORT_LABELS.errorReplaceRestoreFailedWithCode) を渡す。
	IMPORT_RESTORE_FAILED: {
		status: 409,
		userMessage: IMPORT_LABELS.errorReplaceRestoreFailed,
		severity: 'error',
		action: 'contact_admin',
	},
	// #4767 QM should: 保管実体 (S3) の削除に失敗して削除を中断した。DB 行は残っているため
	// 一覧・保管枠・実体は食い違わない。500 にすると error-notify SSOT が「システムに問題が
	// 発生しました」に潰し (ADR-0062 §内部例外非露出)、**データが残っていることが顧客に伝わらない**ので
	// 409 (状態の競合) で返し、message と userMessage に同じ labels SSOT の文を載せる。
	EXPORT_DELETE_FAILED: {
		status: 409,
		userMessage: SETTINGS_LABELS.cloudDeleteFailed,
		severity: 'error',
		action: 'retry',
	},
	INTERNAL_ERROR: {
		status: 500,
		userMessage: 'システムに問題が発生しました。しばらくしてからお試しください。',
		severity: 'error',
		action: 'retry',
	},
};

export function apiError(code: ErrorCode, message: string, context?: Record<string, unknown>) {
	const def = ERROR_DEFINITIONS[code];
	if (def.status >= 500) {
		logger.error(`[API] ${code}: ${message}`, { context });
	} else if (def.status >= 400) {
		logger.warn(`[API] ${code}: ${message}`, { context });
	}
	return json(
		{
			error: {
				code,
				message,
				userMessage: def.userMessage,
				severity: def.severity,
				action: def.action,
			},
		},
		{ status: def.status },
	);
}

/**
 * プラン制限による 403 を **要求 tier 込み**で返す (#4710 / #4767 PO 回答 #4)。
 *
 * `apiError('PLAN_LIMIT_EXCEEDED', …)` は userMessage を `ERROR_DEFINITIONS` の固定文
 * (スタンダード以上の案内) から取るため、**プレミアム限定機能をスタンダード契約者が叩いても
 * 「スタンダード以上でご利用いただけます」** と返していた。既にスタンダードな顧客は
 * 次の行動が取れない (実測: AI 提案 `POST /api/v1/activities/suggest`)。
 *
 * 呼び出し側は「その機能が何 tier を要求するか」を必ず知っている (gate 判定をしている当人)
 * ので、tier と機能名を引数で受け取り、顧客向け文言を labels SSOT (`PLAN_GATE_LABELS.
 * requiredTierWithUpgradeFor`) で **1 本だけ**組み立てる。
 *
 * **顧客に届く文字列は `message` の 1 本** (#4767 PO 回答 #4)。旧実装は `message` (呼び出し側の
 * 自由文字列 / 開発者向け) と `userMessage` (tier 別の固定文) を別々に持ち、client が実際に読む
 * `message` にはアップグレード導線が載っていなかった。`userMessage` は同じ文字列の alias として残す
 * (ADR-0062 の contract を読む既存 consumer 互換。別の文字列を入れる経路は無い —
 * `tests/unit/architecture/plan-limit-error-required-tier.test.ts` が固定する)。
 *
 * `PLAN_LIMIT_EXCEEDED` を `apiError` で直接返す経路も同 test が禁止する。
 *
 * @param requiredTier その機能が要求する最低 tier
 * @param feature 機能名 (`FEATURE_LABELS` 等の labels SSOT から渡す)。route に日本語を直書きしない
 * @param context ログに残す内訳 (tenantId / tier 等)。顧客には出さない
 */
export function planLimitError(
	requiredTier: 'standard' | 'family',
	feature: string,
	context?: Record<string, unknown>,
) {
	const message = PLAN_GATE_LABELS.requiredTierWithUpgradeFor(feature, requiredTier);
	logger.warn(`[API] PLAN_LIMIT_EXCEEDED: ${feature}`, { context: { ...context, requiredTier } });
	const def = ERROR_DEFINITIONS.PLAN_LIMIT_EXCEEDED;
	return json(
		{
			error: {
				code: 'PLAN_LIMIT_EXCEEDED',
				message,
				/** @deprecated `message` と常に同一。読む側は `message` を使う (#4767 PO 回答 #4) */
				userMessage: message,
				severity: def.severity,
				action: def.action,
			},
		},
		{ status: def.status },
	);
}

/**
 * **枠が埋まっている**ことによる 403 を返す (#4710)。
 *
 * {@link planLimitError} は「その tier では機能が使えない」前提で userMessage を要求 tier から
 * 組み立てる (次の行動 = アップグレード)。一方 quota (クラウド保管 3 件等) の上限に達するのは
 * **既に契約している顧客**なので、同じ文言を返すと「スタンダードプラン以上でご利用いただけます」と
 * 契約済みの顧客に言うことになり、次の行動が取れない (#4710 の症状そのもの)。最上位プランの
 * 顧客に至っては上げ先すら無い。
 *
 * したがって userMessage は要求 tier からではなく、**呼び出し側が labels SSOT から渡した
 * 「その場で取れる行動」を言う文言**をそのまま使う。
 *
 * status / code は `planLimitError` と同じ 403 / `PLAN_LIMIT_EXCEEDED` を保つ (枠を決めるのは
 * プランなので client の分岐条件は変わらない)。変えるのは顧客に見える文言だけ。
 *
 * 顧客に届く文字列は `message` の 1 本 (#4767 PO 回答 #4): admin 設定画面は
 * `resolveApiErrorMessage(status, d.error.message)` で **`message` の方を表示している**ため、
 * ここに開発者向け文字列を入れると顧客側だけ generic 文言に落ちる。内訳 (current / max) は
 * `context` に入れてログにだけ残す。`userMessage` は同じ文字列の alias。
 *
 * @param message 顧客向け文言。**必ず `PLAN_GATE_LABELS` 等の labels SSOT 経由で渡す** (ADR-0045)
 * @param context ログに残す内訳 (current / max / tenantId 等)。顧客には出さない
 */
export function quotaLimitError(message: string, context?: Record<string, unknown>) {
	logger.warn(`[API] PLAN_LIMIT_EXCEEDED (quota): ${message}`, { context });
	const def = ERROR_DEFINITIONS.PLAN_LIMIT_EXCEEDED;
	return json(
		{
			error: {
				code: 'PLAN_LIMIT_EXCEEDED',
				message,
				/** @deprecated `message` と常に同一。読む側は `message` を使う (#4767 PO 回答 #4) */
				userMessage: message,
				severity: def.severity,
				action: def.action,
			},
		},
		{ status: def.status },
	);
}

export function notFound(message = 'みつかりませんでした') {
	return apiError('NOT_FOUND', message);
}

export function validationError(message: string) {
	return apiError('VALIDATION_ERROR', message);
}
