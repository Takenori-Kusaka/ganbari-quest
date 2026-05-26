// tests/unit/routes/ops-license-legacy-count.test.ts
// #2484 (HMAC migration Phase 1.3): /ops/license/legacy-count endpoint テスト
//
// 検証観点:
// - GET が getRepos().auth.countLicenseKeys({ format: 'legacy' }) を呼ぶ
// - response は { legacyCount, queriedAt, backend } shape
// - backend は DATA_SOURCE env から導出 ('dynamodb' / 'sqlite')
// - 認証は src/routes/ops/+layout.server.ts で gate 適用済みのため本 endpoint test では境界検証 skip
//   (E2E spec で別途検証)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCountLicenseKeys = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			countLicenseKeys: (...args: unknown[]) => mockCountLicenseKeys(...args),
		},
	}),
}));

import { resetEnvForTesting } from '../../../src/lib/runtime/env';
import { GET } from '../../../src/routes/ops/license/legacy-count/+server';

describe('GET /ops/license/legacy-count (#2484 Phase 1.3)', () => {
	beforeEach(() => {
		mockCountLicenseKeys.mockReset();
		resetEnvForTesting();
		vi.unstubAllEnvs();
	});

	it('format: "legacy" filter で countLicenseKeys を呼び、JSON response を返す', async () => {
		mockCountLicenseKeys.mockResolvedValue(42);
		vi.stubEnv('DATA_SOURCE', 'dynamodb');
		resetEnvForTesting();

		// biome-ignore lint/suspicious/noExplicitAny: SvelteKit RequestEvent は厳密型を要求するが本テストは GET handler のみ検証
		const response = await GET({} as any);
		const body = await response.json();

		expect(mockCountLicenseKeys).toHaveBeenCalledWith({ format: 'legacy' });
		expect(body.legacyCount).toBe(42);
		expect(body.backend).toBe('dynamodb');
		expect(typeof body.queriedAt).toBe('string');
		// ISO8601 形式
		expect(body.queriedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
	});

	it('DATA_SOURCE=sqlite (NUC local / dev) では backend: "sqlite" を返す', async () => {
		mockCountLicenseKeys.mockResolvedValue(0); // SQLite は no-op で 0
		vi.stubEnv('DATA_SOURCE', 'sqlite');
		resetEnvForTesting();

		// biome-ignore lint/suspicious/noExplicitAny: SvelteKit RequestEvent は厳密型を要求するが本テストは GET handler のみ検証
		const response = await GET({} as any);
		const body = await response.json();

		expect(body.backend).toBe('sqlite');
		expect(body.legacyCount).toBe(0);
	});

	it('DATA_SOURCE=demo (demo Lambda) では backend: "sqlite" 扱い (DynamoDB 以外)', async () => {
		mockCountLicenseKeys.mockResolvedValue(0);
		vi.stubEnv('DATA_SOURCE', 'demo');
		resetEnvForTesting();

		// biome-ignore lint/suspicious/noExplicitAny: SvelteKit RequestEvent は厳密型を要求するが本テストは GET handler のみ検証
		const response = await GET({} as any);
		const body = await response.json();

		expect(body.backend).toBe('sqlite'); // 'dynamodb' でないバックエンドは 'sqlite' に集約
	});
});
