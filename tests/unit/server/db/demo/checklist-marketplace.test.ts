// tests/unit/server/db/demo/checklist-marketplace.test.ts
// #2097 Phase B-7: demo Lambda の checklist 経路 marketplace integration 検証。
// 903 (event-pool) / 904 (event-school-start) の持ち物リストが取り込まれることを assert。

import { describe, expect, it } from 'vitest';
import * as checklistRepo from '../../../../../src/lib/server/db/demo/checklist-repo';
import {
	DEMO_MARKETPLACE_CHECKLIST_ITEMS,
	DEMO_MARKETPLACE_CHECKLIST_TEMPLATES,
	getDemoMarketplaceChecklistTemplatesByChild,
} from '../../../../../src/lib/server/demo/demo-data';

describe('demo/checklist-repo — marketplace integration (#2097 B-7)', () => {
	// #2362 PR-5 (ADR-0055): fixture は legacy per-child 形のまま保持 (Phase 2 で全面刷新予定)。
	// 本 test は legacy fixture helper の出力 (`getDemoMarketplaceChecklistTemplatesByChild`) を
	// 介し、childId 軸での割り当て期待を検証する。Phase 2 で fixture が family master 化された
	// 際は本 test を assignments 経由検証に書き換える。
	describe('per-child marketplace checklists (legacy fixture helper)', () => {
		it('903 (elementary M): event-pool checklist が含まれる', () => {
			const templates = getDemoMarketplaceChecklistTemplatesByChild(903);
			expect(templates.length).toBeGreaterThanOrEqual(1);
			expect(templates[0]?.sourcePresetId).toBe('event-pool');
			// legacy fixture record は childId フィールドを持つ (cast 経由で参照)
			expect((templates[0] as unknown as { childId?: number }).childId).toBe(903);
		});

		it('904 (junior F): event-school-start checklist が含まれる', () => {
			const templates = getDemoMarketplaceChecklistTemplatesByChild(904);
			expect(templates.length).toBeGreaterThanOrEqual(1);
			expect(templates[0]?.sourcePresetId).toBe('event-school-start');
			expect((templates[0] as unknown as { childId?: number }).childId).toBe(904);
		});

		it('901/902/906: marketplace checklist 対象外', () => {
			expect(getDemoMarketplaceChecklistTemplatesByChild(901)).toHaveLength(0);
			expect(getDemoMarketplaceChecklistTemplatesByChild(902)).toHaveLength(0);
			expect(getDemoMarketplaceChecklistTemplatesByChild(906)).toHaveLength(0);
		});
	});

	describe('Synthetic ID 衝突回避', () => {
		it('marketplace templates は id >= 5000 (DEMO_CHECKLIST_TEMPLATES と衝突しない)', () => {
			expect(DEMO_MARKETPLACE_CHECKLIST_TEMPLATES.every((t) => t.id >= 5000)).toBe(true);
		});

		it('marketplace items は id >= 6000', () => {
			expect(DEMO_MARKETPLACE_CHECKLIST_ITEMS.every((i) => i.id >= 6000)).toBe(true);
		});
	});

	describe('Repository read API', () => {
		it('findTemplatesByChild(903) は event-pool template を返す', async () => {
			const templates = await checklistRepo.findTemplatesByChild(903, 'demo');
			// 903 は marketplace 由来 1 件のみ（hand-curated には 903 用 template なし）
			const marketplaceTemplates = templates.filter((t) => t.sourcePresetId === 'event-pool');
			expect(marketplaceTemplates.length).toBe(1);
		});

		it('findTemplatesByChild(904) は event-school-start + hand-curated を返す', async () => {
			const templates = await checklistRepo.findTemplatesByChild(904, 'demo');
			// 904 は既存 DEMO_CHECKLIST_TEMPLATES に「中学生の登校準備」もあるので 2 件以上
			expect(templates.length).toBeGreaterThanOrEqual(2);
			expect(templates.some((t) => t.sourcePresetId === 'event-school-start')).toBe(true);
		});

		it('findTemplateItems は marketplace template の items を返す', async () => {
			const templates = await checklistRepo.findTemplatesByChild(903, 'demo');
			const eventPool = templates.find((t) => t.sourcePresetId === 'event-pool');
			expect(eventPool).toBeDefined();
			if (!eventPool) return;
			const items = await checklistRepo.findTemplateItems(eventPool.id, 'demo');
			// event-pool は 10 件
			expect(items.length).toBe(10);
			// 既知の item「みずぎ・ラッシュガード」が含まれる
			expect(items.some((i) => i.name.includes('みずぎ'))).toBe(true);
		});

		it('findTemplateById は marketplace template も取得可能', async () => {
			const templates = await checklistRepo.findTemplatesByChild(903, 'demo');
			const eventPool = templates.find((t) => t.sourcePresetId === 'event-pool');
			expect(eventPool).toBeDefined();
			if (!eventPool) return;
			const fetched = await checklistRepo.findTemplateById(eventPool.id, 'demo');
			expect(fetched).toEqual(eventPool);
		});
	});
});
