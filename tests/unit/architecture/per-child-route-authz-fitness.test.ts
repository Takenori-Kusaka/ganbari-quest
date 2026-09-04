// tests/unit/architecture/per-child-route-authz-fitness.test.ts
//
// 「`/api/v1/**` の route が要求から childId を受け取るなら、その childId が要求者のものであることを
// 検証している」ことを機械強制する fitness function。
//
// 背景:
//   `ROUTE_RULES` (`src/lib/server/auth/authorization.ts`) は `/api/v1` を
//   `['owner','parent','child']` に開いている。これは正しい — 子供は自分のポイント・メッセージ・
//   記録を読み書きするからで、ここを閉じると子供画面が全部死ぬ。したがって
//   **「その childId が要求者のものか」を見るのは route 側の責務**であり、その唯一の seam が
//   `requireChildAccess` / `requireChildScope` (`src/lib/server/auth/guards.ts`) である。
//
//   ところがこの guard は **本番コードから 1 度も呼ばれていなかった** (単体テストだけが呼んでいた)。
//   結果、child セッションは URL / body / query / cookie の childId を差し替えるだけで
//   兄弟の私信・ポイント・週次評価を読み、ボイスを消し、顔写真を差し替え、ログインボーナスを
//   先取りできた (家庭内 IDOR / CWE-639)。`docs/design/14-セキュリティ設計書.md` はこの class を
//   自ら名指ししているが、実際に塞がれていたのは export endpoint だけで、それを見る fitness
//   (`tests/unit/routes/export-authz-symmetry-3246.test.ts`) も `export/` prefix に閉じていた。
//
//   本 test はその適用範囲を `/api/v1/**` 全体に広げた対の装置である
//   (`ops-route-auth-fitness` #4309 / `cron-route-auth-fitness` #4206 と同型)。
//
// 検証範囲:
//   [P1] 母数 — 実 FS 上の `src/routes/api/v1/**/+server.ts` を列挙する (literal 固定禁止)。
//        新しい per-child API を足した人が本 test を書き換えなくても自動で検査対象に入る。
//   [P2] 候補判定 — コメント / 文字列を潰したコードに「要求由来の childId」が現れる route を候補とする。
//        コメントだけで候補から外れたり、コメントに書いた guard 名で緑になったりしないよう
//        `stripCommentsAndStrings` を通す (#4206 の実測教訓)。
//   [P3] 候補は guard を **import し、かつ呼んで** いること (import だけの素通しを検出する)。
//   [P4] no-silent-gap — 候補なのに guard を呼ばない route は、理由と根拠 (basis) 付きで
//        `PER_CHILD_GUARD_EXEMPTIONS` に宣言されていなければ fail。
//   [P5] 除外宣言は **機械で反証可能** であること。basis ごとに「その主張が今も成り立つか」を
//        実コードに当てて検証する (宣言しただけで通る自由 pass を作らない)。
//   [P6] stale 宣言の除去 — 実在しない / もう候補でない / 既に guard を呼んでいる route が
//        除外に残っていたら fail。
//
// 候補 0 件は異常 (判定の綴りが変わった等) として fail する。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { stripCommentsAndStrings } from './helpers/strip-comments-and-strings';

// #4085: 走査 test の区分は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT。
// 本 test の走査は src/routes/api/v1 配下の単一サブツリーで有界 (scope: 'bounded') のため
// 明示 timeout は要求されないが、file 数の増加で unit lane の既定 5s を超えないよう置いておく
// (tests/CLAUDE.md §「repo 走査 test」)。
vi.setConfig({ testTimeout: 60_000 });

/** per-child API の実体ディレクトリ (母数の SSOT。literal 列挙は禁止) */
const API_V1_DIR = 'src/routes/api/v1';

/** per-child scope の単一強制点。ここを変えるときは guards.ts と同時に変える */
const CHILD_GUARDS = ['requireChildAccess', 'requireChildScope'] as const;

/**
 * 除外の根拠。宣言文だけでなく **実コードに当てて検証する** ため enum にしてある。
 *
 * - `admin-prefix`: `/api/v1/admin/**` は `ROUTE_RULES` が owner/parent に限定しており
 *   child ロールは認可層で 403 になる (route 到達前に閉じている)。
 * - `role-gate` : route 自身が `requireRole(locals, [...])` を呼び、許可ロールに child を
 *   含まない (export / import 系)。
 * - `context-only`: 要求から childId を受け取らず、自分の `context.childId` しか読まない。
 */
type ExemptionBasis = 'admin-prefix' | 'role-gate' | 'context-only';

interface Exemption {
	basis: ExemptionBasis;
	reason: string;
}

