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
