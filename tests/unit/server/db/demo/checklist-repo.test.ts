// tests/unit/server/db/demo/checklist-repo.test.ts

import { describe, expect, it } from 'vitest';
import * as checklistRepo from '../../../../../src/lib/server/db/demo/checklist-repo';
import {
	DEMO_CHECKLIST_ITEMS,
	DEMO_CHECKLIST_TEMPLATES,
} from '../../../../../src/lib/server/demo/demo-data';

describe('demo/checklist-repo', () => {
	it('findTemplatesByChild は child の active テンプレートを返す', async () => {
		// 904 (junior) は 中学生の登校準備 テンプレートを持つ
		const templates = await checklistRepo.findTemplatesByChild(904, 'demo');
		expect(templates.length).toBeGreaterThan(0);
		expect(templates.every((t) => t.childId === 904)).toBe(true);
		expect(templates.every((t) => t.isActive === 1)).toBe(true);
	});

	it('findTemplateItems はテンプレートの items を返す', async () => {
		// テンプレート 900 (おでかけのじゅんび) の items
		const items = await checklistRepo.findTemplateItems(900, 'demo');
		expect(items.length).toBeGreaterThan(0);
		expect(items.every((i) => i.templateId === 900)).toBe(true);
	});

	it('findTodayLog は undefined (fixture なし)', async () => {
		expect(
			await checklistRepo.findTodayLog(904, 904, '2026-04-01', 'demo'),
		).toBeUndefined();
	});

	it('insertTemplate は no-op で fixture mutate なし', async () => {
		const before = DEMO_CHECKLIST_TEMPLATES.length;
		const created = await checklistRepo.insertTemplate(
			{ childId: 904, name: 'test-template' },
			'demo',
		);
		expect(created.name).toBe('test-template');
		expect(DEMO_CHECKLIST_TEMPLATES.length).toBe(before);
	});

	it('deleteTemplate / deleteTemplateItem は no-op', async () => {
		const before = DEMO_CHECKLIST_TEMPLATES.length;
		await checklistRepo.deleteTemplate(900, 'demo');
		expect(DEMO_CHECKLIST_TEMPLATES.length).toBe(before);
		const beforeItems = DEMO_CHECKLIST_ITEMS.length;
		await checklistRepo.deleteTemplateItem(20, 'demo');
		expect(DEMO_CHECKLIST_ITEMS.length).toBe(beforeItems);
	});
});