/**
 * guard を通さないことが正当な route。**理由と根拠を必ず書く**。
 *
 * ここに足すときは「child ロールがこの endpoint に到達しても per-child データに触れないこと」を
 * 説明できること。説明できないなら guard を足す側が正しい。
 */
const PER_CHILD_GUARD_EXEMPTIONS: Record<string, Exemption> = {
	'src/routes/api/v1/admin/cleanup-orphans/+server.ts': {
		basis: 'admin-prefix',
		reason:
			'孤児ファイルの storage key から childId を切り出すだけの運用 API。/api/v1/admin は ROUTE_RULES が owner/parent 限定',
	},
	'src/routes/api/v1/admin/downgrade-archive/+server.ts': {
		basis: 'admin-prefix',
		reason:
			'ダウングレード時に残す子供を親が選ぶ family scope の操作 (childIds 配列)。/api/v1/admin は owner/parent 限定',
	},
	'src/routes/api/v1/admin/invites/+server.ts': {
		basis: 'admin-prefix',
		reason:
			'子供アカウント招待の発行。/api/v1/admin は ROUTE_RULES が owner/parent 限定で child は到達しない',
	},
	'src/routes/api/v1/activities/export/+server.ts': {
		basis: 'role-gate',
		reason: '#3246 で owner/parent 限定済 (export-authz-symmetry-3246 が別途 gate を固定)',
	},
	'src/routes/api/v1/activities/import/+server.ts': {
		basis: 'role-gate',
		reason: '取込は親の操作。requireRole(owner/parent) 済',
	},
	'src/routes/api/v1/special-rewards/export/+server.ts': {
		basis: 'role-gate',
		reason: '#3246 で owner/parent 限定済 (家庭内 IDOR を role gate 側で塞いだ最初の 3 本)',
	},
	'src/routes/api/v1/export/+server.ts': {
		basis: 'role-gate',
		reason:
			'家族全体のバックアップ (childIds は対象children の絞り込み)。#3246 で owner/parent 限定済',
	},
	'src/routes/api/v1/import/cloud/+server.ts': {
		basis: 'role-gate',
		reason: 'クラウドバックアップの復元は親の操作。requireRole(owner/parent) 済',
	},
	'src/routes/api/v1/notifications/subscribe/+server.ts': {
		basis: 'context-only',
		reason: '要求から childId を受け取らず、購読ログに自分の context.childId を書くだけ',
	},
};

interface ApiEndpoint {
	/** repo root からの相対パス (POSIX 区切り) */
	file: string;
	/** コメント / 文字列リテラルを除去した実コード (guard の**呼び出し**検査用) */
	code: string;
	/**
	 * コメントだけを除去したソース (childId を**読んでいるか**の検査用)。
	 *
	 * 文字列リテラルまで潰すと `url.searchParams.get('childId')` が
	 * `url.searchParams.get( )` になり、受け側の変数名が `childIdRaw` のような綴りだと
	 * 候補から漏れる (実測: `activities/export` が候補にならなかった)。
	 * 読み取りの検出は「取りこぼすより広く取る」側に倒し、余分に拾ったものは
	 * 理由付きの除外宣言で落とす。
	 */
	detectSource: string;
	/** 元のソース (import 検査用) */
	source: string;
}

/** コメントだけを空白に潰す (文字列リテラルは残す)。 */
function stripCommentsOnly(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** `/api/v1` 配下の `+server.ts` を再帰的に集める (母数は公開範囲と一致させる)。 */
function collectApiEndpoints(dir: string, acc: ApiEndpoint[] = []): ApiEndpoint[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collectApiEndpoints(full, acc);
		} else if (entry.name === '+server.ts') {
			const source = fs.readFileSync(full, 'utf8');
			acc.push({
				file: full.split(path.sep).join('/'),
				code: stripCommentsAndStrings(source),
				detectSource: stripCommentsOnly(source),
				source,
			});
		}
	}
	return acc;
}

/**
 * 「要求由来の childId」に触れているか。
 *
 * `context.childId` (= 自分自身。要求が指定したものではない) だけを除いて、それ以外の
 * `childId` / `childIds` / `rawChildId` 等の綴りを **大小文字を無視して** 拾う。
 * 綴りの揺れで検査対象から漏れるより、拾いすぎて宣言を要求する側に倒している。
 */
function readsRequestChildId(detectSource: string): boolean {
	return /child_?id/i.test(detectSource.replace(/context\.childId\b/g, ' '));
}

