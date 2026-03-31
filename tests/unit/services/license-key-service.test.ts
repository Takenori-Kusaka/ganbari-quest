import { generateLicenseKey } from '$lib/server/services/license-key-service';
import { describe, expect, it } from 'vitest';

describe('generateLicenseKey', () => {
	it('GQ-XXXX-XXXX-XXXX 形式のキーを生成する', () => {
		const key = generateLicenseKey();
		expect(key).toMatch(/^GQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
	});

	it('曖昧な文字（0/O/1/I）を含まない', () => {
		// 100回生成して統計的に検証
		for (let i = 0; i < 100; i++) {
			const key = generateLicenseKey();
			const body = key.slice(3); // "GQ-" を除去
			expect(body).not.toMatch(/[01OI]/);
		}
	});

	it('毎回異なるキーを生成する', () => {
		const keys = new Set<string>();
		for (let i = 0; i < 50; i++) {
			keys.add(generateLicenseKey());
		}
		// 50個のキーが全て異なる（衝突率は極めて低い）
		expect(keys.size).toBe(50);
	});

	it('プレフィックスが GQ- である', () => {
		const key = generateLicenseKey();
		expect(key.startsWith('GQ-')).toBe(true);
	});

	it('3つのセグメントがハイフンで区切られている', () => {
		const key = generateLicenseKey();
		const segments = key.split('-');
		expect(segments).toHaveLength(4); // GQ, seg1, seg2, seg3
		expect(segments[0]).toBe('GQ');
		expect(segments[1]).toHaveLength(4);
		expect(segments[2]).toHaveLength(4);
		expect(segments[3]).toHaveLength(4);
	});
});
