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
import { jstDateOfIso } from '$lib/domain/date-utils';
import { PLAN_UPGRADE_URL } from '$lib/domain/errors';
import type { ChildId } from '$lib/domain/ids';
import { ACTIVITY_QUOTA_LABELS, PLAN_GATE_LABELS } from '$lib/domain/labels';
import { resolveTenantEntitlement } from '$lib/server/auth/tenant-entitlement';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import type { InsertChildActivityInput } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';
import { countQuotaActivities, getPlanLimits, resolveFullPlanTier } from './plan-limit-service';

/**
 * 復元で上限を超えた分を archived にするときの `archived_reason` (#4693 PO 回答 #2)。
 *
 * # なぜ専用の reason を足さず既存値を流用しているか (QM 再レビュー指摘への回答)
 *
 * 本来は「上限による自動保管」専用の reason を足すべきである。行を見ただけで
 * 「親が自分で選んで保管した」のか「復元が上限で自動保管した」のかが分かる必要があるため。
 * だが `archived_reason` は `ARCHIVED_REASONS` から **DB の CHECK 制約**を生成しており
 * (`dsql/schema.ts` の `child_activities_archived_reason_ck` 等 3 表)、
 * **Aurora DSQL は `ALTER TABLE … ADD CONSTRAINT` を受け付けない (0A000)**。
 * migration transform (`dsql/migration/transform.ts`) もこの文を fail-close で弾く。
 * 前例 (`drizzle/pglite/0007_consents_drop_type_check.sql`) は「CHECK を **外して** アプリ層に
 * 強制を移す」形で、これは制約を弱める schema 判断であり本 PR の scope ではない。
 * → **専用 reason の追加は scope 外の別判断**とし、ここでは既存値を流用する。
 *
 * 流用先に `downgrade_user_selected` を選ぶ理由: `restoreArchivedResources` (有料契約の webhook が
 * 全 reason を復元する) の対象なので「アップグレードで使えます」の約束がそのまま成立する。
 *
 * **`getRetentionDays` を根拠にしない**: 同関数は本番コードから 1 箇所も呼ばれておらず
 * (呼ぶ予定だった retention cron は未実装、`archive-types.ts` の記述どおり)、
 * 「`downgrade_user_selected` なら自動物理削除されない」という保証は**現時点では存在しない**。
 * 以前この module のコメントと PR body がそれを根拠に挙げていたのは誤りだったので撤回する。
 *
 * # 行で区別できない分をどこで担保するか
 *
 * `recordActivityQuotaArchiveMarker` がテナント単位の耐久記録 (settings) を残し、
 * 親の画面 (`/admin/settings/data`) が常設で表示する。ログにしか無い状態にはしない。
 */
export const RESTORE_OVER_QUOTA_ARCHIVED_REASON: ArchivedReason = 'downgrade_user_selected';

/**
 * 上限による自動保管をテナント単位で残す耐久記録の settings キー (#4693 QM 再レビュー)。
 *
 * `EXPORTABLE_SETTING_KEYS` の allowlist に**入れない**。入れると backup 復元のたびに
 * 古い記録で上書きされ、「今回の復元で何件保管したか」が失われる。
 */
export const ACTIVITY_QUOTA_ARCHIVE_MARKER_KEY = 'activity_quota_archive_last';

/** 耐久記録の中身 (JSON 文字列として settings に保存する)。 */
export interface ActivityQuotaArchiveMarker {
	/** 保管した時刻 (ISO8601) */
	at: string;
	/** 保管した行数 */
	archived: number;
	/** 有効な状態で入った行数 */
	activated: number;
	/** 復元対象だった quota 対象行数 */
	total: number;
	/** 保管の理由 */
	reason: ActivityQuotaArchiveReason;
}

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

