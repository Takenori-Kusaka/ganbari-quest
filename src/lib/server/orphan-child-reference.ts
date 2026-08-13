// src/lib/server/orphan-child-reference.ts
// 「children 一覧から引けない childId」の観測 (#4556)
//
// #4543 は、参照先の子供が解決できないときの表示を内部 ID (`#01J...`) から汎用語
// (`UNRESOLVED_ENTITY_LABELS.child` =「不明なお子さま」) に置き換えた。これで顧客には
// 内部 ID が出なくなったが、**孤立レコードが存在すること自体は未追跡**のまま残った。
// 表示を隠しただけなので、孤立が 1 件から 100 件に増えても誰も気づかない。
//
// ここでは「後から件数を数えられる」ことだけを目的に warn ログを 1 行出す。ADR-0010
// (Pre-PMF) に沿って、alert / metric / 自動修復には踏み込まない:
//
// - **load 1 回につき最大 1 行**。行ごと (= 子供ごと / 描画ごと) には出さない。孤立 5 件の
//   テナントが画面を開くたびに 5 行出ると、ログが埋まって逆に数えられなくなる
// - **孤立が 0 件なら何も出さない**。正常系は無音
// - childId は内部 ID だが、**顧客に見せる出力ではなく運用ログ**なので載せる (これが無いと
//   「どのレコードが壊れているか」を追えず、調査のために結局 DB を舐めることになる)

import { logger } from '$lib/server/logger';

export interface OrphanChildReferenceParams {
	/** テナント (集計・調査の起点) */
	tenantId: string;
	/** 参照されている childId 群 (重複可) */
	referencedChildIds: readonly string[];
	/** 実在する childId 群 (`getAllChildren` の結果など) */
	knownChildIds: readonly string[];
	/** 発生箇所。ログから呼び出し元を一意に引けるように、route / load を識別できる文字列を渡す */
	source: string;
}

/**
 * 参照先が `children` 一覧に無い childId を検出し、あれば warn を 1 行出す。
 *
 * @returns 孤立していた childId (重複除去・入力順)。呼び出し側での assert / test 用。
 */
export function warnOrphanChildReferences(params: OrphanChildReferenceParams): string[] {
	const { tenantId, referencedChildIds, knownChildIds, source } = params;
	const known = new Set(knownChildIds);
	const orphans: string[] = [];
	for (const id of referencedChildIds) {
		if (!known.has(id) && !orphans.includes(id)) orphans.push(id);
	}

	if (orphans.length === 0) return orphans;

	logger.warn('orphan child reference', {
		tenantId,
		service: 'orphan-child-reference',
		context: { source, orphanChildIds: orphans, orphanCount: orphans.length },
	});

	return orphans;
}
