// tests/unit/server/db/demo/settings-repo.test.ts
// ADR-0048 §決定 §2: demo Settings Repo は完全 stateless (write は no-op)。
// 「demo で記録 → リロードで保持」は client sessionStorage 限定 (§決定 P-1.1) であり、
// Lambda 側で settings table に書き込むことはない。

import { describe, expect, it } from 'vitest';
import * as settingsRepo from '../../../../../src/lib/server/db/demo/settings-repo';

describe('demo/settings-repo', () => {
	it('getSetting は常に undefined (fixture なし、Lambda stateless)', async () => {
		expect(await settingsRepo.getSetting('any-key', 'demo')).toBeUndefined();
	});

	it('getSettings は空 record を返す', async () => {
		const result = await settingsRepo.getSettings(['k1', 'k2', 'k3'], 'demo');
		expect(result).toEqual({});
	});

	it('setSetting は no-op (例外を投げない、副作用なし)', async () => {
		await expect(settingsRepo.setSetting('foo', 'bar', 'demo')).resolves.toBeUndefined();
		// 即座に読み取っても、書き込んだ値は永続化されない
		expect(await settingsRepo.getSetting('foo', 'demo')).toBeUndefined();
	});

	it('setSetting を連続呼び出ししても module-level state が mutate されない', async () => {
		await settingsRepo.setSetting('key1', 'value1', 'demo');
		await settingsRepo.setSetting('key2', 'value2', 'demo');
		await settingsRepo.setSetting('key3', 'value3', 'demo');
		// すべて読み取り不可 (AWS Lambda Best Practices: no mutable module-level state)
		expect(await settingsRepo.getSetting('key1', 'demo')).toBeUndefined();
		expect(await settingsRepo.getSetting('key2', 'demo')).toBeUndefined();
		expect(await settingsRepo.getSetting('key3', 'demo')).toBeUndefined();
	});

	it('deleteByTenantId は no-op', async () => {
		await expect(settingsRepo.deleteByTenantId('demo')).resolves.toBeUndefined();
	});
});
