// src/lib/server/services/activity-quota.ts (#4693)
//
// **カスタム活動の上限を「取込の実書き込み直前」で一元強制する。**
//
// # なぜ独立した強制点にするか
//
// 上限判定 (`checkActivityLimit`) は各 route の action が個別に呼ぶ形だった。手動追加 /
// 一括追加 / 別の子からコピー / テンプレ取込には gate があったが、**ファイル復元
// (`?/importFile`) にだけ無く**、無料プランの上限 3 件に達したテナントが CSV / JSON を
// 用意すれば 119 件でも取り込めた (#4693 実測。#2894 / #3740 に続く同 class 3 件目)。
//
// 「経路ごとに gate を書く」設計では、経路が増えるたびに書き忘れが再発する。`dispatchImport`
// 経由の取込が全て通る `importActivities` の直前でここを通すことで、**取込経路を足しても
// 素通りできない**構造にする。
//
// # 母集団は custom だけ (PO 回答 2026-09-03 #1)
//
// 分母 (`countQuotaActivities`、plan-limit-service) も分子 (本 module の計画側) も
// activity-source.ts (#3669 SSOT) の `countsTowardActivityQuota` = 親が手で作った `custom` だけを
// 数える。プリセット取込 (`seed`) / 初期 seed / archived 行は数えない。route gate と本 module が
// **同じ 1 関数を分母にする**ことで、片方だけがプリセット取込を 403 にするずれを作らない。
//
// # 覆う経路 / 覆わない経路 (境界を書いておかないと再発する)
//
// - 本 module が覆う (drop 方式 `enforceActivityQuota`): `dispatchImport` → activity-pack strategy →
//   `importActivities` を通る取込 (marketplace 取込 / ファイル復元 `?/importFile` /
//   `api/v1/activities/import` の merge)。プリセット取込は `seed` 行なので計画側で 0 行に数えられ、
//   3/3 到達後も通る。admin の `importPack` / `importPackToChildren` action は route 側の
//   `checkActivityLimit` を**通さない** (旧実装は通していたため 3/3 でテンプレ取込が 403 になっていた)
// - action 側の `checkActivityLimit` が止める: 手動追加 (`createActivity`) / 一括追加 /
//   別の子からコピー / ファイル内容の取込 (`api/v1/activities/import` merge = custom 行)。
//   両者は同じ `getPlanLimits().maxActivities` と同じ `countQuotaActivities` を読む
// - 本 module が覆う (archive 方式 `archiveActivityQuotaOverflow`、PO 回答 2026-09-03 #2):
//   バックアップ ZIP / JSON の全体復元 (`import-service.ts` の `importChildActivitiesData`) と
//   クラウドテンプレート取込 (`api/v1/import/cloud`)。復元は顧客のデータを落とせないので、
//   超過分は捨てずに `isArchived=1` で取り込み、アップグレードで自動復帰させる
//   (ダウングレード時の archive と同じ意味論 = `restoreArchivedResources` が戻す reason を使う)
//
// 上の対応づけは tests/unit/architecture/activity-quota-all-producers-gated.test.ts が機械強制する
// (child_activities を新しく作る呼び出し箇所を列挙し、各経路の gate 位置を registry で宣言する。
// 新しい producer を足すと registry 未宣言で落ちる = no-silent-gap)。

import { ACTIVITY_SOURCES, countsTowardActivityQuota } from '$lib/domain/activity-source';
import type { ArchivedReason } from '$lib/domain/archive-types';
import { PLAN_UPGRADE_URL } from '$lib/domain/errors';
import type { ChildId } from '$lib/domain/ids';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import { resolveTenantEntitlement } from '$lib/server/auth/tenant-entitlement';
import type { InsertChildActivityInput } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';
import { countQuotaActivities, getPlanLimits, resolveFullPlanTier } from './plan-limit-service';

