// src/lib/domain/constants/child-challenge.ts
// per-child チャレンジ (#2362 PR-7) の固定集合 SSOT (#3424 DSQL 移管で runtime 配列化)。
// DSQL child_challenges の CHECK 生成 (fitness#13) が参照する。
// challenge_type ('cooperative' 単値、#2296) は新型追加があり得る増減集合のため CHECK 対象外。

export const CHILD_CHALLENGE_STATUSES = ['active', 'completed', 'expired'] as const;
export type ChildChallengeStatus = (typeof CHILD_CHALLENGE_STATUSES)[number];

export const CHALLENGE_PERIOD_TYPES = ['weekly', 'monthly', 'custom'] as const;
export type ChallengePeriodType = (typeof CHALLENGE_PERIOD_TYPES)[number];
