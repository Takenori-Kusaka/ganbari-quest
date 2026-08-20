// tests/unit/db/settings-all-tenants.test.ts
// #4706: `getSettingForAllTenants` が返す tenantId が、その backend の `listAllTenants()` が
// 返す tenantId と一致することを固定する。
//
// 配信 cron は「listAllTenants の一覧」と「getSettingForAllTenants の Map」を tenantId で
// 突き合わせて対象を決める。ここが食い違うと **その backend でだけ通知が 1 通も出ない**。
// 出ないことは画面にも log にも出ない (0 件は正常な状態と区別がつかない) ため、
// 静かに壊れる典型で、型でも防げない。文字列の一致そのものを test で固定する。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');

function read(rel: string): string {
	return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

/** `const NAME = 'value';` の value を取り出す。 */
function constValue(source: string, name: string): string | undefined {
	return new RegExp(`const ${name}\\s*=\\s*'([^']+)'`).exec(source)?.[1];
}

describe('#4706 getSettingForAllTenants の tenantId が listAllTenants と一致する', () => {
	it('sqlite: settings-repo の SQLITE_TENANT_ID が auth-repo の LOCAL_TENANT_ID と同値', () => {
		const settingsSource = read('src/lib/server/db/sqlite/settings-repo.ts');
		const authSource = read('src/lib/server/db/sqlite/auth-repo.ts');

		const settingsTenantId = constValue(settingsSource, 'SQLITE_TENANT_ID');
		const authTenantId = constValue(authSource, 'LOCAL_TENANT_ID');

		// 対照: 検査が空振りしていない (両方とも実在する)
		expect(settingsTenantId, 'SQLITE_TENANT_ID が見つからない').toBeDefined();
		expect(authTenantId, 'LOCAL_TENANT_ID が見つからない').toBeDefined();
		expect(settingsTenantId, '食い違うと NUC (sqlite backend) でだけ通知配信が 1 通も出ない').toBe(
			authTenantId,
		);
	});

	it('demo: settings-repo の DEMO_TENANT_ID が demo-data の DEMO_TENANT_ID と同値', () => {
		const settingsTenantId = constValue(
			read('src/lib/server/db/demo/settings-repo.ts'),
			'DEMO_TENANT_ID',
		);
		const dataTenantId = constValue(read('src/lib/server/demo/demo-data.ts'), 'DEMO_TENANT_ID');

		expect(settingsTenantId).toBeDefined();
		expect(dataTenantId).toBeDefined();
		expect(settingsTenantId).toBe(dataTenantId);
	});

	it('全 backend が getSettingForAllTenants を実装している (欠けると型では気付けない silent gap)', () => {
		for (const rel of [
			'src/lib/server/db/dsql/settings-repo.ts',
			'src/lib/server/db/sqlite/settings-repo.ts',
			'src/lib/server/db/demo/settings-repo.ts',
		]) {
			expect(read(rel), `${rel} に getSettingForAllTenants が無い`).toContain(
				'getSettingForAllTenants',
			);
		}
	});
});
