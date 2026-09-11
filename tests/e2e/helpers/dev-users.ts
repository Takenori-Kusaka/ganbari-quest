// tests/e2e/helpers/dev-users.ts
//
// cognito-dev E2E が使う DEV_USERS の資格情報を SSOT (`src/lib/server/auth/providers/cognito-dev.ts`)
// から引く。Playwright の test は SvelteKit の `$lib` alias / server module を import できないため、
// scripts/capture-specs/lib/dev-users.mjs と同じ方法で SSOT のソースを読んで取り出す。
// 取り出しが SSOT と一致することは tests/unit/scripts/capture-dev-users-ssot.test.ts が固定する。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEV_USERS_SOURCE = 'src/lib/server/auth/providers/cognito-dev.ts';

/**
 * repo root を cwd から上向きに探す。Playwright は test を ES module として読むため `__dirname` が
 * 無く (adv-4832 実測: ReferenceError)、vitest (jsdom) では `import.meta.url` が file: URL でない
 * (`The URL must be of scheme file`)。どの runner でも成立する「SSOT file が見つかる dir」で解決する。
 */
function findRepoRoot(): string {
	let dir = process.cwd();
	for (let i = 0; i < 8; i++) {
		if (existsSync(join(dir, DEV_USERS_SOURCE))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(`repo root が見つかりません (cwd=${process.cwd()}、${DEV_USERS_SOURCE} を探索)`);
}
const REPO_ROOT = findRepoRoot();

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
