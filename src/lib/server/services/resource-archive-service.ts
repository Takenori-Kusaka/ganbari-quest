import { countsTowardActivityQuota } from '$lib/domain/activity-source';
import type { ActivityId, ChildId } from '$lib/domain/ids';
// src/lib/server/services/resource-archive-service.ts
// #783: トライアル終了時の超過リソース archive / アップグレード時の restore

import type { ArchivedReason } from '$lib/domain/archive-types';
import { jstDateOfIso } from '$lib/domain/date-utils';
import {
	archiveActivities,
	findActivities,
	findActivityLogs,
	restoreArchivedActivities,
} from '$lib/server/db/activity-repo';
import {
	archiveChecklistTemplates,
	findTemplatesByChild,
	restoreArchivedChecklistTemplates,
} from '$lib/server/db/checklist-repo';
import {
	archiveChildren,
	findAllChildren,
	findArchivedChildren,
	restoreArchivedChildren,
} from '$lib/server/db/child-repo';
import { getPlanLimits } from './plan-limit-service';

// Phase 7 PR-2a (#2688): ARCHIVED_REASONS SSOT (domain) に整合させ ArchivedReason 型注釈で
// repo 層の enum 制約と接続。caller 側の文字列 widening を防ぐ。
// #3575: id は opaque string。10 進文字列 (sqlite/demo backend) では (桁数, 辞書順) 比較が
// 旧 `a.id - b.id` の numeric 昇順 (= 古い順の proxy) と同値。uuid でも決定的順序を保つ。
function compareOpaqueIdAsc(a: string, b: string): number {
	return a.length - b.length || a.localeCompare(b);
}

const ARCHIVE_REASON: AutoArchiveReason = 'trial_expired';

/**
 * 顧客が「残すもの」を選ばないまま無料プランに戻ったときの archive reason (#4585-3)。
 *
 * - `trial_expired`: 体験終了で無料プランに戻った
 * - `dunning_canceled`: 支払い失敗で契約が消え、**顧客が操作しないまま**無料プランに戻った
 *
 * 顧客自身が選んで archive した分は `downgrade_user_selected` (downgrade-service) であり、
 * 本経路では書かない。ログから「体験終了 / 支払い失敗 / 顧客の選択」を区別するための分離。
 */
export type AutoArchiveReason = Extract<ArchivedReason, 'trial_expired' | 'dunning_canceled'>;

/**
 * 子供の並べ替えキー = `coalesce(最終記録日, 登録日)` の JST 暦日 (#4585-3、PO 決裁 Q3)。
 *
 * 日付は **JST 暦日**で出す。ISO 文字列の slice は UTC 暦日になり、JST 00:00〜09:00 の記録が
 * 前日へ落ちる (#4120)。導出は `deletion-export-service.ts` の `lastRecordDate` と同じ形。
 *
 * 解決できない (記録も登録日も読めない) 場合は空文字 = 最も古い扱い。ここで `undefined` を
 * 返して比較不能にすると並びが入力順に依存し、fallback が「実行のたびに結果が変わる」
 * ものになる (安定ソートの要求)。
 */
function lastUsedDayJst(createdAt: string | null | undefined, recordedAtList: string[]): string {
	const recordedDays = recordedAtList
		.filter((recordedAt): recordedAt is string => typeof recordedAt === 'string' && !!recordedAt)
		.map(safeJstDate)
		.filter((day) => day !== '')
		.sort();
	const lastRecordDay = recordedDays[recordedDays.length - 1];
	if (lastRecordDay) return lastRecordDay;
	return createdAt ? safeJstDate(createdAt) : '';
}

/** 壊れた timestamp で並びを崩さないための `jstDateOfIso` ラッパ。 */
function safeJstDate(isoTimestamp: string): string {
	if (Number.isNaN(new Date(isoTimestamp).getTime())) return '';
	return jstDateOfIso(isoTimestamp);
}

/**
 * 「残す子供」を決める順に並べ替える (#4585-3)。
 *
 * `coalesce(最終記録日, 登録日)` の **新しい順**に残す。同点は id 昇順で解く
 * (キーが同点でも id は一意なので順序が全順序になり、入力順に依存しない = 安定)。
 *
 * 活動 / チェックリストは**登録順のまま**にする (PO 決裁 Q1: 適用は子供だけ)。1 件単位で
 * 落ちる資源と違い、子供が archive されるとその子に紐づくすべてが一度に見えなくなるため、
 * 「毎日使っている下の子が消えて、使っていない上の子が残る」を子供でだけ潰す。
 */
async function sortChildrenByRecentUse<T extends { id: ChildId; createdAt?: string | null }>(
	children: T[],
	tenantId: string,
): Promise<T[]> {
	// 最終記録日は 1 子供 1 クエリ。上限超過時にしか呼ばれない (通常運用では 0 クエリ)。
	const lastUsedDays = await Promise.all(
		children.map(async (child) => {
			const logs = await findActivityLogs(child.id, tenantId);
			return lastUsedDayJst(
				child.createdAt,
				logs.map((log) => log.recordedAt),
			);
		}),
	);
	const keyById = new Map(children.map((child, i) => [child.id, lastUsedDays[i] ?? '']));
	return [...children].sort((a, b) => {
		const keyA = keyById.get(a.id) ?? '';
		const keyB = keyById.get(b.id) ?? '';
		if (keyA !== keyB) return keyA < keyB ? 1 : -1; // 新しい順
		return compareOpaqueIdAsc(a.id, b.id);
	});
}

