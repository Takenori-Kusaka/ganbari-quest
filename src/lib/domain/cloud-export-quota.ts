// src/lib/domain/cloud-export-quota.ts
// クラウド保管枠 (#4767 PO 回答 #3): 「枠を占有している行」を顧客に見せ、消せるようにするための純粋関数。
//
// 枠の母集団は **期限内の全行** (状態 / DL 回数を問わない、PII ZIP の天井を残す PO 判断)。
// 旧実装は DL 回数を使い切った行を一覧から落としていたため、「保管枠 2 / 3」と表示されながら
// 3 件目で 403 になり、顧客はどれを消せばよいか分からなかった。本 module は
//   - 行の表示状態 (ダウンロード可能 / 使い切り / 失敗 / 生成待ち / 生成中)
//   - 自動削除までの残日数 (JST 暦日、TZ 非依存)
//   - 枠が満杯のときに「消す候補」を名指しする順序
// を 1 箇所で決め、service (403 文言) と画面 (一覧) が同じ判定を使う。

import type { CloudExportStatus } from '$lib/domain/constants/cloud-export-status';
import { daysBetweenJST, jstDateOfIso, toJSTDateString } from '$lib/domain/date-utils';
import { SETTINGS_LABELS } from '$lib/domain/labels';

/** 一覧の 1 行に付く表示状態。`CloudExportStatus` (build 状態機械) に DL 回数の消費を重ねたもの。 */
export type CloudExportRowState = 'downloadable' | 'exhausted' | 'failed' | 'pending' | 'building';

/** 行状態 → 表示ラベル (PO 回答 #3 の 4 語 + 既存の生成待ち / 生成中)。画面と 403 文言が共有する。 */
export function cloudRowStateLabel(state: CloudExportRowState): string {
	switch (state) {
		case 'downloadable':
			return SETTINGS_LABELS.cloudRowStateDownloadable;
		case 'exhausted':
			return SETTINGS_LABELS.cloudRowStateExhausted;
		case 'failed':
			return SETTINGS_LABELS.cloudRowStateFailed;
		case 'pending':
			return SETTINGS_LABELS.cloudStatusPending;
		case 'building':
			return SETTINGS_LABELS.cloudStatusBuilding;
	}
}

/**
 * 画面の一覧 1 行 (API `GET /api/v1/export/cloud` の `exports[]` が返す形)。
 * server の `CloudExportListItem` (record 全体) のうち、画面が読む field だけを client 側の型にする。
 */
export interface CloudExportStoredRow {
	id: string;
	exportType: string;
	pinCode: string;
	expiresAt: string;
	createdAt: string;
	description: string | null;
	downloadCount: number;
	maxDownloads: number;
	status: CloudExportStatus;
	failureReason: string | null;
	rowState: CloudExportRowState;
	daysUntilAutoDelete: number;
}

export interface CloudExportRowStateInput {
	/** 旧行 (backfill 前) は null / undefined になりうる。'ready' 扱い。 */
	status: CloudExportStatus | null | undefined;
	downloadCount: number;
	maxDownloads: number;
}

/** 行の表示状態を決める。ready で DL 回数を使い切った行だけが 'exhausted'。 */
export function resolveCloudExportRowState(row: CloudExportRowStateInput): CloudExportRowState {
	const status = row.status ?? 'ready';
	if (status === 'pending' || status === 'building' || status === 'failed') return status;
	return row.downloadCount >= row.maxDownloads ? 'exhausted' : 'downloadable';
}

/**
 * 自動削除 (期限切れ cleanup) までの残日数を JST 暦日で返す (0 以上)。
 * `expiresAt` は UTC ISO (DB 保存値)。ローカル TZ の getter は使わない (#4015 JST SSOT)。
 */
export function cloudExportDaysUntilAutoDelete(expiresAt: string, now: Date): number {
	const days = daysBetweenJST(toJSTDateString(now), jstDateOfIso(expiresAt));
	return Math.max(0, days);
}

export interface CloudExportDeleteCandidateInput {
	status: CloudExportStatus | null | undefined;
	downloadCount: number;
	maxDownloads: number;
	/** UTC ISO。古いものほど先に候補になる。 */
	createdAt: string;
}

/** 消す候補の優先度 (小さいほど先に名指しする)。失敗 → 使い切り → それ以外 (作成日が古い順)。 */
const DELETE_CANDIDATE_RANK: Record<CloudExportRowState, number> = {
	failed: 0,
	exhausted: 1,
	downloadable: 2,
	pending: 2,
	building: 2,
};

/**
 * **消しても失うものが無い**行か (#4767 QM must)。
 *
 * `failed` = 取り出せる成果物が無い / `exhausted` = ダウンロード回数を使い切っていてもう取り出せない。
 * この 2 つは削除しても顧客は何も失わないので、枠が満杯のときに真っ先に名指ししてよい。
 * それ以外 (`downloadable` / `pending` / `building`) は**まだ取り出せる (これから取り出せる) 共有**で、
 * 削除は取り消せないため「候補」として同列に並べない。
 */
export function isDisposableCloudExportRow(state: CloudExportRowState): boolean {
	return state === 'failed' || state === 'exhausted';
}

/**
 * 枠が満杯のときに「どれを消せばいいか」を名指しする順に並べ替える (入力は変更しない)。
 *
 * 失敗行 (取り出せるものが無い) → DL 回数を使い切った行 (もう取り出せない) → 残りは作成日が古い順。
 * 同順位は createdAt 昇順で安定させる。
 *
 * **呼び出し側は `isDisposableCloudExportRow` で 2 群に分けてから使う** (#4767 QM must):
 * 消しても損の無い行が 1 つでもあればそれだけを候補にし、1 つも無いときだけ
 * 「まだ取り出せる共有しか無い」と明示したうえで古い順に挙げる。
 */
export function rankCloudExportDeleteCandidates<T extends CloudExportDeleteCandidateInput>(
	rows: readonly T[],
): T[] {
	return [...rows].sort((a, b) => {
		const rankDiff =
			DELETE_CANDIDATE_RANK[resolveCloudExportRowState(a)] -
			DELETE_CANDIDATE_RANK[resolveCloudExportRowState(b)];
		if (rankDiff !== 0) return rankDiff;
		return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
	});
}