/**
 * 復元で上限を超えた分を archived にするときの `archived_reason` (#4693 PO 回答 #2)。
 *
 * `downgrade_user_selected` を使う理由:
 * - `restoreArchivedResources` (有料契約の webhook で全 reason を復元) の対象なので、
 *   「アップグレードで使えます」の約束がそのまま成立する
 * - `getRetentionDays` が null (自動物理削除しない)。`trial_expired` / `dunning_canceled` は
 *   90 日で物理削除されるため、顧客が自分で復元したデータに使うと 90 日後に消える
 * - `ARCHIVED_REASONS` (schema の enum 制約 / DSQL の CHECK) を増やさない。専用 reason を足すなら
 *   DB スキーマ変更を伴うため、PO / QM の別判断とする (PR body に記載)
 */
export const RESTORE_OVER_QUOTA_ARCHIVED_REASON: ArchivedReason = 'downgrade_user_selected';

export interface ActivityQuotaEnforcement {
	/** 上限超過で取込対象から外した活動名 */
	rejectedNames: Set<string>;
	/**
	 * 上限超過で取込対象から外した **行数** (child × activity)。
	 *
	 * quota の単位は行数なので、顧客に伝える「入らなかった数」も行数で数える
	 * (名前の数で数えると、2 人の子に配る取込で実際に落とした量と食い違う)。
	 */
	rejectedRows: number;
	/** 顧客に見せる理由 (`rejectedRows` が 0 なら空文字) */
	message: string;
	/** プラン上限が理由のときのアップグレード導線 (それ以外は null) */
	upgradeUrl: string | null;
}

/** 復元で超過分を archived にした理由。`plan_limit` = 上限超過 / `plan_unverifiable` = プラン不明 (fail-closed) */
export type ActivityQuotaArchiveReason = 'plan_limit' | 'plan_unverifiable';

/**
 * 復元 (backup / クラウド取込) の quota 結果 (#4693 PO 回答 #2)。
 *
 * 顧客に「入った数 / 入らなかった数 / 理由 / 次の行動」を必ず出すための channel。
 * 単位は quota と同じ **行数** (child × activity、custom かつ非 archived の行だけ)。
 * seed / curriculum / もともと archived の行は数えない (= `total` に入らない)。
 */
export interface ActivityQuotaArchiveOutcome {
	/** 復元対象だった quota 対象行数 (= activated + archived) */
	total: number;
	/** 有効な状態 (isArchived=0) で書く行数 */
	activated: number;
	/** 上限のため isArchived=1 で書く行数 */
	archived: number;
	/** `archived > 0` のときの理由 (0 なら null) */
	reason: ActivityQuotaArchiveReason | null;
	/** 顧客に見せる理由文 (`archived` が 0 なら空文字) */
	message: string;
	/** プラン上限が理由のときのアップグレード導線 (それ以外は null) */
	upgradeUrl: string | null;
}

/** 計画に対する quota の判定 (drop / archive どちらの適用でも同じ判定を使う)。 */
type QuotaVerdict =
	| { kind: 'unlimited' }
	| { kind: 'unverifiable' }
	| {
			kind: 'limited';
			max: number;
			current: number;
			remaining: number;
			plannedRows: number;
			keptRows: number;
			/** 残枠に収まらなかった活動名 (空なら全件入る) */
			rejectedNames: Set<string>;
	  };

