// tests/unit/domain/export-format.test.ts
// #3104: buildAttachmentContentDisposition の回帰テスト。
// 日本語名テンプレで Content-Disposition が ByteString 変換 500 になった bug の再発防止。

import { describe, expect, it } from 'vitest';
import { buildAttachmentContentDisposition } from '../../../src/lib/domain/export-format';

/** ヘッダ値が ByteString (Latin-1, 全 char ≤ U+00FF) 安全か = new Response が throw しないか。 */
function isByteStringSafe(headerValue: string): boolean {
	for (const ch of headerValue) {
		if (ch.codePointAt(0)! > 0xff) return false;
	}
	return true;
}

describe('buildAttachmentContentDisposition (#3104)', () => {
	it('ASCII 名は filename= に保持され filename* も付く', () => {
		const cd = buildAttachmentContentDisposition('checklist-morning.json');
		expect(cd).toContain('attachment;');
		expect(cd).toContain('filename="checklist-morning.json"');
		expect(cd).toContain("filename*=UTF-8''checklist-morning.json");
	});

	it('日本語名でも ByteString 安全 (= new Response が 500 にならない)', () => {
		const cd = buildAttachmentContentDisposition('checklist-あさのしたく.json');
		// 旧実装はここで日本語が filename= に残り > 255 の char で 500 になっていた
		expect(isByteStringSafe(cd)).toBe(true);
		// 実際に Response ヘッダに乗せても TypeError を投げない (回帰の本丸)
		expect(() => new Response('{}', { headers: { 'Content-Disposition': cd } })).not.toThrow();
	});

	it('日本語名は ASCII fallback で _ 置換され、filename* に percent-encoded UTF-8 で保持される', () => {
		const cd = buildAttachmentContentDisposition('checklist-あさのしたく.json');
		// ASCII fallback: 非 ASCII は _ に ("あさのしたく" = 6 文字 → _ × 6)
		expect(cd).toContain('filename="checklist-______.json"');
		// RFC 5987: 日本語は percent-encoded で復元可能
		expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent('checklist-あさのしたく.json')}`);
	});

	it('" と \\ は ASCII fallback で _ に置換される (ヘッダ injection 防止)', () => {
		const cd = buildAttachmentContentDisposition('a"b\\c.json');
		expect(cd).toContain('filename="a_b_c.json"');
		expect(isByteStringSafe(cd)).toBe(true);
	});

	it('絵文字 (サロゲートペア) を含む名でも ByteString 安全', () => {
		const cd = buildAttachmentContentDisposition('checklist-📋ごはん.json');
		expect(isByteStringSafe(cd)).toBe(true);
		expect(() => new Response('{}', { headers: { 'Content-Disposition': cd } })).not.toThrow();
	});
});
