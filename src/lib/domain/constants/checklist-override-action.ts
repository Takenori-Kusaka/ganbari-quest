// src/lib/domain/constants/checklist-override-action.ts
// チェックリスト日次 override の操作種別 SSOT (#3424 DSQL 移管で runtime 配列化)。
// 'add' = その日だけ項目を追加 / 'remove' = その日だけ項目を除外。
// DSQL checklist_overrides.action の CHECK 生成 (fitness#13) と service 層の分岐が共有する。

export const CHECKLIST_OVERRIDE_ACTIONS = ['add', 'remove'] as const;
export type ChecklistOverrideAction = (typeof CHECKLIST_OVERRIDE_ACTIONS)[number];