/**
 * 顧客が残すものを選ばないまま無料プランに戻ったとき、上限を超えるリソースを archive する。
 *
 * - 子供: `coalesce(最終記録日, 登録日)` の新しい順に maxChildren 件を残し、残りを archive
 *   (同点は id 昇順。#4585-3 PO 決裁 Q1 / Q3)
 * - 活動: source='custom' のうち古い順に maxActivities 件を残し、残りを archive
 * - チェックリスト: 各子供について古い順に maxChecklistTemplates 件を残し、残りを archive
 *
 * この規則は 3 経路 (解約フロー / 請求パネル / dunning) で共有する。経路ごとに残るものが
 * 変わると顧客にも説明できないため、規則は本関数 1 箇所だけが持つ。
 *
 * @param reason 無料プランに戻った理由。ログで体験終了と支払い失敗を区別するために刻む
 */
export async function archiveExcessResources(
	tenantId: string,
	reason: AutoArchiveReason = ARCHIVE_REASON,
): Promise<{
	archivedChildIds: ChildId[];
	archivedActivityIds: ActivityId[];
	archivedChecklistTemplateIds: string[];
}> {
	const limits = getPlanLimits('free');
	const result = {
		archivedChildIds: [] as ChildId[],
		archivedActivityIds: [] as ActivityId[],
		archivedChecklistTemplateIds: [] as string[],
	};

	// --- Children ---
	if (limits.maxChildren !== null) {
		const children = await findAllChildren(tenantId);
		if (children.length > limits.maxChildren) {
			// 直近の利用が新しい順にソートし、上限以降を archive (#4585-3)
			const sorted = await sortChildrenByRecentUse(children, tenantId);
			const excess = sorted.slice(limits.maxChildren);
			const ids = excess.map((c) => c.id);
			await archiveChildren(ids, reason, tenantId);
			result.archivedChildIds = ids;
		}
	}

	// --- Activities ---
	if (limits.maxActivities !== null) {
		const activities = await findActivities(tenantId);
		const custom = activities.filter((a) => countsTowardActivityQuota(a.source));
		if (custom.length > limits.maxActivities) {
			const sorted = [...custom].sort((a, b) => compareOpaqueIdAsc(a.id, b.id));
			const excess = sorted.slice(limits.maxActivities);
			const ids = excess.map((a) => a.id);
			await archiveActivities(ids, reason, tenantId);
			result.archivedActivityIds = ids;
		}
	}

	// --- Checklist Templates (per child) ---
	if (limits.maxChecklistTemplates !== null) {
		// 非アーカイブの全子供のテンプレートを確認
		const children = await findAllChildren(tenantId);
		// アーカイブされた子供のテンプレートは無視
		for (const child of children) {
			const templates = await findTemplatesByChild(child.id, tenantId, true);
			if (templates.length > limits.maxChecklistTemplates) {
				const sorted = [...templates].sort((a, b) => compareOpaqueIdAsc(a.id, b.id));
				const excess = sorted.slice(limits.maxChecklistTemplates);
				const ids = excess.map((t) => t.id);
				await archiveChecklistTemplates(ids, reason, tenantId);
				result.archivedChecklistTemplateIds.push(...ids);
			}
		}
	}

	return result;
}

/**
 * 復元対象の reason を **型で網羅させる** ための表 (#4585-3)。
 *
 * `ArchivedReason` に値が増えたとき、本表に足さないとコンパイルが通らない。復元の取りこぼしは
 * 「再契約したのに記録が戻らない」として顧客に出るが、書き忘れても何も落ちないため
 * (`dunning_canceled` が実際にその状態だった) 型で気づかせる。
 * 実行時の網羅は `tests/unit/services/resource-archive-service.test.ts` が
 * `ARCHIVED_REASONS` を読んで assert する (表に足しただけで呼んでいない場合を捕まえる)。
 */
const RESTORE_TARGET_REASONS: Record<ArchivedReason, true> = {
	trial_expired: true,
	downgrade_user_selected: true,
	dunning_canceled: true,
};

/**
 * アップグレード時に archive されたリソースを **全 reason** について復元する。
 *
 * 呼び出しをループにせず reason ごとに展開している。ループ内の逐次 write は ADR-0065 原則 2 の
 * ratchet (`tests/unit/architecture/dsql-loop-sequential-write-fitness.test.ts`) が数える対象で、
 * 発行する txn 数は展開形と同じ (reason × 3 資源) ため、形だけ loop にして計上を増やさない。
 */
export async function restoreArchivedResources(tenantId: string): Promise<void> {
	void RESTORE_TARGET_REASONS; // 型で網羅を強制するためだけの表 (値は使わない)

	// #783: 体験終了で archive されたリソース
	await restoreArchivedChildren('trial_expired', tenantId);
	await restoreArchivedActivities('trial_expired', tenantId);
	await restoreArchivedChecklistTemplates('trial_expired', tenantId);
	// #738: 顧客自身が選んで archive したリソース
	await restoreArchivedChildren('downgrade_user_selected', tenantId);
	await restoreArchivedActivities('downgrade_user_selected', tenantId);
	await restoreArchivedChecklistTemplates('downgrade_user_selected', tenantId);
	// #4585-3: 支払い失敗で archive されたリソース (支払い手段を直して再契約したら戻す)
	await restoreArchivedChildren('dunning_canceled', tenantId);
	await restoreArchivedActivities('dunning_canceled', tenantId);
	await restoreArchivedChecklistTemplates('dunning_canceled', tenantId);
}

/**
 * archive 済みリソースの概要を返す（UI 表示用）。
 */
export async function getArchivedResourceSummary(tenantId: string): Promise<{
	archivedChildCount: number;
	hasArchivedResources: boolean;
}> {
	const archivedChildren = await findArchivedChildren(tenantId);
	const count = archivedChildren.length;
	return {
		archivedChildCount: count,
		hasArchivedResources: count > 0,
	};
}

export { ARCHIVE_REASON };
