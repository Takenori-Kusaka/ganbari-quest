// src/lib/domain/constants/checklist-time-slot.ts
// チェックリスト時間帯の固定集合 SSOT (#3424 DSQL 移管で service 層から domain へ移設)。
// 旧所在: checklist-service.ts (service は本 module を re-export し既存 import 互換を維持)。
// DSQL checklist_templates.time_slot の CHECK 生成 (fitness#13) が db 層から参照するため、
// db → service の層逆転 import を避けて domain に置く。

export const VALID_TIME_SLOTS = ['morning', 'afternoon', 'evening', 'anytime'] as const;
export type TimeSlot = (typeof VALID_TIME_SLOTS)[number];