/**
 * 上限を超える分を **書き込み計画から取り除く** (取込経路用)。
 *
 * - 上限なし (standard / family / local / demo) → 何もしない
 * - 残枠 n 行 → 計画のうち n 行に収まる分だけ残し、超過分は全 child の計画から削除する
 *   (「余裕のある分は入る」— 1 件でも超えたら全部落とす、にはしない)
 *
 * # 単位は「行数」であって「活動名の数」ではない
 *
 * quota の正準単位は **per-child 行数**である (`countQuotaActivities` は全 child の
 * `child_activities` 行を合算して `maxActivities` と比べる)。ここで名前の集合数を残枠と
 * 比べると、**同じ 3 名を 2 人の子に取り込んだとき `3 <= 3` を素通りして 6 行書かれ**、
 * 上限 3 のテナントが 6 件保持できてしまう (= 本 gate が塞いだはずの class の再生産)。
 * したがって残枠の消費は「その名前が何人の子に新規計画されたか」で数える。
 *
 * 落とす粒度は **名前単位**に保つ (行単位で削ると「ある子には入ったが別の子には入らない」
 * 非対称な状態になり、顧客に説明できない)。残枠に収まらない名前は全 child の計画から外し、
 * `PLAN_GATE_LABELS.activityLimitReached` で理由を返す。
 *
 * プラン解決は request context ではなく `resolveTenantEntitlement(tenantId)` (DB) を使う。
 * 呼び出し側が licenseStatus を渡し忘れて gate が無効化される経路を作らないため。
 */
export async function enforceActivityQuota(
	tenantId: string,
	childInputsByChild: Map<ChildId, InsertChildActivityInput[]>,
	plannedNewNames: Set<string>,
): Promise<ActivityQuotaEnforcement> {
	const empty: ActivityQuotaEnforcement = {
		rejectedNames: new Set(),
		rejectedRows: 0,
		message: '',
		upgradeUrl: null,
	};
	if (plannedNewNames.size === 0) return empty;

	const verdict = await judgeActivityQuota(tenantId, childInputsByChild, plannedNewNames);
	if (verdict.kind === 'unlimited') return empty;

	if (verdict.kind === 'unverifiable') {
		// プラン解決 / 現在数の取得ができない (DB 障害等) ときは **取り込まない**。ここで握り潰して
		// 通すと、障害中だけ上限が消える経路になる (fail-closed、ADR-0006)。
		const rejectedNames = new Set(plannedNewNames);
		const rejectedRows = countPlannedRows(childInputsByChild);
		dropNames(childInputsByChild, plannedNewNames, rejectedNames);
		return {
			rejectedNames,
			rejectedRows,
			message: PLAN_GATE_LABELS.planUnverifiableImportAborted,
			// プラン不明での中止はアップグレードでは解消しない (再試行を促す文言のみ)。
			upgradeUrl: null,
		};
	}

	if (verdict.rejectedNames.size === 0) return empty;
	dropNames(childInputsByChild, plannedNewNames, verdict.rejectedNames);

	const rejectedRows = verdict.plannedRows - verdict.keptRows;
	logger.info('[activity-quota] 上限超過分を取込対象から除外しました', {
		context: {
			tenantId,
			max: verdict.max,
			current: verdict.current,
			remaining: verdict.remaining,
			plannedRows: verdict.plannedRows,
			keptRows: verdict.keptRows,
			rejectedRows,
			rejected: verdict.rejectedNames.size,
		},
	});

	return {
		rejectedNames: verdict.rejectedNames,
		rejectedRows,
		message: PLAN_GATE_LABELS.activityLimitReached(verdict.max),
		upgradeUrl: PLAN_UPGRADE_URL,
	};
}

/**
 * 上限を超える分を **捨てずに archived (isArchived=1) として書く計画に変える** (復元経路用、
 * #4693 PO 回答 2026-09-03 #2)。
 *
 * 判定 (残枠 / 名前単位 / 行数単位) は `enforceActivityQuota` と同じ `judgeActivityQuota` を使い、
 * 適用だけが違う: 残枠に収まらない名前の quota 対象行 (custom かつ非 archived) を
 * `isArchived=1` + `RESTORE_OVER_QUOTA_ARCHIVED_REASON` に書き換える。seed / curriculum /
 * もともと archived の行は quota を消費しないので触らない。
 *
 * - 上限なし → 何もしない (`archived=0`、`reason=null`)
 * - プランを確認できない (DB 障害等) → **全 quota 対象行を archived にする** (fail-closed)。
 *   取込 (`enforceActivityQuota`) は中止で済むが、復元は顧客のデータを落とせないため
 *   「入れるが有効化はしない」に倒す。有料契約の webhook で自動復帰する
 *
 * 呼び出し側は戻り値の `total` / `activated` / `archived` / `reason` を顧客向け結果に必ず出す
 * (「復元しました」だけで黙って archived にしない)。
 */
