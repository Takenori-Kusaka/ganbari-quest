// src/lib/domain/constants/oyakagi.ts
// おやカギコード（親向け管理画面ロック）関連の定数
// 用語ラベルは labels.ts の OYAKAGI_LABELS を参照。ここはロジック定数のみ。

/** pin_hash 未設定テナントに対する照合用デフォルト値（がんばり語呂合わせ）。
 * コード公開情報扱い。家庭内軽仕切りの脅威モデルと整合（ADR-0010）。 */
export const DEFAULT_PIN = '5086';
