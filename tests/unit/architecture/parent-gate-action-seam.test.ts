// tests/unit/architecture/parent-gate-action-seam.test.ts
//
// **親 PIN gate の強制点が 2 つの door に閉じていること**を固定する
// (#4866 系 QM 監査 / PO 決裁 2026-09-10 決定 4)。
//
// ## なぜ要るか
//
// 元の PIN gate は `(parent)/admin/+layout.server.ts` の**インライン 1 箇所**にしか無く、
// page の `load` しか通らなかった。`/api/v1/admin/**` の 25 本と form action 22 file が
// 素通りしていたのに、設計書は「アプリ層（全経路）」と書いていた。
//
// 穴が空いた原因は「書き忘れ」ではなく、**書く場所が 1 箇所に決まっていなかった**こと。
// なので、この test は文言でも件数でもなく **door が 2 つしか無いこと**を固定する:
//
//   [S1] API 経路の door は `hooks.server.ts` の `enforceParentGate` 1 本
//   [S2] form action の door は `withParentGate` 1 本 — admin の `actions` は全部これを通る
//   [S3] action の中で個別に gate を書き直していない (第 2 の door を作らない、#3528 と同型)
//
// [S2] があるので、**次に admin へ page を足した人が gate を書き忘れても**この test が落ちる。

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test (tests/CLAUDE.md §「repo 走査 test」/ #4085)。unit lane の並列実行で
// FS を奪い合っても既定 5s を超えないよう明示 timeout を置く。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const ADMIN_ROOT = join(REPO_ROOT, 'src', 'routes', '(parent)', 'admin');

function collectPageServerFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...collectPageServerFiles(full));
		} else if (entry.name === '+page.server.ts') {
			out.push(full);
		}
	}
	return out;
}

function toRepoPath(full: string): string {
	return full
		.slice(REPO_ROOT.length + 1)
		.split('\\')
		.join('/');
}

const ADMIN_PAGE_SERVERS = collectPageServerFiles(ADMIN_ROOT).map((full) => ({
	path: toRepoPath(full),
	source: readFileSync(full, 'utf-8'),
}));

const WITH_ACTIONS = ADMIN_PAGE_SERVERS.filter((f) => /^export const actions\b/m.test(f.source));

describe('[S1] API 経路の door は hooks.server.ts の 1 本', () => {
	const hooks = readFileSync(join(REPO_ROOT, 'src', 'hooks.server.ts'), 'utf-8');

	it('hooks.server.ts が enforceParentGate を呼ぶ', () => {
		expect(
			hooks,
			'API 側の gate を hooks から外すと `/api/v1/admin/**` が丸ごと素通りに戻る',
		).toContain('enforceParentGate(');
	});

	it('戻り値を握りつぶさず Response として返している', () => {
		// `enforceParentGate(...)` を呼ぶだけで返さないと、**呼んでいるのに通る**状態になる。
		expect(hooks).toMatch(/enforceParentGate\([\s\S]{0,700}?\);\s*if \(\w+\) return \w+;/);
	});

	it('認証解決 (locals.context 確定) より後で呼んでいる', () => {
		// `verifyParentSession` は `tenantId` が未確定だと**必ず false** を返す
		// (`if (!tenantId) return false`)。context 確定より前に置くと、正しい PIN session を
		// 持つ保護者まで 403 になり、admin が丸ごと使えなくなる (実装中に実際に踏んだ)。
		const contextAssigned = hooks.indexOf('event.locals.context = context;');
		const gateCalled = hooks.indexOf('enforceParentGate(');
		expect(contextAssigned).toBeGreaterThan(-1);
		expect(gateCalled).toBeGreaterThan(contextAssigned);
	});
});

describe('[S2] admin の form action は全部 withParentGate を通る', () => {
	it('actions を持つ +page.server.ts が 1 件以上ある (走査が空振りしていない)', () => {
		expect(WITH_ACTIONS.length).toBeGreaterThanOrEqual(20);
	});

	for (const file of WITH_ACTIONS) {
		it(`${file.path}`, () => {
			expect(
				file.source,
				`${file.path} の actions が withParentGate を通っていない。` +
					'admin の form action は「書き込み」なので PO 決定 4(b) の対象で、' +
					'ここを素通りさせると PIN 無しで家庭の設定を書き換えられる',
			).toMatch(/export const actions[^=]*=\s*withParentGate\(\{/);
			expect(file.source).toContain(
				"import { withParentGate } from '$lib/server/auth/parent-gate';",
			);
			// **内側の `satisfies Actions` を必須にする。** `withParentGate` の型引数の制約は
			// route 固有 `Actions` を受けるために緩めてあり、contextual type をここから
			// 供給しないと action の引数 (`request` / `locals` / `formData`) が軒並み any になる
			// (実測: type-coverage 97.12% → 96.64%)。gate が効いていても型が消えるのは別の劣化。
			expect(
				file.source,
				`${file.path}: withParentGate({ … } satisfies Actions) の形で書くこと ` +
					'(内側の satisfies が無いと action の引数が型を失う)',
			).toContain('} satisfies Actions);');
		});
	}
});

describe('[S3] action の中で gate を書き直していない', () => {
	// 「ここだけ特別」を各 action に書き始めると door が増え、元の穴と同じ形に戻る。
	// gate の判定 API (`parentGateBlocked` / `verifyParentSession`) を admin の
	// +page.server.ts が直接呼ぶことを禁じる。判定は seam の中だけで行う。
	for (const file of ADMIN_PAGE_SERVERS) {
		it(`${file.path}`, () => {
			expect(file.source).not.toContain('verifyParentSession');
			expect(file.source).not.toContain('parentGateBlocked');
		});
	}
});
