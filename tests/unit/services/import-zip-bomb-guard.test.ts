// tests/unit/services/import-zip-bomb-guard.test.ts
// #3078: ZIP インポートの zip-bomb 防御ロジック検証。
// fflate.unzipSync の filter (per-entry originalSize 上限) + 展開後合計上限が
// 高圧縮率の巨大展開を弾くことを、実 ZIP bytes で確認する。
//
// API ハンドラ (src/routes/api/v1/import/+server.ts) の parseImportRequest は
// auth context を要するため直接は呼べない。本テストは同ハンドラが用いる
// fflate primitives (filter + 合計集計) の振る舞いを最小再現で固定する。
// 上限値はハンドラの定数 (per-entry 25MB / 合計 200MB) ではなく、テスト高速化のため
// 注入した小さい上限を使い、ロジック (filter + 集計閾値) の正しさを検証する。

import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

/** ハンドラと同等の zip-bomb 防御を適用して entries を返す (上限超過は例外)。 */
function unzipWithGuards(
	zip: Uint8Array,
	maxEntryBytes: number,
	maxTotalBytes: number,
): Record<string, Uint8Array> {
	const entries = unzipSync(zip, {
		filter: (file) => file.originalSize <= maxEntryBytes,
	});
	let total = 0;
	for (const bytes of Object.values(entries)) {
		total += bytes.length;
		if (total > maxTotalBytes) {
			throw new Error('展開後のファイルサイズが大きすぎます');
		}
	}
	return entries;
}

describe('import zip-bomb guard (#3078)', () => {
	it('小さい正常 ZIP は全エントリ展開される', () => {
		const zip = zipSync({
			'data.json': new TextEncoder().encode('{"ok":true}'),
			'avatars/7/a.png': new Uint8Array([1, 2, 3]),
		});
		const entries = unzipWithGuards(zip, 1024, 4096);
		expect(Object.keys(entries).sort()).toEqual(['avatars/7/a.png', 'data.json']);
	});

	it('per-entry 上限を超えるエントリは filter で除外される (高圧縮率エントリの巨大展開を阻止)', () => {
		// per-entry 上限 (1KB) を超える zero-fill バッファ。全 0 のため deflate で極小に圧縮され、
		// 圧縮入力サイズ上限を通過しても originalSize で弾けることを示す。
		const huge = new Uint8Array(64 * 1024); // 64KB > 1KB 上限
		const zip = zipSync({
			'data.json': new TextEncoder().encode('{"ok":true}'),
			'avatars/7/bomb.bin': huge,
		});
		const entries = unzipWithGuards(zip, 1024, 1024 * 1024);
		// 巨大エントリは展開されず、data.json だけが残る
		expect(Object.keys(entries)).toEqual(['data.json']);
		expect(entries['avatars/7/bomb.bin']).toBeUndefined();
	});

	it('展開後合計が上限を超える ZIP は throw する (per-entry 上限以下のエントリの積み上げ)', () => {
		// per-entry 上限 (4KB) 以下のエントリを複数 → 合計が上限 (10KB) を超える
		const chunk = new Uint8Array(4 * 1024);
		const files: Record<string, Uint8Array> = {
			'data.json': new TextEncoder().encode('{"ok":true}'),
		};
		for (let i = 0; i < 4; i++) {
			// 各チャンクに微小なノイズを入れて完全同一にしない (集計挙動を素直に検証)
			const c = chunk.slice();
			c[0] = i;
			files[`avatars/7/chunk-${i}.bin`] = c;
		}
		const zip = zipSync(files);
		// per-entry 上限 8KB (各 4KB は通過) / 合計上限 10KB (4*4KB=16KB > 10KB で throw)
		expect(() => unzipWithGuards(zip, 8 * 1024, 10 * 1024)).toThrow(/大きすぎ/);
	});
});
