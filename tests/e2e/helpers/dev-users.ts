// tests/e2e/helpers/dev-users.ts
//
// cognito-dev E2E が使う DEV_USERS の資格情報を SSOT (`src/lib/server/auth/providers/cognito-dev.ts`)
// から引く。Playwright の test は SvelteKit の `$lib` alias / server module を import できないため、
// scripts/capture-specs/lib/dev-users.mjs と同じ方法で SSOT のソースを読んで取り出す。
// 取り出しが SSOT と一致することは tests/unit/scripts/capture-dev-users-ssot.test.ts が固定する。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '../../..');
export const DEV_USERS_SOURCE = 'src/lib/server/auth/providers/cognito-dev.ts';

export interface DevUserCredential {
	email: string;
	password: string;
}

/** cognito-dev.ts の DEV_USERS 配列から `{ email, password }` を列挙する (email → password の順が SSOT の書式)。 */
export function loadDevUsers(
	source: string = readFileSync(join(REPO_ROOT, DEV_USERS_SOURCE), 'utf8'),
): DevUserCredential[] {
	const start = source.indexOf('export const DEV_USERS');
	if (start < 0) throw new Error(`${DEV_USERS_SOURCE} に DEV_USERS が見つかりません`);
	const users: DevUserCredential[] = [];
	const re = /email:\s*'([^']+)'[\s\S]*?password:\s*'([^']+)'/g;
	for (const m of source.slice(start).matchAll(re)) {
		const [, email, password] = m;
		if (email && password) users.push({ email, password });
	}
	if (users.length === 0) throw new Error(`${DEV_USERS_SOURCE} から資格情報を取り出せません`);
	return users;
}

/** email で DEV_USER を引く。無ければ throw (test が黙って別 user で通らないように)。 */
export function devUser(email: string): DevUserCredential {
	const found = loadDevUsers().find((u) => u.email === email);
	if (!found) throw new Error(`DEV_USERS に ${email} がありません (${DEV_USERS_SOURCE})`);
	return found;
}

/** password だけ引く。 */
export function devPassword(email: string): string {
	return devUser(email).password;
}
