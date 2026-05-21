/**
 * Marketplace checksum 単体テスト — Issue #2372 (EPIC #2362 P4).
 *
 * deterministic JSON + SHA-256 + verify の正常系・異常系を網羅。
 */

import { describe, expect, it } from 'vitest';
import { computeChecksum, deterministicStringify, verifyChecksum } from '$lib/marketplace/checksum';

describe('deterministicStringify', () => {
	it('object key を再帰的に sort する', () => {
		const out = deterministicStringify({ b: 1, a: 2, c: { z: 3, x: 4 } });
		expect(out).toBe('{"a":2,"b":1,"c":{"x":4,"z":3}}');
	});

	it('Array は順序維持', () => {
		const out = deterministicStringify([3, 1, 2]);
		expect(out).toBe('[3,1,2]');
	});

	it('Array 内 object も key sort', () => {
		const out = deterministicStringify([{ b: 1, a: 2 }]);
		expect(out).toBe('[{"a":2,"b":1}]');
	});

	it('null / number / string / boolean は JSON.stringify と同じ', () => {
		expect(deterministicStringify(null)).toBe('null');
		expect(deterministicStringify(42)).toBe('42');
		expect(deterministicStringify('hi')).toBe('"hi"');
		expect(deterministicStringify(true)).toBe('true');
	});

	it('物理的 key 順が違っても同一出力', () => {
		const a = deterministicStringify({ name: 'a', points: 1 });
		const b = deterministicStringify({ points: 1, name: 'a' });
		expect(a).toBe(b);
	});

	it('深いネストでも key sort', () => {
		const out = deterministicStringify({
			activities: [{ name: 'b', extra: { z: 1, a: 2 } }, { name: 'a' }],
		});
		expect(out).toBe('{"activities":[{"extra":{"a":2,"z":1},"name":"b"},{"name":"a"}]}');
	});
});

describe('computeChecksum', () => {
	it('SHA-256 hex 64 文字を返す', () => {
		const cs = computeChecksum({ a: 1 });
		expect(cs).toMatch(/^[0-9a-f]{64}$/);
	});

	it('同一 payload は同一 checksum (key 順違いでも)', () => {
		const a = computeChecksum({ name: 'foo', points: 100 });
		const b = computeChecksum({ points: 100, name: 'foo' });
		expect(a).toBe(b);
	});

	it('payload が違えば checksum も違う', () => {
		const a = computeChecksum({ name: 'foo' });
		const b = computeChecksum({ name: 'bar' });
		expect(a).not.toBe(b);
	});

	it('null / 空オブジェクトでも安定 checksum', () => {
		expect(computeChecksum(null)).toMatch(/^[0-9a-f]{64}$/);
		expect(computeChecksum({})).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('verifyChecksum', () => {
	it('一致すれば true', () => {
		const payload = { activities: [{ name: 'x' }] };
		const cs = computeChecksum(payload);
		expect(verifyChecksum(payload, cs)).toBe(true);
	});

	it('改竄 payload で false', () => {
		const original = { activities: [{ name: 'x' }] };
		const cs = computeChecksum(original);
		const tampered = { activities: [{ name: 'y' }] };
		expect(verifyChecksum(tampered, cs)).toBe(false);
	});

	it('checksum 形式不正で false', () => {
		const payload = { a: 1 };
		expect(verifyChecksum(payload, 'short')).toBe(false);
		expect(verifyChecksum(payload, '')).toBe(false);
		// biome-ignore lint/suspicious/noExplicitAny: type 不正を意図的にテスト
		expect(verifyChecksum(payload, 123 as any)).toBe(false);
	});

	it('key 順違いの payload でも一致 (deterministic)', () => {
		const original = { name: 'a', points: 1 };
		const cs = computeChecksum(original);
		const reordered = { points: 1, name: 'a' };
		expect(verifyChecksum(reordered, cs)).toBe(true);
	});
});
