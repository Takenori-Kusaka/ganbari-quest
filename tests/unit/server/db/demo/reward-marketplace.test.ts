// tests/unit/server/db/demo/reward-marketplace.test.ts
// #2097 Phase B-7: demo Lambda の reward 経路 marketplace integration 検証。
// settings-repo の `reward_templates` キー + special-reward-repo の child shop 用 pre-granted rewards。

import { describe, expect, it } from 'vitest';
import * as settingsRepo from '../../../../../src/lib/server/db/demo/settings-repo';
import * as specialRewardRepo from '../../../../../src/lib/server/db/demo/special-reward-repo';
import {
	getDemoMarketplaceRewardTemplatesByChild,
	getDemoMarketplaceSpecialRewardsByChild,
} from '../../../../../src/lib/server/demo/demo-data';

describe('demo/reward — marketplace integration (#2097 B-7)', () => {
	describe('per-child reward templates', () => {
		it('902 (preschool F): kinder-rewards から 10 件取得', () => {
			const templates = getDemoMarketplaceRewardTemplatesByChild(902);
			expect(templates.length).toBe(10);
			// 既知の kinder-rewards item（こうえんで30ぷんあそぶ）が含まれる
			expect(templates.some((t) => t.title === 'こうえんで30ぷんあそぶ')).toBe(true);
		});

		it('903 (elementary M): elementary-rewards から 10 件', () => {
			expect(getDemoMarketplaceRewardTemplatesByChild(903).length).toBe(10);
		});

		it('904 (junior F): junior-rewards から 10 件', () => {
			expect(getDemoMarketplaceRewardTemplatesByChild(904).length).toBe(10);
		});

		it('906 (senior M): senior-rewards から 10 件', () => {
			expect(getDemoMarketplaceRewardTemplatesByChild(906).length).toBe(10);
		});

		it('901 (baby M): marketplace 対象外 — 空配列', () => {
			expect(getDemoMarketplaceRewardTemplatesByChild(901).length).toBe(0);
		});
	});

	describe('settings-repo の reward_templates 経路', () => {
		it('getSetting("reward_templates") は valid JSON を返す', async () => {
			const json = await settingsRepo.getSetting('reward_templates', 'demo');
			expect(json).toBeDefined();
			expect(typeof json).toBe('string');
			const parsed = JSON.parse(json ?? '[]');
			expect(Array.isArray(parsed)).toBe(true);
			expect(parsed.length).toBeGreaterThan(0);
			// schema: { title, points, icon, category }
			expect(parsed[0]).toHaveProperty('title');
			expect(parsed[0]).toHaveProperty('points');
			expect(parsed[0]).toHaveProperty('icon');
			expect(parsed[0]).toHaveProperty('category');
		});

		it('getSetting("unknown_key") は undefined', async () => {
			expect(await settingsRepo.getSetting('unknown_key', 'demo')).toBeUndefined();
		});

		it('getSettings は複数 key を返す', async () => {
			const settings = await settingsRepo.getSettings(['reward_templates', 'unknown_key'], 'demo');
			expect(settings).toHaveProperty('reward_templates');
			expect(settings.unknown_key).toBeUndefined();
		});
	});

	describe('special-reward-repo の child shop 用 pre-granted rewards', () => {
		it('902 で kinder-rewards 由来の rewards を上位 5 件返す', async () => {
			const rewards = await specialRewardRepo.findSpecialRewards(902, 'demo');
			expect(rewards.length).toBe(5);
			expect(rewards.every((r) => r.childId === 902)).toBe(true);
			expect(rewards.every((r) => r.sourcePresetId === 'kinder-rewards')).toBe(true);
			// 全 reward が pre-granted (grantedAt 設定済み)
			expect(rewards.every((r) => r.grantedAt !== null)).toBe(true);
			// #2097 Phase B-5a: idx 0 は未表示 (shownAt=null) で達成プレゼント modal 発火、idx 1-4 は既表示
			expect(rewards.filter((r) => r.shownAt === null).length).toBe(1);
			expect(rewards.filter((r) => r.shownAt !== null).length).toBe(4);
		});

		it('903 で elementary-rewards 由来 5 件', async () => {
			const rewards = await specialRewardRepo.findSpecialRewards(903, 'demo');
			expect(rewards.length).toBe(5);
			expect(rewards.every((r) => r.sourcePresetId === 'elementary-rewards')).toBe(true);
		});

		it('901 (baby) は marketplace 対象外 — 空配列', async () => {
			expect(await specialRewardRepo.findSpecialRewards(901, 'demo')).toEqual([]);
		});

		it('getDemoMarketplaceSpecialRewardsByChild は per-child 配列を返す', () => {
			expect(getDemoMarketplaceSpecialRewardsByChild(902).length).toBe(5);
			expect(getDemoMarketplaceSpecialRewardsByChild(999).length).toBe(0);
		});
	});
});
