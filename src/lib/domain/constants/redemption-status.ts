// src/lib/domain/constants/redemption-status.ts
// ごほうびショップ交換申請の状態機械 SSOT (#1337、#3424 DSQL 移管で runtime 配列化)。
// 遷移: pending_parent_approval → approved / rejected / expired。
// DSQL reward_redemption_requests.status の CHECK 生成 (fitness#13) と型定義が共有する。

export const REDEMPTION_STATUSES = [
	'pending_parent_approval',
	'approved',
	'rejected',
	'expired',
] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];

/**
 * ごほうび申請の承認画面で表示する履歴件数 (#4676)。
 * `/admin/rewards/requests` の load とセクション見出し・ページガイド文言が同じ値を引く
 * (数値の直書きを作らない)。
 */
export const REWARD_REQUEST_HISTORY_LIMIT = 30;

/**
 * 却下理由の最大文字数 (#4676)。server 側の切り詰め (reward-redemption-service) と
 * 入力欄ラベル・ページガイド文言が同じ値を引く。
 */
export const REWARD_REJECT_NOTE_MAX_LENGTH = 100;
