// tests/unit/marketplace-pack-coverage.test.ts
// #1212-A 構造リファクタのドリフトテスト
// - テーマ型 9 件が復活していないこと
// - おてつだいマスターの活動が年齢プリセットに吸収されていること
// - elementary-boy/girl の非対称是正（双方に プログラミング + 表現系）が維持されていること

import { describe, expect, it } from 'vitest';
import { getMarketplaceIndex, getMarketplaceItem } from '$lib/data/marketplace';
import type { ActivityPackPayload } from '$lib/domain/marketplace-item';

const activityPackMetas = getMarketplaceIndex().filter((m) => m.type === 'activity-pack');

describe('#1212-A: 活動パック 12 件構成ドリフト検出 (#1301: baby 3 件削除)', () => {
	it('正確に 12 件の activity-pack が存在する', () => {
		expect(activityPackMetas).toHaveLength(12);
	});

	it('4 年齢 × neutral (4) + 性別バリアント (8) の ID 集合と一致する', () => {
		const expected = new Set([
			'kinder-starter',
			'kinder-boy',
			'kinder-girl',
			'elementary-challenge',
			'elementary-boy',
			'elementary-girl',
			'junior-high-challenge',
			'junior-boy',
			'junior-girl',
			'senior-high-challenge',
			'senior-boy',
			'senior-girl',
		]);
		const actual = new Set(activityPackMetas.map((m) => m.itemId));
		expect(actual).toEqual(expected);
	});

	it('廃止済みテーマ型 9 件が復活していない', () => {
		const forbidden = [
			'otetsudai-master',
			'study-master',
			'exam-prep',
			'creative-artist',
			'sports-hero',
			'outdoor-explorer',
			'social-butterfly',
			'weekend-fun',
			'life-skills-baby',
		];
		for (const id of forbidden) {
			expect(getMarketplaceItem('activity-pack', id)).toBeNull();
		}
	});
});

describe('#1212-A: おてつだい活動の吸収', () => {
	function getActivityNames(packId: string): string[] {
		const pack = getMarketplaceItem('activity-pack', packId);
		if (!pack) return [];
		return (pack.payload as ActivityPackPayload).activities.map((a) => a.name);
	}

	it('kinder-starter に「しょっきをはこんだ / テーブルをふいた / くつをそろえた / しょくぶつのみずやり」が吸収されている', () => {
		const names = getActivityNames('kinder-starter');
		expect(names).toContain('しょっきをはこんだ');
		expect(names).toContain('テーブルをふいた');
		expect(names).toContain('くつをそろえた');
		expect(names).toContain('しょくぶつのみずやり');
	});

	it('elementary-challenge に主要おてつだい活動が吸収されている', () => {
		const names = getActivityNames('elementary-challenge');
		expect(names).toContain('おさらあらいした');
		expect(names).toContain('ゴミだしした');
		expect(names).toContain('おふろそうじした');
		expect(names).toContain('そうじきをかけた');
		expect(names).toContain('せんたくものをたたんだ');
		expect(names).toContain('りょうりのおてつだい');
		expect(names).toContain('かいものにつきあった');
		expect(names).toContain('ペットのおせわ');
		expect(names).toContain('ふとんをたたんだ');
		expect(names).toContain('おべんとうばこをあらった');
	});
});

describe('#1212-A: elementary 性別バリアント非対称是正', () => {
	function hasActivity(packId: string, predicate: (name: string) => boolean): boolean {
		const pack = getMarketplaceItem('activity-pack', packId);
		if (!pack) return false;
		return (pack.payload as ActivityPackPayload).activities.some((a) => predicate(a.name));
	}

	it('elementary-boy にも表現・リズム系活動が含まれる（ダンス一色批判への是正）', () => {
		expect(hasActivity('elementary-boy', (n) => /リズム|ダンス|表現|おうた|うた/.test(n))).toBe(
			true,
		);
	});

	it('elementary-girl にもプログラミング系活動が含まれる（男子専売批判への是正）', () => {
		expect(
			hasActivity('elementary-girl', (n) => /プログラミング|パソコン|タイピング/.test(n)),
		).toBe(true);
	});
});

describe('#1212-A: 性別バリアントのメタ整合性', () => {
	const genderVariants = [
		{ id: 'kinder-boy', gender: 'boy' as const },
		{ id: 'kinder-girl', gender: 'girl' as const },
		{ id: 'elementary-boy', gender: 'boy' as const },
		{ id: 'elementary-girl', gender: 'girl' as const },
		{ id: 'junior-boy', gender: 'boy' as const },
		{ id: 'junior-girl', gender: 'girl' as const },
		{ id: 'senior-boy', gender: 'boy' as const },
		{ id: 'senior-girl', gender: 'girl' as const },
	];

	it.each(genderVariants)('$id は gender=$gender でタグ付けされている', ({ id, gender }) => {
		const pack = getMarketplaceItem('activity-pack', id);
		expect(pack).not.toBeNull();
		if (!pack) return;
		expect(pack.gender).toBe(gender);
	});

	it.each([
		'kinder-starter',
		'elementary-challenge',
		'junior-high-challenge',
		'senior-high-challenge',
	])('%s は gender 未指定 (neutral)', (id) => {
		const pack = getMarketplaceItem('activity-pack', id);
		expect(pack).not.toBeNull();
		if (!pack) return;
		// gender 未指定 or 'neutral' のいずれでも許容
		expect(pack.gender ?? 'neutral').toBe('neutral');
	});
});
