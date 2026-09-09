/**
 * 活動記録 (`recordActivity`) の失敗契約 — service と表示文言の唯一の接点。
 *
 * ## なぜ domain に置くか
 *
 * 失敗理由は 3 つの service file が**同じ union をそれぞれ inline で宣言**していた
 * (`activity-record-preparation.ts` / `activity-log-service.ts` / `activity-record-dsql.ts`)。
 * 画面側の文言解決はコードを `string` で受けていたため、**service がコードを増減・改名しても
 * TypeScript が無警告**で、顧客は黙って汎用文言 (「記録に失敗しました」) に戻る。
 * それは本 PR が `/setup/first-adventure` で塞いだ「無音の失敗」と同じクラスの退行なので、
 * 型で結んで再発を機械検出する。
 *
 * ## 結線
 *
 * 3 service の戻り型 = `… | RecordActivityFailure` にすることで、新しいコードを inline で
 * 返そうとすると代入不能で落ちる → コードは必ず本 file の union に足すことになる。
 * 本 union が増えると、`labels.ts` の
 * `satisfies Record<RecordActivityErrorCode, string>` が「文言が無い」で落ちる。
 * つまり **コードを足したら文言を足すまでビルドが通らない**。
 */

/** `recordActivity` が返す失敗理由コード。 */
export const RECORD_ACTIVITY_ERROR_CODES = [
	'ALREADY_RECORDED',
	'DAILY_LIMIT_REACHED',
	'NOT_FOUND',
] as const;

export type RecordActivityErrorCode = (typeof RECORD_ACTIVITY_ERROR_CODES)[number];

/**
 * `NOT_FOUND` の対象。
 *
 * `child` は **越境した childId** (CWE-598 / ADR-0055 §3.1 の cross-child guard) で、
 * `activity` は消えた / 他の子の活動。両者を 1 本の文言にまとめると、越境のケースが
 * 「活動が見つかりません」にすり替わって原因が読めなくなる。
 */
export const RECORD_ACTIVITY_NOT_FOUND_TARGETS = ['child', 'activity'] as const;

export type RecordActivityNotFoundTarget = (typeof RECORD_ACTIVITY_NOT_FOUND_TARGETS)[number];

/** `recordActivity` / `prepareActivityRecord` / `recordActivityDsql` 共通の失敗値。 */
export type RecordActivityFailure =
	| { error: 'ALREADY_RECORDED' }
	| { error: 'DAILY_LIMIT_REACHED' }
	| { error: 'NOT_FOUND'; target: RecordActivityNotFoundTarget };
