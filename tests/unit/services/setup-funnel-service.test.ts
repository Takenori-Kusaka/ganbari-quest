// tests/unit/services/setup-funnel-service.test.ts
// setup-funnel-service ユニットテスト — セットアップファネル計測

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoggerInfo = vi.fn();

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: (...args: unknown[]) => mockLoggerInfo(...args),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import type { SetupFunnelEvent } from '$lib/server/services/setup-funnel-service';
import { trackSetupFunnel } from '$lib/server/services/setup-funnel-service';

describe('setup-funnel-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('trackSetupFunnel', () => {
		it('logger.info が呼ばれる', () => {
			trackSetupFunnel('setup_start', 'tenant-1');

			expect(mockLoggerInfo).toHaveBeenCalledTimes(1);
		});

		it('ログメッセージに [setup-funnel] プレフィックスとイベント名が含まれる', () => {
			trackSetupFunnel('setup_start', 'tenant-1');

			const message = mockLoggerInfo.mock.calls[0]?.[0] as string;
			expect(message).toBe('[setup-funnel] setup_start');
		});

		it('メタデータに service, tenantId, context が含まれる', () => {
			trackSetupFunnel('setup_child_registered', 'tenant-abc');

			const meta = mockLoggerInfo.mock.calls[0]?.[1] as Record<string, unknown>;
			expect(meta.service).toBe('setup-funnel');
			expect(meta.tenantId).toBe('tenant-abc');
			expect(meta.context).toEqual({
				event: 'setup_child_registered',
			});
		});

		it('context パラメータが spread されてマージされる', () => {
			trackSetupFunnel('setup_packs_selected', 'tenant-1', {
				packCount: 3,
				packIds: [1, 2, 3],
			});

			const meta = mockLoggerInfo.mock.calls[0]?.[1] as Record<string, unknown>;
			expect(meta.context).toEqual({
				event: 'setup_packs_selected',
				packCount: 3,
				packIds: [1, 2, 3],
			});
		});

		it('context なしでも正常に動作する', () => {
			trackSetupFunnel('setup_completed', 'tenant-1');

			const meta = mockLoggerInfo.mock.calls[0]?.[1] as Record<string, unknown>;
			expect(meta.context).toEqual({
				event: 'setup_completed',
			});
		});

		it('全てのイベントタイプでメッセージが正しくフォーマットされる', () => {
			const events: SetupFunnelEvent[] = [
				'setup_start',
				'setup_child_registered',
				'setup_packs_selected',
				'setup_packs_skipped',
				'setup_first_adventure_completed',
				'setup_first_adventure_skipped',
				'setup_completed',
				'setup_to_child',
				'setup_to_admin',
			];

			for (const event of events) {
				vi.clearAllMocks();
				trackSetupFunnel(event, 'tenant-1');

				const message = mockLoggerInfo.mock.calls[0]?.[0] as string;
				expect(message).toBe(`[setup-funnel] ${event}`);
			}
		});
	});
});
