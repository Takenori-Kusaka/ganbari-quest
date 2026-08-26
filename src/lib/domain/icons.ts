// src/lib/domain/icons.ts
// #0289: アイコン・ラベル定数の一元管理
// 新しいアイコンを追加する際は必ずこのファイルの定数を使用すること。

// ============================================================
// ナビゲーションアイコン
// ============================================================

/** ホーム画面 */
export const ICON_HOME = '🏠';
/** つよさ / ステータス */
export const ICON_STATUS = '⭐';
/** きろく / 記録（履歴） */
export const ICON_HISTORY = '📋';
/** チャレンジきろく */
export const ICON_ACHIEVEMENTS = '🏆';
/** バトル (#4681: elementary 以上の CharacterTabs 入口。baby / preschool は非提供) */
export const ICON_BATTLE = '⚔️';
/** もちものチェック / チェックリスト */
export const ICON_CHECKLIST = '📋';
/** かぞく / メンバー（子供選択） */
export const ICON_SWITCH = '👨‍👩‍👧‍👦';

// #4715: 年齢モード別ラベル (旧 MODE_LABELS / getModeLabels) は `labels.ts` の
// `CHILD_NAV_MODE_LABELS` / `getChildNavModeLabels()` に移した。
// icons.ts はアイコン定数の置き場であり、UI 文言の SSOT を 2 箇所に割らないため
// (re-export は biome の noBarrelFile に触れるので置かない。呼び出し側が labels.ts から直接 import する)。
