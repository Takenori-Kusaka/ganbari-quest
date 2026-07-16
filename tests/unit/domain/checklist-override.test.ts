// tests/unit/domain/checklist-override.test.ts
// #3473 item 3: checklist 日次 override restore 入力の値域 SSOT + sanitize の failing-test-first。
//
// backup restore は untrusted なバックアップファイル由来の action/itemName/icon を検証せず
// 書き戻していた。enum 外 action は子供画面フィルタにヒットせず silent 破損を生むため、
// restore 境界で本 sanitizer が拒否 / 切り詰めることを固定する。

import { describe, expect, it } from 'vitest';
import {
	CHECKLIST_OVERRIDE_ACTIONS,
	CHECKLIST_OVERRIDE_ICON_MAX,
	CHECKLIST_OVERRIDE_ITEM_NAME_MAX,
	sanitizeChecklistOverrideRestore,
} from '../../../src/lib/domain/checklist-override';

const validInput = {
	targetDate: '2026-03-05',
	action: 'add',
	itemName: 'すいとう',
	icon: '📦',
	createdAt: '2026-03-05T09:00:00.000Z',
};

describe('#3473 sanitizeChecklistOverrideRestore', () => {
	it('action は add / remove の 2 値のみ', () => {
		expect([...CHECKLIST_OVERRIDE_ACTIONS]).toEqual(['add', 'remove']);
	});

	it('正常入力はそのまま value を返す', () => {
		const r = sanitizeChecklistOverrideRestore(validInput);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual(validInput);
	});

	it('remove action も許容', () => {
		const r = sanitizeChecklistOverrideRestore({ ...validInput, action: 'remove' });
		expect(r.ok).toBe(true);
	});

	it('enum 外 action は拒否 (silent 破損防止)', () => {
		const r = sanitizeChecklistOverrideRestore({ ...validInput, action: 'DROP TABLE' });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toContain('action');
	});

	it('targetDate 形状不正は拒否', () => {
		const r = sanitizeChecklistOverrideRestore({ ...validInput, targetDate: '2026/03/05' });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toContain('targetDate');
	});

	it('itemName 空は拒否', () => {
		const r = sanitizeChecklistOverrideRestore({ ...validInput, itemName: '   ' });
		expect(r.ok).toBe(false);
	});

	it('itemName 超過は切り詰め', () => {
		const long = 'あ'.repeat(CHECKLIST_OVERRIDE_ITEM_NAME_MAX + 50);
		const r = sanitizeChecklistOverrideRestore({ ...validInput, itemName: long });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.itemName.length).toBe(CHECKLIST_OVERRIDE_ITEM_NAME_MAX);
	});

	it('icon 空は既定 📦 に、超過は切り詰め', () => {
		const empty = sanitizeChecklistOverrideRestore({ ...validInput, icon: '' });
		expect(empty.ok).toBe(true);
		if (empty.ok) expect(empty.value.icon).toBe('📦');

		const long = sanitizeChecklistOverrideRestore({
			...validInput,
			icon: '🔥'.repeat(CHECKLIST_OVERRIDE_ICON_MAX + 10),
		});
		expect(long.ok).toBe(true);
		if (long.ok) expect(long.value.icon.length).toBeLessThanOrEqual(CHECKLIST_OVERRIDE_ICON_MAX);
	});

	it('createdAt 空は拒否 (round-trip 保全対象)', () => {
		const r = sanitizeChecklistOverrideRestore({ ...validInput, createdAt: '' });
		expect(r.ok).toBe(false);
	});
});
