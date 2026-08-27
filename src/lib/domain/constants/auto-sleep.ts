// src/lib/domain/constants/auto-sleep.ts
// 使いすぎ防止タイマー（自動スリープ）のしきい値 SSOT (#4713)。
//
// 背景:
//   しきい値は `src/routes/(child)/+layout.svelte` のローカル定数として持たれており、
//   LP / FAQ 側の説明文（labels.ts）は数値も挙動も手書きだった。その結果
//   「15 分の無操作で画面が自動で閉じる」という**挙動が逆**の説明が LP・FAQ に残り、
//   保護者が「放置すれば勝手に閉じる」と理解する状態になっていた（実装は放置では閉じない）。
//   値と挙動の唯一の定義をここに置き、実装（child layout）と表示（terms.ts → labels.ts → LP）
//   の両方がここから引く。
//
// 実挙動（`src/lib/features/auto-sleep.ts`）:
//   - 1 秒ごとに「直近操作から INACTIVE_RESET 未満なら操作中」とみなし累積時間を +1 秒する
//   - 累積が ACTIVE に達したら `/switch`（お子さま選択画面）へ戻す
//   - 直近操作から INACTIVE_RESET 以上経過していれば累積は 0 にリセットされる
//     → **無操作で放置しても画面は閉じない。「連続で使い続けた時間」だけが対象**
//   - バトル中のみ BATTLE_GRACE ぶん猶予を足す
//
// 関連: ADR-0012 (Anti-engagement) / ADR-0013 (LP 文言は実装の事実を SSOT とする)
//       ADR-0045 (terms.ts atom / labels.ts compound)

/** 連続利用がこの分数に達すると `/switch` に戻る。 */
export const AUTO_SLEEP_ACTIVE_MINUTES = 15;

/** 直近操作からこの分数だけ間が空くと、連続利用の累積が 0 に戻る。 */
export const AUTO_SLEEP_INACTIVE_RESET_MINUTES = 1;

/** バトル中だけ上乗せされる猶予（分）。 */
export const AUTO_SLEEP_BATTLE_GRACE_MINUTES = 2;

/** 分 → ミリ秒。実装側（child layout / auto-sleep.ts）はこちらを使う。 */
export const AUTO_SLEEP_ACTIVE_MS = AUTO_SLEEP_ACTIVE_MINUTES * 60 * 1000;
export const AUTO_SLEEP_INACTIVE_RESET_MS = AUTO_SLEEP_INACTIVE_RESET_MINUTES * 60 * 1000;
export const AUTO_SLEEP_BATTLE_GRACE_MS = AUTO_SLEEP_BATTLE_GRACE_MINUTES * 60 * 1000;
