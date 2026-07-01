// src/lib/server/db/pk-freeze-manifest.ts
// EPIC #3424 / 実装 #3512 (#N0-1) / 設計 SSOT: docs/design/dsql-data-model.md §11.2 / §13.1(fitness#9)
//
// PK 凍結 manifest = §11.2「全テナント表 PK 凍結表」の機械可読 SSOT。
// DSQL は PK = 物理レイアウトで後変更不可 (§P1)。fitness#9 (pk-freeze-manifest.test.ts) が
// drizzle pg/sqlite schema の PK == 本 manifest を CI で hard-fail し、凍結逸脱を機械封鎖する。
// PK 変更は「本 manifest 更新 + migration ADR」を人手強制する唯一の点 (§12.5 zero-user rebuildable)。
//
// governing rule (§11.2, 戦略/PO パネル 2026-07-01): 自然複合 PK 凍結は
//   (a) policy invariant (ADR 参照) or (b) 構造的確実性 に anchor される表のみ。
//   mutable product default だけが根拠の表は UUID PK + droppable UNIQUE (例: certificates)。
//
// ── 段階的 population (Canon TDD triangulate) ──
//   本コミット: children (linchpin) のみ。以後 Phase B/C の各 issue で該当表を追記していく。

export const PK_FREEZE_MANIFEST = {
	// Child 集約 linchpin: child_id は ~20 表の複合 PK 先頭。UUID v4 (§P3 時刻列を PK に入れない)。
	children: ['family_id', 'child_id'],
} as const satisfies Record<string, readonly string[]>;

export type PkFreezeManifest = typeof PK_FREEZE_MANIFEST;