export async function archiveActivityQuotaOverflow(
	tenantId: string,
	childInputsByChild: Map<ChildId, InsertChildActivityInput[]>,
	plannedNewNames: Set<string>,
): Promise<ActivityQuotaArchiveOutcome> {
	const total = countPlannedRows(childInputsByChild);
	const nothing: ActivityQuotaArchiveOutcome = {
		total,
		activated: total,
		archived: 0,
		reason: null,
		message: '',
		upgradeUrl: null,
	};
	if (plannedNewNames.size === 0 || total === 0) return nothing;

	const verdict = await judgeActivityQuota(tenantId, childInputsByChild, plannedNewNames);
	if (verdict.kind === 'unlimited') return nothing;

	if (verdict.kind === 'unverifiable') {
		const archived = markArchived(childInputsByChild, plannedNewNames);
		return {
			total,
			activated: total - archived,
			archived,
			reason: 'plan_unverifiable',
			message: PLAN_GATE_LABELS.planUnverifiableRestoreArchived(archived),
			upgradeUrl: null,
		};
	}

	if (verdict.rejectedNames.size === 0) return nothing;
	const archived = markArchived(childInputsByChild, verdict.rejectedNames);
	logger.info('[activity-quota] 上限超過分を archived として復元します', {
		context: {
			tenantId,
			max: verdict.max,
			current: verdict.current,
			remaining: verdict.remaining,
			plannedRows: verdict.plannedRows,
			keptRows: verdict.keptRows,
			archived,
			rejected: verdict.rejectedNames.size,
		},
	});
	return {
		total,
		activated: total - archived,
		archived,
		reason: 'plan_limit',
		message: PLAN_GATE_LABELS.activityLimitReached(verdict.max),
		upgradeUrl: PLAN_UPGRADE_URL,
	};
}

/**
 * 計画に対する quota 判定 (drop / archive 共通)。
 *
 * 3 つの DB 呼び出し (entitlement / tier / 現在数) をまとめて包む。現在数の 1+N 読み取りが
 * 最も transient に当たりやすく、ここが catch の外だと form action の 500 に突き抜けて
 * 「再試行してください」も結果も出ない dead-end になる (QM #4784 レビュー)。
 */
async function judgeActivityQuota(
	tenantId: string,
	childInputsByChild: Map<ChildId, InsertChildActivityInput[]>,
	plannedNewNames: Set<string>,
): Promise<QuotaVerdict> {
	let max: number | null;
	let current: number;
	try {
		const entitlement = await resolveTenantEntitlement(tenantId);
		const limits = getPlanLimits(
			await resolveFullPlanTier(tenantId, entitlement.licenseStatus, entitlement.plan),
		);
		max = limits.maxActivities;
		if (max === null) return { kind: 'unlimited' };
		current = await countQuotaActivities(tenantId);
	} catch (e) {
		logger.error('[activity-quota] プランを確認できないため上限超過として扱います', {
			error: e instanceof Error ? e.message : String(e),
			context: { tenantId },
		});
		return { kind: 'unverifiable' };
	}
	const remaining = Math.max(0, max - current);
	const plannedRows = countPlannedRows(childInputsByChild);
	if (plannedRows <= remaining) {
		return {
			kind: 'limited',
			max,
			current,
			remaining,
			plannedRows,
			keptRows: plannedRows,
			rejectedNames: new Set(),
		};
	}

	// 残枠に収まる名前だけを残す。1 名の消費量は「その名前を新規計画した child の数」。
	const rowsByName = countRowsByName(childInputsByChild);
	const rejectedNames = new Set<string>();
	let keptRows = 0;
	for (const name of plannedNewNames) {
		const rows = rowsByName.get(name) ?? 0;
		// 収まらない名前は飛ばして次を見る (後続に 1 child 分だけの安い名前があれば入る)。
		if (keptRows + rows <= remaining) keptRows += rows;
		else rejectedNames.add(name);
	}
	return { kind: 'limited', max, current, remaining, plannedRows, keptRows, rejectedNames };
}

