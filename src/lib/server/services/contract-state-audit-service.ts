// src/lib/server/services/contract-state-audit-service.ts
// EPIC #4118 手 3 — 本番行を分類して不正状態 (X1-X4) を報告する。
//
// `contract-state-matrix.md` §7 が実装方針を 3 手に分けている。
//
//   1. ドメイン層に S1-S6 / X1-X4 と `classifyContractState()` を置く（#4181）
//   2. 各 webhook handler の unit test で「適用後の行が S1-S6 に分類される」ことを assert する（#4118 手 2）
//   3. **定期監査 (`/ops` or cron) で本番行を分類し、X1-X4 に該当する行を報告する**  ← 本 file
//
// 手 2 は「**これから入る変更**」を止めるが、**すでに本番に存在する不正行は検出しない**。
// 実際 #4118 手 2 で見つけた `invoice.paid` の X3 (active なのに猶予終了日が残る) は、
// 修正前に dunning から復帰したテナントの行に残っている可能性がある。
// 手 3 はその「**在庫**」を見えるようにする。
//
// ## PII を持ち出さない
//
// 出力は tenantId と 4 列の分類結果だけに絞る。名前 / メール / Stripe customer は含めない
// (`/ops` は運用者しか見ないが、不正状態の一覧は「どのテナントが壊れているか」の情報であり、
// 復旧に必要な最小限を超えて持ち出す理由がない)。

import {
	type ContractStateClassification,
	classifyContractState,
	INVALID_CONTRACT_STATES,
	UNCLASSIFIED_CONTRACT_STATE,
	VALID_CONTRACT_STATES,
} from '$lib/domain/contract-state';
import { getRepos } from '$lib/server/db/factory';

/** 分類できなかった / 不正だった 1 行。復旧に要る最小限だけ持つ。 */
export interface ContractStateAuditRow {
	tenantId: string;
	classification: ContractStateClassification;
	status: string;
	hasPlan: boolean;
	hasSubscription: boolean;
	hasPlanExpiresAt: boolean;
}

export interface ContractStateAuditResult {
	/** 分類ごとの件数 (S1-S6 / X1-X4 / UNCLASSIFIED を必ず全 key 持つ)。 */
	counts: Record<ContractStateClassification, number>;
	/** 母数。counts の合計と一致する。 */
	total: number;
	/** 是正が要る行 (X1-X4 + UNCLASSIFIED)。件数が多い場合に備え上限を設ける。 */
	problemRows: ContractStateAuditRow[];
	/** `problemRows` が上限で切られた場合の残件数 (0 なら全件掲載)。 */
	truncated: number;
}

/** 一覧に載せる最大件数。超過分は件数だけ返す (画面が壊れないように)。 */
export const MAX_PROBLEM_ROWS = 200;

/** 全 classification を 0 で初期化する (集計 0 件の状態を「key が無い」で表さない)。 */
function emptyCounts(): Record<ContractStateClassification, number> {
	const counts = {} as Record<ContractStateClassification, number>;
	for (const s of VALID_CONTRACT_STATES) counts[s] = 0;
	for (const s of INVALID_CONTRACT_STATES) counts[s] = 0;
	counts[UNCLASSIFIED_CONTRACT_STATE] = 0;
	return counts;
}

/** 是正が要る分類か (正常 S1-S6 以外はすべて対象)。 */
export function isProblemClassification(c: ContractStateClassification): boolean {
	return !VALID_CONTRACT_STATES.includes(c as (typeof VALID_CONTRACT_STATES)[number]);
}

/**
 * 全テナントの契約 4 列を分類し、不正状態を集計する。
 *
 * **正常だった件数も返す**。問題行だけ返すと「0 件」が「監査が動いていない」と
 * 区別できず、壊れた監査を緑と読み違える。
 */
export async function auditContractStates(): Promise<ContractStateAuditResult> {
	const tenants = await getRepos().auth.listAllTenants();
	const counts = emptyCounts();
	const problemRows: ContractStateAuditRow[] = [];
	let truncated = 0;

	for (const t of tenants) {
		const classification = classifyContractState({
			status: t.status,
			plan: t.plan ?? null,
			stripeSubscriptionId: t.stripeSubscriptionId ?? null,
			planExpiresAt: t.planExpiresAt ?? null,
		});
		counts[classification] += 1;

		if (!isProblemClassification(classification)) continue;
		if (problemRows.length >= MAX_PROBLEM_ROWS) {
			truncated += 1;
			continue;
		}
		problemRows.push({
			tenantId: t.tenantId,
			classification,
			status: t.status,
			hasPlan: Boolean(t.plan),
			hasSubscription: Boolean(t.stripeSubscriptionId),
			hasPlanExpiresAt: Boolean(t.planExpiresAt),
		});
	}

	return { counts, total: tenants.length, problemRows, truncated };
}
