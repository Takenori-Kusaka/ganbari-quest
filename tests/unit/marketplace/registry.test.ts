/**
 * MarketplaceTypeRegistry 単体テスト — ADR-0052 (Issue #2363)
 *
 * register / get / list / has / size / clear と
 * 未登録 type の error path を網羅する。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceTypeRegistry } from '$lib/marketplace/registry';
import type {
	ImportContext,
	ImportPreview,
	ImportResult,
	ImportStrategy,
	MarketplaceTypeCode,
	MarketplaceTypeDescriptor,
} from '$lib/marketplace/types';
import { MARKETPLACE_TYPE_CODES } from '$lib/marketplace/types';

// ── テスト用ダミー Strategy / Descriptor factory ─────────────────

interface DummyPayload {
	items: string[];
}

function createDummyStrategy(): ImportStrategy<DummyPayload> {
	return {
		parse: vi.fn((input: unknown) => {
			if (!input || typeof input !== 'object' || !('items' in input)) {
				throw new Error('invalid payload');
			}
			return input as DummyPayload;
		}),
		preview: vi.fn(
			async (payload: DummyPayload, _ctx: ImportContext): Promise<ImportPreview> => ({
				total: payload.items.length,
				newItems: payload.items.length,
				duplicates: 0,
				duplicateNames: [],
			}),
		),
		apply: vi.fn(
			async (payload: DummyPayload, _ctx: ImportContext): Promise<ImportResult> => ({
				imported: payload.items.length,
				skipped: 0,
				errors: [],
				failed: 0,
			}),
		),
	};
}

function createDescriptor<TCode extends MarketplaceTypeCode>(
	typeCode: TCode,
	overrides?: Partial<MarketplaceTypeDescriptor<TCode, DummyPayload>>,
): MarketplaceTypeDescriptor<TCode, DummyPayload> {
	return {
		typeCode,
		displayLabel: `${typeCode} (test)`,
		description: `test descriptor for ${typeCode}`,
		strategy: createDummyStrategy(),
		requiresChildId: false,
		...overrides,
	};
}

describe('MarketplaceTypeRegistry', () => {
	let registry: MarketplaceTypeRegistry;

	beforeEach(() => {
		registry = new MarketplaceTypeRegistry();
	});

	describe('register / size', () => {
		it('Descriptor を登録すると size が増える', () => {
			expect(registry.size()).toBe(0);
			registry.register(createDescriptor('activity-pack'));
			expect(registry.size()).toBe(1);
			registry.register(createDescriptor('reward-set'));
			expect(registry.size()).toBe(2);
		});

		it('同一 typeCode の二重登録は明確な error で fail-fast', () => {
			registry.register(createDescriptor('activity-pack'));
			expect(() => registry.register(createDescriptor('activity-pack'))).toThrow(
				/already registered/,
			);
		});
	});

	describe('get', () => {
		it('登録済み typeCode を渡すと Descriptor を返す', () => {
			const desc = createDescriptor('activity-pack', { displayLabel: '活動セット' });
			registry.register(desc);
			const got = registry.get('activity-pack');
			expect(got.typeCode).toBe('activity-pack');
			expect(got.displayLabel).toBe('活動セット');
			expect(got.strategy).toBe(desc.strategy);
		});

		it('未登録 typeCode を渡すと明確な error で throw', () => {
			expect(() => registry.get('activity-pack')).toThrow(/not registered/);
		});

		it('error メッセージに登録済み type 一覧が含まれる', () => {
			registry.register(createDescriptor('reward-set'));
			registry.register(createDescriptor('checklist'));
			try {
				registry.get('activity-pack');
				expect.fail('should have thrown');
			} catch (e) {
				const msg = (e as Error).message;
				expect(msg).toMatch(/reward-set/);
				expect(msg).toMatch(/checklist/);
				expect(msg).toMatch(/activity-pack/);
			}
		});

		it('TypeScript discriminated union: get(リテラル) は narrow された型を返す', () => {
			registry.register(createDescriptor('activity-pack'));
			const got = registry.get('activity-pack');
			// 型レベル: typeCode は 'activity-pack' に narrow されている
			const typeCode: 'activity-pack' = got.typeCode;
			expect(typeCode).toBe('activity-pack');
		});
	});

	describe('has', () => {
		it('登録済みなら true、未登録なら false', () => {
			expect(registry.has('activity-pack')).toBe(false);
			registry.register(createDescriptor('activity-pack'));
			expect(registry.has('activity-pack')).toBe(true);
			expect(registry.has('reward-set')).toBe(false);
		});
	});

	describe('list', () => {
		it('登録順に関わらず MARKETPLACE_TYPE_CODES の順で返す', () => {
			// あえて逆順登録
			registry.register(createDescriptor('challenge-set'));
			registry.register(createDescriptor('activity-pack'));
			registry.register(createDescriptor('rule-preset'));

			const codes = registry.list().map((d) => d.typeCode);
			expect(codes).toEqual(['activity-pack', 'rule-preset', 'challenge-set']);
		});

		it('5 type 全件登録時は MARKETPLACE_TYPE_CODES と完全一致', () => {
			for (const code of MARKETPLACE_TYPE_CODES) {
				registry.register(createDescriptor(code));
			}
			expect(registry.list().map((d) => d.typeCode)).toEqual(MARKETPLACE_TYPE_CODES);
			expect(registry.size()).toBe(MARKETPLACE_TYPE_CODES.length);
		});

		it('空 Registry は空配列を返す', () => {
			expect(registry.list()).toEqual([]);
		});
	});

	describe('clear', () => {
		it('clear() で全 Descriptor が消える', () => {
			registry.register(createDescriptor('activity-pack'));
			registry.register(createDescriptor('reward-set'));
			expect(registry.size()).toBe(2);
			registry.clear();
			expect(registry.size()).toBe(0);
			expect(() => registry.get('activity-pack')).toThrow(/not registered/);
		});
	});

	describe('Strategy 経由の動作 (型契約確認)', () => {
		it('登録した Descriptor の strategy.parse / preview / apply が呼べる', async () => {
			const desc = createDescriptor('reward-set', { requiresChildId: true });
			registry.register(desc);

			const got = registry.get('reward-set');
			const parsed = got.strategy.parse({ items: ['a', 'b'] });
			const preview = await got.strategy.preview(parsed as DummyPayload, {
				tenantId: 't1',
				childId: 42,
			});
			const result = await got.strategy.apply(parsed as DummyPayload, {
				tenantId: 't1',
				childId: 42,
			});

			expect(preview.total).toBe(2);
			expect(preview.newItems).toBe(2);
			expect(result.imported).toBe(2);
			expect(result.skipped).toBe(0);
			expect(result.errors).toEqual([]);
		});

		it('parse は不正 input を error で reject', () => {
			const desc = createDescriptor('checklist');
			registry.register(desc);
			expect(() => registry.get('checklist').strategy.parse(null)).toThrow(/invalid payload/);
			expect(() => registry.get('checklist').strategy.parse({ wrong: true })).toThrow(
				/invalid payload/,
			);
		});

		it('requiresChildId フラグが Descriptor 経由で参照可能', () => {
			registry.register(createDescriptor('activity-pack', { requiresChildId: false }));
			registry.register(createDescriptor('reward-set', { requiresChildId: true }));
			expect(registry.get('activity-pack').requiresChildId).toBe(false);
			expect(registry.get('reward-set').requiresChildId).toBe(true);
		});
	});

	describe('MARKETPLACE_TYPE_CODES SSOT', () => {
		it('5 type すべてが定義されている (interface 基盤の範囲)', () => {
			expect(MARKETPLACE_TYPE_CODES).toEqual([
				'activity-pack',
				'reward-set',
				'checklist',
				'rule-preset',
				'challenge-set',
			]);
			expect(MARKETPLACE_TYPE_CODES.length).toBe(5);
		});
	});
});
