// src/lib/server/auth/ops-authz.ts
// #820: /ops 認可のための Cognito group 定義と判定ヘルパ。
//
// 現状（PR-A）: 定数と判定ヘルパを追加するのみ。実際の /ops 認可切替は PR-C で行う。
// 将来の階層化（`ops-cs` / `ops-eng` など）に備え、名前は enum 化して 1 箇所で管理する。

import type { Identity } from './types';

/**
 * 運営ダッシュボード `/ops` 全体を操作できる group 名。
 * Cognito User Pool の group 名と一致させる（CDK 側で同じ文字列で作成する）。
 */
export const OPS_GROUP = 'ops';

/**
 * すべての ops 系 group を列挙。
 * 将来 `ops-cs` / `ops-eng` のように分割しても、1 箇所の変更で判定が追従する。
 */
export const OPS_GROUPS = [OPS_GROUP] as const;

export type OpsGroup = (typeof OPS_GROUPS)[number];

/**
 * identity が ops group に所属しているか判定する。
 * - local identity は常に false（`/ops` は Cognito 配信のみ想定）
 * - groups が未提供（旧トークン等）の場合も false
 */
export function isOpsMember(identity: Identity | null): boolean {
	if (!identity || identity.type !== 'cognito') return false;
	const groups = identity.groups;
	if (!groups || groups.length === 0) return false;
	return OPS_GROUPS.some((g) => groups.includes(g));
}
