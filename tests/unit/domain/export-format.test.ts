// tests/unit/domain/export-format.test.ts
// #3104: buildAttachmentContentDisposition の回帰テスト。
// 日本語名テンプレで Content-Disposition が ByteString 変換 500 になった bug の再発防止。

import * as fc from 'fast-check';
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
		// RFC 5987: 日本語は percent-encoded で復元可能 (ひらがなは ' ( ) * ! ~ を含まないため encodeURIComponent と一致)
		expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent('checklist-あさのしたく.json')}`);
	});

	it('" と \\ は ASCII fallback で _ に置換される (ヘッダ injection 防止)', () => {
		const cd = buildAttachmentContentDisposition('a"b\\c.json');
		expect(cd).toContain('filename="a_b_c.json"');
		expect(isByteStringSafe(cd)).toBe(true);
	});

	it('; と = は ASCII fallback で _ に置換される (directive injection の defense-in-depth、#3115)', () => {
		// 寛容/非準拠パーサが `filename="x"; foo=bar` を directive 注入と解釈するリスクを断つ。
		const cd = buildAttachmentContentDisposition('a;b=c.json');
		expect(cd).toContain('filename="a_b_c.json"');
		// quoted-string 部 (filename="...") に ; や = が literal で残っていない
		const fnMatch = cd.match(/filename="([^"]*)"/);
		expect(fnMatch?.[1]).not.toMatch(/[;=]/);
		expect(isByteStringSafe(cd)).toBe(true);
	});

	it('"; foo=bar 風の偽 directive を挿入しようとしても ASCII fallback の filename 値が 1 つに保たれる (#3115)', () => {
		// attacker が template 名等に注入を試みた最悪ケース。filename 値内に余分な directive 区切りを作らない。
		const cd = buildAttachmentContentDisposition('evil"; attachment; filename=hack.exe');
		const fnMatch = cd.match(/filename="([^"]*)"/);
		expect(fnMatch?.[1]).not.toMatch(/["\\;=]/);
		expect(isByteStringSafe(cd)).toBe(true);
	});

	it('絵文字 (サロゲートペア) を含む名でも ByteString 安全', () => {
		const cd = buildAttachmentContentDisposition('checklist-📋ごはん.json');
		expect(isByteStringSafe(cd)).toBe(true);
		expect(() => new Response('{}', { headers: { 'Content-Disposition': cd } })).not.toThrow();
	});

	it("' * ( ) ! ~ は filename* で percent-encode され RFC 5987 attr-char 不正値を作らない", () => {
		// encodeURIComponent はこれらを escape しないため、旧実装では filename* に literal で残り
		// strict parser / proxy / WAF が ext-value grammar 違反として reject しうる
		const cd = buildAttachmentContentDisposition("a'b*c(d)e!f~g.json");
		const match = cd.match(/filename\*=UTF-8''(\S+)$/);
		expect(match).not.toBeNull();
		const extValue = match?.[1] ?? '';
		expect(extValue).not.toBe('');
		// ext-value = charset "'" [language] "'" value-chars。value-chars は attr-char / pct-encoded のみ。
		// attr-char = ALPHA / DIGIT / "!" は NG (上記で除外済) → 実用上 [A-Za-z0-9] と一部記号 + %HH。
		// ここでは ' ( ) * ! ~ が literal で残っていないこと + 許可 charset のみであることを検証する。
		expect(extValue).toMatch(/^[A-Za-z0-9%\-._]*$/);
		// 問題の 6 文字は literal で出現しない (全て %HH 化されている)
		for (const ch of ["'", '*', '(', ')', '!', '~']) {
			expect(extValue.includes(ch)).toBe(false);
		}
		// 期待 percent-encode: ' → %27, * → %2A, ( → %28, ) → %29, ! → %21, ~ → %7E
		expect(extValue).toContain('%27');
		expect(extValue).toContain('%2A');
		expect(extValue).toContain('%28');
		expect(extValue).toContain('%29');
		expect(extValue).toContain('%21');
		expect(extValue).toContain('%7E');
		expect(isByteStringSafe(cd)).toBe(true);
	});
});

// #3847 (EPIC #3151、RFC 5987/6266): 任意 Unicode ファイル名に対する RFC 6266 準拠を property-based で
// lock する。既存 example-based test を fast-check で補強し、境界 / Unicode を機械探索して #3104 class
// (非 ASCII 名の header 破損 / 復元不能) の再発を封じる。
describe('buildAttachmentContentDisposition property (#3847、RFC 5987/6266)', () => {
	// grapheme unit: 絵文字 / ZWJ / 結合文字を含む Unicode-aware な任意ファイル名 (lone surrogate なし)。
	const filenameArb = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 40 });

	it('任意 Unicode 名で: ASCII fallback (filename=) と filename*=UTF-8 の両方を必ず含む', () => {
		fc.assert(
			fc.property(filenameArb, (name) => {
				const cd = buildAttachmentContentDisposition(name);
				expect(cd.startsWith('attachment;')).toBe(true);
				expect(cd).toMatch(/filename="[^"]*"/);
				expect(cd).toContain("filename*=UTF-8''");
			}),
		);
	});

	it('任意 Unicode 名で: 出力は常に ByteString 安全 (new Response が throw しない = 500 にならない)', () => {
		fc.assert(
			fc.property(filenameArb, (name) => {
				const cd = buildAttachmentContentDisposition(name);
				expect(isByteStringSafe(cd)).toBe(true);
				expect(() => new Response('{}', { headers: { 'Content-Disposition': cd } })).not.toThrow();
			}),
		);
	});

	it('任意 Unicode 名で: filename* を decode すると元のファイル名が完全復元される (RFC 5987 round-trip)', () => {
		fc.assert(
			fc.property(filenameArb, (name) => {
				const cd = buildAttachmentContentDisposition(name);
				const ext = cd.match(/filename\*=UTF-8''(.*)$/)?.[1] ?? '';
				// filename* に格納された percent-encoded 値を decode → 元名と一致 (往復で欠落/破損なし)
				expect(decodeURIComponent(ext)).toBe(name);
			}),
		);
	});

	it('任意 Unicode 名で: ASCII fallback は printable ASCII のみ + " \\ ; = を含まない (injection 安全)', () => {
		fc.assert(
			fc.property(filenameArb, (name) => {
				const cd = buildAttachmentContentDisposition(name);
				const fallback = cd.match(/filename="([^"]*)"/)?.[1] ?? '';
				// 0x20-0x7E の printable ASCII のみ、かつ directive 区切りになる文字を含まない
				expect(fallback).toMatch(/^[ -~]*$/);
				expect(fallback).not.toMatch(/["\\;=]/);
			}),
		);
	});
});