/** 名前単位で計画から外す (drop 方式)。`plannedNewNames` からも外す。 */
function dropNames(
	childInputsByChild: Map<ChildId, InsertChildActivityInput[]>,
	plannedNewNames: Set<string>,
	rejectedNames: Set<string>,
): void {
	for (const [childId, inputs] of childInputsByChild) {
		childInputsByChild.set(
			childId,
			inputs.filter((i) => !rejectedNames.has(i.name)),
		);
	}
	for (const name of rejectedNames) plannedNewNames.delete(name);
}

/**
 * 名前単位で quota 対象行を archived に書き換える (archive 方式)。戻り値は書き換えた行数。
 * 計画からは外さない (行は書く。`plannedNewNames` も不変)。
 */
function markArchived(
	childInputsByChild: Map<ChildId, InsertChildActivityInput[]>,
	names: Set<string>,
): number {
	let archived = 0;
	for (const inputs of childInputsByChild.values()) {
		for (const input of inputs) {
			if (!names.has(input.name) || !rowCountsTowardQuota(input)) continue;
			input.isArchived = 1;
			input.archivedReason = RESTORE_OVER_QUOTA_ARCHIVED_REASON;
			archived += 1;
		}
	}
	return archived;
}

/**
 * quota に数える行かどうか。母集団は activity-source.ts (#3669 SSOT) の `countsTowardQuota`:
 * 親が自分で作った `custom` だけを数え、プリセット / 初期 seed (`seed` / `curriculum`) は数えない
 * (LP の約束は「オリジナル活動の作成：3個まで」「プリセットを使って無料で始められます」)。
 * `source` 未指定は repo 既定 `seed` に落ちるので、ここでも seed として扱う。
 */
function rowCountsTowardQuota(input: InsertChildActivityInput): boolean {
	// 分母 (`countQuotaActivities` / `checkActivityLimit`) は archived 行を数えないので、計画側も
	// 数えない。無料へ戻った世帯は超過分をアーカイブして残す仕様 (archiveFallbackRule) のため、
	// backup には archived custom 行が多く、ここで数えると復元で残枠を食い潰して捨てられる (QM #4784)。
	if (input.isArchived === 1) return false;
	return countsTowardActivityQuota(input.source ?? ACTIVITY_SOURCES.seed.value);
}

/**
 * 取込で新しく書く quota 対象行数 (child × activity、`custom` のみ)。
 *
 * seed 行を数えると、無料世帯のバックアップ全体復元 (初期 seed 20 件 + custom 3 件) や
 * 10 件の活動セット取込が「残枠 3 行」で切り詰められ、LP の「プリセットは無料」と食い違う。
 * 逆に custom 行を数えないと、JSON/CSV 復元で上限を素通りする (#4693 症状 1)。
 * どの経路でも「custom 行 <= 残枠」の 1 つの規則で判定する。
 */
function countPlannedRows(childInputsByChild: Map<ChildId, InsertChildActivityInput[]>): number {
	let rows = 0;
	for (const inputs of childInputsByChild.values()) {
		for (const input of inputs) if (rowCountsTowardQuota(input)) rows += 1;
	}
	return rows;
}

/** 活動名ごとの quota 対象行数 (= その名前を custom として新規計画した child の数)。 */
function countRowsByName(
	childInputsByChild: Map<ChildId, InsertChildActivityInput[]>,
): Map<string, number> {
	const rowsByName = new Map<string, number>();
	for (const inputs of childInputsByChild.values()) {
		for (const input of inputs) {
			if (!rowCountsTowardQuota(input)) continue;
			rowsByName.set(input.name, (rowsByName.get(input.name) ?? 0) + 1);
		}
	}
	return rowsByName;
}
