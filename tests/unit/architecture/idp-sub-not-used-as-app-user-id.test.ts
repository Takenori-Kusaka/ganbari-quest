// tests/unit/architecture/idp-sub-not-used-as-app-user-id.test.ts
//
// #4643 (fitness function): `Identity.userId` は **IdP (Cognito) の sub** であり、アプリ DB の
// `users.user_id` (DB 生成 UUID) ではない。両者が一致することは無いため、sub を DB の user id
// として渡すコードは必ず取り違える — しかも「行が見つからない」だけなので例外にならず、
// 削除が 0 件・本人判定が常に false・自己招待 guard が不発、という形で静かに壊れる。
//
// #4643 の是正で、セッションのアプリ側 user id は `AuthContext.userId` (= `requireAppUserId`)
// に一本化した。本 guard は `src/routes` / `src/lib/server` から `identity.userId` を新しく
// 参照したら落ちる (log 用途など、DB を引かない参照だけを理由付きで allowlist する)。

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../../..');
const SCAN_ROOTS = ['src/routes', 'src/lib/server'];

/**
 * `identity.userId` を参照してよい file と、その理由。
 * DB の user id としてではなく **IdP の sub そのもの**を必要とする箇所だけを許す。
 */
const ALLOWLIST: Record<string, string> = {
	'src/lib/server/auth/audit-actor.ts':
		'監査ログの actor 識別子。DB を引かず、IdP 上の主体をそのまま記録する用途 (関数の doc に明記)',
	'src/lib/server/auth/owner-gate.ts':
		'403 拒否ログの actorUserId。ログ出力のみで DB 参照に使わない',
	'src/lib/server/auth/providers/cognito.ts':
		'sub → アプリ user への解決点そのもの (email 経由)。ここだけが両者を橋渡しする',
};

function listSourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
		const rel = `${dir}/${entry.name}`;
		if (entry.isDirectory()) {
			listSourceFiles(rel, acc);
		} else if (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte')) {
			acc.push(rel);
		}
	}
	return acc;
}

/** `identity.userId` / `identity?.userId` / `locals.identity.userId` を拾う。 */
const SUB_REFERENCE = /\bidentity\??\.userId\b/;

/**
 * コメントを落としてから走査する。**コメントで理由を説明することは禁止しない** — 本 guard が
 * 見るのは「コードとして sub を使っているか」だけである (説明文まで禁じると、なぜ使わないかを
 * 書き残せなくなる)。
 */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('#4643 IdP sub を アプリ user id として使わない', () => {
	it('src/routes と src/lib/server で identity.userId を参照するのは allowlist の file だけ', () => {
		const offenders: string[] = [];
		for (const root of SCAN_ROOTS) {
			for (const file of listSourceFiles(root)) {
				if (file in ALLOWLIST) continue;
				const source = stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'));
				if (SUB_REFERENCE.test(source)) offenders.push(file);
			}
		}

		expect(
			offenders,
			`identity.userId (IdP の sub) を参照しています。DB の user id が要るなら\n` +
				`requireAppUserId(locals) / locals.context.userId を使ってください (#4643)。\n` +
				`sub そのものが要る場合は本 test の ALLOWLIST に理由付きで追加してください。\n` +
				`該当: ${offenders.join(', ')}`,
		).toEqual([]);
	}, 30_000);

	it('allowlist の file が実在する (削除された file を許可し続けない)', () => {
		for (const file of Object.keys(ALLOWLIST)) {
			const source = stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'));
			expect(
				SUB_REFERENCE.test(source),
				`${file} は identity.userId を参照しなくなりました。ALLOWLIST から外してください`,
			).toBe(true);
		}
	});
});