/**
 * 復元の quota 判定の結果理由 (#4693 QM 再レビューで 1 値 → 3 値に分割)。
 *
 * 旧実装は「プランを確認できない」を 1 つの `plan_unverifiable` にまとめ、**どの読み取りが
 * 落ちても復元を全件保管**していた。現在数の集計 (`countQuotaActivities`) は 1+N 読み取りで
 * transient に最も当たりやすく、そこが 1 回転んだだけで有料世帯の復元が丸ごと無効化され、
 * しかも画面には「無料プランの上限」と出て、自力で戻す導線が無い (アーカイブ解除は課金
 * webhook 経由しか無い) 状態になっていた。原因ごとに倒す向きを変える。
 *
 * - `plan_limit`: 上限を超えた分を保管した (プランも現在数も分かっている)
 * - `usage_unverifiable`: **プランは無料と確定**しているが現在数を数えられなかった →
 *   残枠 0 とみなして保管する (無料世帯なのでアップグレードで自己回復できる)
 * - `plan_unresolved`: **プラン自体が判定できなかった** → 保管しない (上限を適用せず全件有効)。
 *   有料世帯を巻き添えで無効化しない側に倒し、判定を省いたことは顧客に伝える
 */
export type ActivityQuotaArchiveReason = 'plan_limit' | 'usage_unverifiable' | 'plan_unresolved';

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
	/** プラン解決そのものが失敗した (free か有料かも分からない) */
	| { kind: 'plan-unresolved' }
	/** プランは有限上限 (= 無料) と確定したが、現在数の集計が失敗した */
	| { kind: 'count-unresolved'; max: number }
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

	if (verdict.kind === 'plan-unresolved' || verdict.kind === 'count-unresolved') {
		// プラン解決 / 現在数の取得ができない (DB 障害等) ときは **取り込まない**。ここで握り潰して
		// 通すと、障害中だけ上限が消える経路になる (fail-closed、ADR-0006)。
		// 取込 (プリセット) は再試行が無害なので、原因を分けずに中止で揃える。
		// 復元 (`archiveActivityQuotaOverflow`) は「取り込んだうえで保管」なので原因ごとに倒す。
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
 * - 上限なし (有料 / セルフホスト / demo) → 何もしない (`archived=0`、`reason=null`)
 * - **プランを判定できない** (`plan-unresolved`) → **1 行も保管しない**。有料世帯が一時的な読み取り
 *   失敗だけで復元データを全部無効化され、しかも自力で戻す導線が無い (アーカイブ解除は課金 webhook
 *   経由しか無い) 事故を避ける。上限判定を省いたことは `message` で顧客に伝える
 * - **無料と確定したが現在数を数えられない** (`count-unresolved`) → 残枠 0 とみなして保管する。
 *   無料世帯と分かっているのでアップグレードで自己回復できる (導線を併記する)
 *
 * 呼び出し側は戻り値の `total` / `activated` / `archived` / `reason` / `message` を顧客向け結果に
 * 必ず出す (「復元しました」だけで黙って archived にしない)。
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

	if (verdict.kind === 'plan-unresolved') {
		// プランが分からない = この世帯が有料かもしれない。保管に倒すと、有料世帯の復元が
		// まるごと無効化され、画面には「無料プランの上限」と出て、自力の回復手段が無い。
		// 上限を適用せず全件有効で入れ、判定を省いたことだけを伝える (顧客が回復できる側)。
		logger.warn('[activity-quota] プラン不明のため上限を適用せず全件有効で復元します', {
			context: { tenantId, total },
		});
		return {
			total,
			activated: total,
			archived: 0,
			reason: 'plan_unresolved',
			message: PLAN_GATE_LABELS.planUnresolvedRestoreNotCapped,
			upgradeUrl: null,
		};
	}

	if (verdict.kind === 'count-unresolved') {
		// 無料と確定しているが現在数が分からない。残枠 0 とみなして保管する
		// (アップグレードで戻せるので、顧客の回復手段はある)。
		const archived = markArchived(childInputsByChild, plannedNewNames);
		logger.warn('[activity-quota] 利用状況不明のため残枠 0 とみなして保管しました', {
			context: { tenantId, max: verdict.max, total, archived },
		});
		return {
			total,
			activated: total - archived,
			archived,
			reason: 'usage_unverifiable',
			message: PLAN_GATE_LABELS.usageUnverifiableRestoreArchived(archived),
			upgradeUrl: PLAN_UPGRADE_URL,
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
	// try を 2 つに割る (#4693 QM 再レビュー)。1 つに束ねると、どの読み取りが落ちても
	// 同じ「プラン不明」になり、**有料世帯が現在数の 1+N 読み取りの transient だけで**
	// 復元を全件無効化される。原因を型で分けて、呼び出し側が倒す向きを選べるようにする。
	let max: number;
	try {
		const entitlement = await resolveTenantEntitlement(tenantId);
		const limits = getPlanLimits(
			await resolveFullPlanTier(tenantId, entitlement.licenseStatus, entitlement.plan),
		);
		if (limits.maxActivities === null) return { kind: 'unlimited' };
		max = limits.maxActivities;
	} catch (e) {
		logger.error('[activity-quota] プランを判定できませんでした', {
			error: e instanceof Error ? e.message : String(e),
			context: { tenantId },
		});
		return { kind: 'plan-unresolved' };
	}

	// ここに来た時点で「上限のあるプラン (= 無料)」と確定している。有料世帯は上で unlimited に
	// 抜けており、**この 1+N 読み取りには到達しない**。
	let current: number;
	try {
		current = await countQuotaActivities(tenantId);
	} catch (e) {
		logger.error('[activity-quota] 現在のご利用状況を数えられませんでした', {
			error: e instanceof Error ? e.message : String(e),
			context: { tenantId, max },
		});
		return { kind: 'count-unresolved', max };
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

/**
 * 上限による自動保管を **テナント単位の耐久記録** として残す (#4693 QM 再レビュー)。
 *
 * `archived_reason` に専用値を足せない (上記 `RESTORE_OVER_QUOTA_ARCHIVED_REASON` の説明) ため、
 * 行だけを見ると「親が自分で選んで保管した」分と区別が付かない。あとから
 * 「自分で選んだ覚えはない」と言われたときに答えられるよう、**ログではなくデータに**残す。
 *
 * 復元の実書き込みが終わったあとに呼ぶこと (書けていない件数を記録しないため)。
 * 記録の失敗で復元自体を失敗させない (記録は補助情報であり、復元済みデータの方が重要)。
 */
export async function recordActivityQuotaArchiveMarker(
	tenantId: string,
	outcome: ActivityQuotaArchiveOutcome,
): Promise<void> {
	if (outcome.archived <= 0 || outcome.reason === null) return;
	const marker: ActivityQuotaArchiveMarker = {
		at: new Date().toISOString(),
		archived: outcome.archived,
		activated: outcome.activated,
		total: outcome.total,
		reason: outcome.reason,
	};
	try {
		await setSetting(ACTIVITY_QUOTA_ARCHIVE_MARKER_KEY, JSON.stringify(marker), tenantId);
	} catch (e) {
		logger.warn('[activity-quota] 保管の記録を残せませんでした (復元自体は成功)', {
			error: e instanceof Error ? e.message : String(e),
			context: { tenantId, archived: outcome.archived },
		});
	}
}

/**
 * 親の画面に出す「過去の復元で保管した」常設表示の文言を返す (無ければ null)。
 *
 * 日付は JST 暦日で出す (`jstDateOfIso`)。ISO 文字列の slice は UTC 暦日になり、
 * JST 00:00〜09:00 の復元が前日に見える (#4120 と同型)。
 */
export async function getActivityQuotaArchiveNotice(tenantId: string): Promise<string | null> {
	let raw: string | null | undefined;
	try {
		raw = await getSetting(ACTIVITY_QUOTA_ARCHIVE_MARKER_KEY, tenantId);
	} catch (e) {
		logger.warn('[activity-quota] 保管の記録を読めませんでした', {
			error: e instanceof Error ? e.message : String(e),
			context: { tenantId },
		});
		return null;
	}
	if (typeof raw !== 'string' || raw === '') return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const m = parsed as Record<string, unknown>;
	const archived = typeof m.archived === 'number' && m.archived > 0 ? m.archived : 0;
	const at = typeof m.at === 'string' ? m.at : '';
	if (archived === 0 || at === '' || Number.isNaN(new Date(at).getTime())) return null;
	return ACTIVITY_QUOTA_LABELS.pastRestoreArchivedNotice(jstDateOfIso(at), archived);
}
