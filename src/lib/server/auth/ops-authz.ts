// src/lib/server/auth/ops-authz.ts
// #820: /ops 認可のための Cognito group 定義と判定ヘルパ。
//
// 現状（PR-A）: 定数と判定ヘルパを追加するのみ。実際の /ops 認可切替は PR-C で行う。
// 将来の階層化（`ops-cs` / `ops-eng` など）に備え、名前は enum 化して 1 箇所で管理する。

import { error } from '@sveltejs/kit';
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

/**
 * グローバル master (全テナント共有の統計基準値 = `market_benchmarks` 等) への書込を
 * ops/admin 相当に限定する単一強制点 (#3824、CWE-639 隣接 / #3593 ④ の実厳格化)。
 *
 * `market_benchmarks` は tenant 非依存のグローバル master であり、1 テナントの書込が
 * 全テナントに波及する。したがって「通常の保護者 (parent-admin) 操作」から到達させず、
 * ops/admin 相当の権限に限定する (ADR-0063 単一強制点 / ADR-0022 admin bypass 禁止と整合)。
 *
 * 書込許可:
 * - `local` identity (NUC セルフホスト): 単一テナントの唯一運用者 = ops/admin 相当。
 *   全テナント波及の概念がなく、`capabilities.ts` の `canWriteDb` と同じ信頼ベース (ADR-0051)。
 * - `cognito` ops group member: SaaS 運営スタッフ。
 *
 * 書込拒否 (`error(403)` を throw):
 * - `cognito` parent-admin (非 ops、通常の保護者顧客): 1 家庭の保護者が全テナント共有の
 *   統計基準値を書換える権限昇格を防ぐ。
 * - `anonymous` (demo) / 未認証: そもそも hooks で write no-op だが fail-closed で 403。
 *
 * 読取 (`findBenchmark` / `findAllBenchmarks`) は本 guard の対象外 (全 admin が自テナント
 * 統計比較のため読める)。書込 (`upsertBenchmark`) 到達点でのみ呼ぶこと。
 */
export function requireGlobalMasterWriteAccess(locals: App.Locals): void {
	const identity = locals.identity;
	if (identity?.type === 'local') return;
	if (isOpsMember(identity)) return;
	error(403, 'Forbidden: global master write requires ops access');
}