/** guard を import し、かつ呼んでいるか (import だけの素通しを弾く)。 */
function callsChildGuard(endpoint: ApiEndpoint): boolean {
	return CHILD_GUARDS.some((guard) => {
		const imported = new RegExp(`import[\\s\\S]*?\\b${guard}\\b[\\s\\S]*?from`).test(
			endpoint.source,
		);
		const called = new RegExp(`\\b${guard}\\s*\\(`).test(endpoint.code);
		return imported && called;
	});
}

/** 除外の根拠が実コードで今も成り立つかを検証する。成り立たなければ違反理由を返す。 */
function checkExemptionBasis(endpoint: ApiEndpoint, basis: ExemptionBasis): string | null {
	if (basis === 'admin-prefix') {
		return endpoint.file.startsWith('src/routes/api/v1/admin/')
			? null
			: 'admin-prefix を主張しているが /api/v1/admin 配下ではない';
	}
	if (basis === 'role-gate') {
		const m = endpoint.code.match(/requireRole\s*\(\s*locals\s*,\s*\[([^\]]*)\]/);
		if (!m) return 'role-gate を主張しているが requireRole(locals, [...]) が無い';
		return /child/.test(m[1] ?? '') ? 'requireRole の許可ロールに child が含まれている' : null;
	}
	// context-only: `context.childId` と、その値を載せるオブジェクトキー (`childId:`) 以外の
	// 綴りが残っていたら「要求から受け取っている」= 主張が崩れている。
	const rest = endpoint.detectSource
		.replace(/context\.childId\b/g, ' ')
		.replace(/\bchildId\s*:/g, ' ');
	return /child_?id/i.test(rest)
		? 'context-only を主張しているが context 以外から childId を読んでいる'
		: null;
}

const endpoints = collectApiEndpoints(API_V1_DIR);
const candidates = endpoints.filter((e) => readsRequestChildId(e.detectSource));

describe('per-child route 認可 fitness (/api/v1/** の家庭内 IDOR ガード)', () => {
	it('[P1] 母数: /api/v1 配下の +server.ts を実 FS から列挙できる', () => {
		expect(endpoints.length).toBeGreaterThan(50);
	});

	it('[P2] 候補: 要求由来の childId を読む route が検出できている', () => {
		// 0 件 = 判定の綴りが変わった等の異常。silent に「全部 OK」で通さない。
		expect(candidates.length).toBeGreaterThan(10);
	});

	it('[P3][P4] 要求由来の childId を読む route は guard を通す (未通過は理由付き宣言が必須)', () => {
		const offenders = candidates
			.filter((e) => !callsChildGuard(e))
			.map((e) => e.file)
			.filter((file) => !(file in PER_CHILD_GUARD_EXEMPTIONS));

		expect(
			offenders,
			`requireChildAccess / requireChildScope を通していない per-child route:\n  ${offenders.join('\n  ')}\n` +
				'child ロールは /api/v1 に到達できるため、childId を差し替えるだけで兄弟のデータに届く。\n' +
				'guard を足すか、PER_CHILD_GUARD_EXEMPTIONS に basis + reason を付けて宣言すること。',
		).toEqual([]);
	});

	it('[P5] 除外宣言は実コードで反証可能 (basis の主張が今も成り立つ)', () => {
		const broken: string[] = [];
		for (const [file, exemption] of Object.entries(PER_CHILD_GUARD_EXEMPTIONS)) {
			const endpoint = endpoints.find((e) => e.file === file);
			if (!endpoint) continue; // [P6] が stale として別途 fail させる

			if (exemption.reason.trim().length < 12) {
				broken.push(`${file}: reason が短すぎる (定型 stub 禁止)`);
			}
			const violation = checkExemptionBasis(endpoint, exemption.basis);
			if (violation) broken.push(`${file}: ${violation}`);
		}
		expect(broken, `除外宣言と実コードの食い違い:\n  ${broken.join('\n  ')}`).toEqual([]);
	});

	it('[P6] stale な除外宣言が残っていない', () => {
		const stale: string[] = [];
		for (const file of Object.keys(PER_CHILD_GUARD_EXEMPTIONS)) {
			const endpoint = endpoints.find((e) => e.file === file);
			if (!endpoint) {
				stale.push(`${file}: file が存在しない`);
				continue;
			}
			if (!readsRequestChildId(endpoint.detectSource)) {
				stale.push(`${file}: もう要求由来の childId を読んでいない (除外不要)`);
			}
			if (callsChildGuard(endpoint)) {
				stale.push(`${file}: guard を通すようになった (除外を外すこと)`);
			}
		}
		expect(stale, `不要になった除外宣言:\n  ${stale.join('\n  ')}`).toEqual([]);
	});
});
