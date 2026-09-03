// scripts/capture-specs/lib/dev-users.mjs
//
// 撮影 flow が cognito-dev のログインに使う DEV_USERS の資格情報を 1 箇所から引く。
// SSOT は `src/lib/server/auth/providers/cognito-dev.ts` の `DEV_USERS` (TypeScript)。
// 撮影 script は素の node (.mjs) で走り TS を import できないため、SSOT のソースを読んで
// `email` / `password` の組を取り出す。値の複製 (各 flow への password 直書き) は持たない。
// 取り出しが SSOT と一致することは tests/unit/scripts/capture-dev-users-ssot.test.ts が固定する。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEV_USERS_SOURCE = 'src/lib/server/auth/providers/cognito-dev.ts';

/**
 * cognito-dev.ts の DEV_USERS 配列から `{ email, password }` を列挙する。
 * オブジェクトリテラルごとに email → password の順で並ぶ前提 (SSOT の書式)。
 */
export function loadDevUsers(source = readFileSync(join(REPO_ROOT, DEV_USERS_SOURCE), 'utf8')) {
	const start = source.indexOf('export const DEV_USERS');
	if (start < 0) throw new Error(`${DEV_USERS_SOURCE} に DEV_USERS が見つかりません`);
	const body = source.slice(start);
	const users = [];
	const re = /email:\s*'([^']+)'[\s\S]*?password:\s*'([^']+)'/g;
	for (const m of body.matchAll(re)) {
		users.push({ email: m[1], password: m[2] });
	}
	if (users.length === 0) throw new Error(`${DEV_USERS_SOURCE} から資格情報を取り出せません`);
	return users;
}

/** email で DEV_USER を引く。無ければ throw (撮影 flow が黙って別 user で通らないように)。 */
export function devUser(email) {
	const found = loadDevUsers().find((u) => u.email === email);
	if (!found) throw new Error(`DEV_USERS に ${email} がありません (${DEV_USERS_SOURCE})`);
	return found;
}

/** password だけ引く (login(page, email, password) 形の flow 向け)。 */
export function devPassword(email) {
	return devUser(email).password;
}
