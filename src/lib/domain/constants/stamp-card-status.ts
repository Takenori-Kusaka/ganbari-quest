// src/lib/domain/constants/stamp-card-status.ts
// スタンプカードの状態機械 SSOT (#3424 DSQL 移管で runtime 配列化)。
// 遷移: collecting (押印中) → redeemable (満了・交換可) → redeemed (交換済)。
// DSQL stamp_cards.status の CHECK 生成 (fitness#13、手書き二重化禁止) と
// service 層の状態判定が本配列を共有する。

export const STAMP_CARD_STATUSES = ['collecting', 'redeemable', 'redeemed'] as const;
export type StampCardStatus = (typeof STAMP_CARD_STATUSES)[number];
