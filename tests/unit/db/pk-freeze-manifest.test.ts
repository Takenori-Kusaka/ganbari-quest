// tests/unit/db/pk-freeze-manifest.test.ts
// EPIC #3424 / 実装 #3512 (#N0-1) / 設計 SSOT: docs/design/dsql-data-model.md §11.2 / §13.1(fitness#9)
//
// fitness#9「PK-freeze drift manifest」(ADR-0061 §結果: §P1 唯一の不可逆不変条件を機械強制):
//   DSQL は PK = 物理レイアウトで後変更不可 (§P1)。よって設計書 §11.2 の凍結 PK 表を
//   機械可読な manifest (SSOT) に写経し、drizzle schema の PK が manifest と一致することを
//   CI で hard-fail する。凍結逸脱を人手 review に委ねない (route-db-boundary.test.ts #3152 と同型)。
//   PK 変更は「manifest 更新 + migration ADR」を人手で強制する唯一の点として残す (§12.5)。
//
// ── Canon TDD test list (t-wada / List→Red→Green→Refactor) ──
//   [1] manifest が存在し children の PK = (family_id, child_id) を宣言する        ← 本 red
//   [2] manifest の全テナント表 PK が §11.2 の凍結 PK と一致する (自然複合/UUID 昇格)
//   [3] drizzle pg-core schema の各表 PK == manifest (schema→manifest drift 検出)
//   [4] drizzle sqlite-core schema の各表 PK == manifest (両 backend で同一論理 PK)
//   [5] グローバル master (categories(code) 等) / auth (users(user_id) 等) は family_id 先頭でない例外
//   [3][4] は pg/sqlite schema 実装後 (#3512 green) に triangulate で追加する。
//
// 本ファイルは red-first (schema/manifest 未実装で fail)。green = manifest + children DDL 実装。

import { describe, expect, it } from 'vitest';

describe('fitness#9: PK 凍結 manifest (§11.2 / §P1 不可逆不変条件)', () => {
	it('[1] manifest が存在し children の PK = (family_id, child_id) を宣言する', async () => {
		// red: manifest module は #3512 green で新設する。現状は存在せず import が throw する。
		const mod = await import('../../../src/lib/server/db/pk-freeze-manifest');
		const manifest = mod.PK_FREEZE_MANIFEST as Record<string, readonly string[]>;

		// children は child_id が ~20 表の複合 PK 先頭の linchpin (§12.2.1 I-1)。
		// UUID v4 child_id (§P3 時刻列を PK に入れない) + family_id 先頭 (§P2 複合 tenant PK)。
		expect(manifest.children).toEqual(['family_id', 'child_id']);
	});
});
