// src/lib/features/admin/downgrade-dialog-policy.ts (#4530)
//
// ダウングレード確認ダイアログ (`DowngradeResourceSelector`) を Stripe の確認へ進む前に
// 開くかどうかの判定。
//
// # なぜ関数に切り出すか
//
// 判定はもともと `SaasLicensePanel.requestPortal()` の中に `preview?.hasExcess` と書かれていた。
// ダイアログの中身は `hasExcess`（リソース数が上限超過）と `willLoseHistory`（保持期間が短縮）の
// **独立した 2 条件**を前提に書かれているのに、開く側が前者だけを見ていたため、
// 「超過は無いが保持期間は縮む」顧客には警告が 1 つも出ないまま不可逆な確定へ進み、
// `retention-cleanup-service` が保持期間を超えた記録を物理削除していた (#4530)。
//
// svelte component 内の分岐は unit test から直接呼べないため、判定だけを純関数として
// ここに置き、4 通りの組み合わせと「component 側の分岐が到達可能であること」を
// `tests/unit/features/admin/downgrade-dialog-reachability.test.ts` が機械検証する。

import type { DowngradePreview } from '$lib/domain/downgrade-types';

/**
 * ダウングレード確認ダイアログを開くべきか。
 *
 * **顧客が何かを失うときは必ず開く**（= `DowngradeResourceSelector` が扱う 2 条件の論理和）:
 *
 * | `hasExcess` | `willLoseHistory` | 判定 | ダイアログが述べること |
 * |---|---|---|---|
 * | true | true | 開く | 超過リソースの選択 + 保持期間短縮の警告 |
 * | true | false | 開く | 超過リソースの選択 |
 * | false | true | 開く | 保持期間短縮の警告 (#4530 でここが開かれるようになった) |
 * | false | false | 開かない | 失うものが無いので確認を挟まない (無用なダイアログを増やさない) |
 *
 * preview の取得自体に失敗した (null) 場合は開かない。取得失敗は
 * `SaasLicensePanel` 側が `downgradeError` として別に扱う。
 */
export function shouldOpenDowngradeSelector(preview: DowngradePreview | null): boolean {
	if (!preview) return false;
	return preview.hasExcess || preview.retentionChange.willLoseHistory;
}
