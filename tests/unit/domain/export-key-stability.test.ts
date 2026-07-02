// tests/unit/domain/export-key-stability.test.ts
// backup DTO の「キー名 = 不変 identity」規律の機械ガード (Protobuf reserved / Avro alias の安価版)。
// export-format.ts で宣言済の Export* フィールド名が RESERVED_EXPORT_KEYS (退役名) と交差しないことを検証する。
// 退役したキー名を再びフィールドに使うと、旧 backup と意味がずれて silent data loss を生むため禁止する。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESERVED_EXPORT_KEYS } from '../../../src/lib/domain/export-format';

describe('export DTO キー名安定性 — 退役キーの再利用禁止', () => {
	it('export-format.ts の宣言済フィールド名が RESERVED_EXPORT_KEYS と交差しない', () => {
		const src = readFileSync(join(process.cwd(), 'src/lib/domain/export-format.ts'), 'utf8');
		// interface / type 内のフィールド宣言 `name:` / `name?:` を抽出する。
		const declared = new Set<string>();
		for (const m of src.matchAll(/^\s*(\w+)\??:/gm)) {
			if (m[1]) declared.add(m[1]);
		}
		expect(declared.size, 'export-format.ts にフィールド宣言が存在する').toBeGreaterThan(10);

		const collisions = RESERVED_EXPORT_KEYS.filter((k) => declared.has(k));
		expect(
			collisions,
			`退役済キー名が再利用されています (rename/remove 禁止・新キー追加 + migration で対応): ${collisions.join(', ')}`,
		).toEqual([]);
	});
});
