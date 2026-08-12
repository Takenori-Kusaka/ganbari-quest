// tests/unit/features/sibling-display-name.test.ts
// #4509 ⑤: きょうだいの名前が引けないときに内部 ID を子供の画面へ出さないことを固定する。
//
// 旧実装は `#${s.childId}` をフォールバックにしており、名前解決に失敗した回だけ
// 子供に `#a3f1-...` のような内部 ID が見えた (DESIGN.md §6、過去事例 #498 / #573)。

import { describe, expect, it } from 'vitest';
import { CHILD_HOME_LABELS } from '../../../src/lib/domain/labels';
import { resolveSiblingDisplayName } from '../../../src/lib/features/child-home/sibling-display-name';

const CHILDREN = [
	{ id: 'c-1', nickname: 'はなこ' },
	{ id: 'c-2', nickname: null },
	{ id: 'c-3', nickname: '  ' },
];

describe('#4509 ⑤ きょうだい表示名のフォールバック', () => {
	it('名前が引けるときはニックネームを出す', () => {
		expect(resolveSiblingDisplayName(CHILDREN, 'c-1')).toBe('はなこ');
	});

	it('一覧に居ない子供でも内部 ID を出さず汎用語にする', () => {
		const name = resolveSiblingDisplayName(CHILDREN, 'c-999');
		expect(name).toBe(CHILD_HOME_LABELS.siblingUnknownName);
		expect(name).not.toContain('c-999');
		expect(name).not.toContain('#');
	});

	it('ニックネームが null / 空白のみでも内部 ID を出さない', () => {
		expect(resolveSiblingDisplayName(CHILDREN, 'c-2')).toBe(CHILD_HOME_LABELS.siblingUnknownName);
		expect(resolveSiblingDisplayName(CHILDREN, 'c-3')).toBe(CHILD_HOME_LABELS.siblingUnknownName);
	});

	it('一覧そのものが取れていなくても汎用語にフォールバックする', () => {
		expect(resolveSiblingDisplayName(undefined, 'c-1')).toBe(CHILD_HOME_LABELS.siblingUnknownName);
		expect(resolveSiblingDisplayName(null, 'c-1')).toBe(CHILD_HOME_LABELS.siblingUnknownName);
	});

	it('フォールバック語そのものが ID っぽい文字列になっていない', () => {
		expect(CHILD_HOME_LABELS.siblingUnknownName).not.toMatch(/[#0-9a-f]{4,}/i);
		expect(CHILD_HOME_LABELS.siblingUnknownName.length).toBeGreaterThan(0);
	});
});
