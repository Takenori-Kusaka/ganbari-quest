import { describe, expect, it } from 'vitest';
import { scanLabels } from '../../../scripts/check-terminology-coherence';

describe('check-terminology-coherence (#2555)', () => {
	describe('mystery terms detection', () => {
		it('検出対象の謎用語が含まれている場合に検知する', () => {
			const text = `
				export const TEST_LABELS = {
					k1: 'パックから追加',
					k2: '親管理画面',
					k3: '自律した子供',
				};
			`;
			const { mysteryHits } = scanLabels(text);
			expect(mysteryHits.some((h) => h.pattern === 'パックから')).toBe(true);
			expect(mysteryHits.some((h) => h.pattern === '親管理画面')).toBe(true);
			expect(mysteryHits.some((h) => h.pattern === '自律')).toBe(true);
		});

		it('正常な用語では検知しない', () => {
			const text = `
				export const TEST_LABELS = {
					k1: 'テンプレートから追加',
					k2: 'ご家族の見守り画面',
					k3: '自分で計画できるようになったお子さま',
				};
			`;
			const { mysteryHits } = scanLabels(text);
			expect(mysteryHits).toHaveLength(0);
		});
	});

	describe('add path duplication detection', () => {
		it('同一 namespace で 4 経路を超えた場合に集計される', () => {
			const text = `
export const TEST_LABELS = {
	activitiesHeader: {
		path1Label: '追加1',
		path2Label: '追加2',
		path3Label: '追加3',
		path4Label: '追加4',
		path5Label: '追加5',
	},
};
`;
			const { namespaceAddPaths } = scanLabels(text);
			const paths = namespaceAddPaths.get('activitiesHeader');
			expect(paths).toHaveLength(5);
		});

		it('AriaLabel や Icon は経路数にカウントされない', () => {
			const text = `
export const TEST_LABELS = {
	activitiesHeader: {
		addLabel: '追加1',
		addAriaLabel: '追加ボタン',
		addIcon: '➕',
	},
};
`;
			const { namespaceAddPaths } = scanLabels(text);
			const paths = namespaceAddPaths.get('activitiesHeader');
			expect(paths).toHaveLength(1);
		});
	});
});
