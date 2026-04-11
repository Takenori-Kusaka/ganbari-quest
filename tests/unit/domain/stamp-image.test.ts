import { describe, expect, it } from 'vitest';
import {
	getFallbackRank,
	getStampImagePath,
	getStampImagePathSafe,
	OMIKUJI_LABELS,
	OMIKUJI_RANKS,
	pickOmikujiRank,
} from '../../../src/lib/domain/stamp-image';

describe('stamp-image', () => {
	describe('OMIKUJI_RANKS', () => {
		it('6種のおみくじランクが定義されている', () => {
			expect(OMIKUJI_RANKS).toHaveLength(6);
			expect(OMIKUJI_RANKS).toContain('daidaikichi');
			expect(OMIKUJI_RANKS).toContain('suekichi');
		});
	});

	describe('OMIKUJI_LABELS', () => {
		it('全ランクに日本語ラベルがある', () => {
			for (const rank of OMIKUJI_RANKS) {
				expect(typeof OMIKUJI_LABELS[rank]).toBe('string');
				expect(OMIKUJI_LABELS[rank]).not.toBe('');
			}
			expect(OMIKUJI_LABELS.daidaikichi).toBe('大大吉');
			expect(OMIKUJI_LABELS.suekichi).toBe('末吉');
		});
	});

	describe('getStampImagePath', () => {
		it('ランク名からアセットパスを返す', () => {
			expect(getStampImagePath('daikichi')).toBe('/assets/stamps/daikichi.png');
			expect(getStampImagePath('kichi')).toBe('/assets/stamps/kichi.png');
		});
	});

	describe('pickOmikujiRank', () => {
		it('URレアリティは大大吉を返す', () => {
			expect(pickOmikujiRank('UR')).toBe('daidaikichi');
		});

		it('SRレアリティは大吉を返す', () => {
			expect(pickOmikujiRank('SR')).toBe('daikichi');
		});

		it('Rレアリティは中吉または小吉を返す', () => {
			const results = new Set<string>();
			for (let i = 0; i < 100; i++) {
				results.add(pickOmikujiRank('R'));
			}
			expect(results.has('chukichi') || results.has('shokichi')).toBe(true);
			for (const r of results) {
				expect(['chukichi', 'shokichi']).toContain(r);
			}
		});

		it('Nレアリティは吉または末吉を返す', () => {
			const results = new Set<string>();
			for (let i = 0; i < 100; i++) {
				results.add(pickOmikujiRank('N'));
			}
			for (const r of results) {
				expect(['kichi', 'suekichi']).toContain(r);
			}
		});

		it('未知のレアリティはNと同じ扱い', () => {
			const rank = pickOmikujiRank('UNKNOWN');
			expect(['kichi', 'suekichi']).toContain(rank);
		});
	});

	describe('getFallbackRank', () => {
		it('各レアリティに対応するデフォルトランクを返す', () => {
			expect(getFallbackRank('UR')).toBe('daidaikichi');
			expect(getFallbackRank('SR')).toBe('daikichi');
			expect(getFallbackRank('R')).toBe('chukichi');
			expect(getFallbackRank('N')).toBe('kichi');
		});

		it('未知のレアリティはkichiを返す', () => {
			expect(getFallbackRank('UNKNOWN')).toBe('kichi');
		});
	});

	describe('getStampImagePathSafe', () => {
		it('omikujiRankがある場合はそのランクのパスを返す', () => {
			expect(getStampImagePathSafe('daikichi', 'SR')).toBe('/assets/stamps/daikichi.png');
		});

		it('omikujiRankがnullの場合はrarityからフォールバックする', () => {
			expect(getStampImagePathSafe(null, 'UR')).toBe('/assets/stamps/daidaikichi.png');
			expect(getStampImagePathSafe(null, 'SR')).toBe('/assets/stamps/daikichi.png');
			expect(getStampImagePathSafe(null, 'R')).toBe('/assets/stamps/chukichi.png');
			expect(getStampImagePathSafe(null, 'N')).toBe('/assets/stamps/kichi.png');
		});

		it('omikujiRankがnullで未知のレアリティの場合はkichiにフォールバックする', () => {
			expect(getStampImagePathSafe(null, 'UNKNOWN')).toBe('/assets/stamps/kichi.png');
		});
	});
});
