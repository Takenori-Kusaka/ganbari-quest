// tests/unit/security/nuc-compose-cognito-dev-mode-pinned-4836.test.ts
//
// NUC (docker-compose) では isCognitoDevMode() の deploy guard (AWS_LAMBDA_FUNCTION_NAME / IS_NUC_DEPLOY /
// APP_MODE) が効かないため、出荷物である docker-compose.yml の app `environment` が COGNITO_DEV_MODE=false を
// 固定していることが唯一の構造的防御線。compose の `environment` は env_file (.env) より優先されるので、
// この 1 行が消えると operator の .env 1 行で固定パスワードの DEV_USERS が有効になる (#4834 / #4836)。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const compose = readFileSync(join(__dirname, '../../../docker-compose.yml'), 'utf8');

/** `services:` 直下の service block を切り出す (2 space indent の service 名 → 次の service 名まで) */
function serviceBlock(name: string): string {
	const re = new RegExp(
		`^  ${name}:
([sS]*?)(?=^  [a-z-]+:
|(?![sS]))`,
		'm',
	);
	const m = compose.match(re);
	if (!m?.[1]) throw new Error(`docker-compose.yml に service "${name}" が無い`);
	return m[1];
}

describe('NUC compose は COGNITO_DEV_MODE を false に固定する (#4836)', () => {
	it('app service の environment に COGNITO_DEV_MODE=false がある (コメント行ではない)', () => {
		const app = serviceBlock('app');
		const pinned = app.split('
').some((line) => /^\s*-\s*COGNITO_DEV_MODE=false\s*$/.test(line));
		expect(pinned, 'app.environment に `- COGNITO_DEV_MODE=false` を置くこと (env_file より優先される固定値)').toBe(true);
	});

	it('true / 変数展開で上書き可能な形 (COGNITO_DEV_MODE=${...}) にはなっていない', () => {
		const app = serviceBlock('app');
		for (const line of app.split('
')) {
			if (/^\s*#/.test(line)) continue;
			if (!line.includes('COGNITO_DEV_MODE')) continue;
			expect(line).not.toMatch(/COGNITO_DEV_MODE=(true|\$)/);
		}
});
})
