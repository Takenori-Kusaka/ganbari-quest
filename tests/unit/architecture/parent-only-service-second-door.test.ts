// tests/unit/architecture/parent-only-service-second-door.test.ts
//
// **親限定と決めた状態変更に、role を見ない「第 2 の入口」を作らせない** (#4869)。
//
// `authorization.ts` の `ROUTE_RULES` は `/api/v1` を `['owner','parent','child']` に開けている
// (`/api/v1/admin` だけが `['owner','parent']`)。したがって非 admin の `/api/v1/**` では
// **route 自身の role 検査だけが唯一の防御線**になる。
//
// 実際に踏んだ形 (#4869 の CI 三角測量で発見): `DELETE /api/v1/activities/[id]` を親限定にしたが、
// `PATCH /api/v1/activities/[id]/visibility` は同じ `setActivityVisibility(id, false)` を
// **role を見ずに**呼んでいた。DELETE で 403 になった child が、body を `{ isVisible: false }` に
// して別 route を叩けば同じ結果になる。**片方だけ閉じるのは閉じたことにならない。**
//
// 振る舞いの確認 (child で叩いて 403) は `tests/unit/routes/api-parent-only-role-guard.test.ts`
// が持つ。こちらが見るのは**その一覧に載っていない入口が増えていないか**という構造の側で、
// 両方そろって初めて「閉じた」と言える。
//
// 固定する不変条件:
//   [D1] 親限定 service を呼ぶ非 admin `/api/v1` の書き込みハンドラは台帳と完全一致する
//   [D2] そのハンドラは service を呼ぶ**前に** role seam (`parentGateResponse`) で倒している
//   [D3] 台帳の service 名が実在する (改名で検査が空振りしない)

import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test (tests/CLAUDE.md §「repo 走査 test」/ #4085)。
vi.setConfig({ testTimeout: 60_000 });

const ROOT = join(__dirname, '../../..');

/**
 * 親だけが起こしてよい状態変更。値は「子供にやられると何が起きるか」。
 *
 * ここに載せるのは **PO 決裁 2026-09-09「明らかに親限定」** の線に入るものだけ。
 * 判断が要るもの (子供が記録する / 子供が申請する経路) は載せない。
 */
const PARENT_ONLY_SERVICE_CALLS: Readonly<Record<string, string>> = {
	createActivity: '子供が自分用の活動を勝手に増やせる',
	updateActivity: '親が決めた活動の basePoints を子供が書き換えられる',
	setActivityVisibility: '親が見せている活動を子供が消せる / 隠したものを出せる',
	saveRewardTemplates: 'ごほうびテンプレートを子供が書き換えられる',
};

/** service が実在する file (改名されたら [D3] が落ちる)。 */
const SERVICE_FILES = [
	'src/lib/server/services/activity-service.ts',
	'src/lib/server/services/special-reward-service.ts',
];

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * いま親限定 service を呼んでいる非 admin route と、その書き込みハンドラの台帳。
 *
 * **増えたら fail する** — 新しい入口を黙って足せないようにするため。減った場合も fail する
 * (import を消すだけで検査から外れるのを防ぐ)。実際に変えたなら同じ commit でここを直し、
 * `tests/unit/routes/api-parent-only-role-guard.test.ts` の振る舞い側にも足すこと。
 */
const EXPECTED_HANDLERS: Readonly<Record<string, readonly string[]>> = {
	'src/routes/api/v1/activities/+server.ts': ['POST'],
	'src/routes/api/v1/activities/[id]/+server.ts': ['PATCH', 'DELETE'],
	'src/routes/api/v1/activities/[id]/visibility/+server.ts': ['PATCH'],
	'src/routes/api/v1/special-rewards/templates/+server.ts': ['PUT'],
};

type Handler = {
	file: string;
	method: string;
	/** そのハンドラ本文の中で呼んでいる親限定 service。 */
	calls: string[];
	/** role seam の呼び出しが service 呼び出しより前にあるか。 */
	guardedBeforeCall: boolean;
};

/** `i` から始まるコメントの終端 (コメントでなければ -1)。 */
function endOfComment(src: string, i: number): number {
	const two = src.slice(i, i + 2);
	if (two === '//') {
		const nl = src.indexOf('\n', i);
		return nl < 0 ? src.length : nl;
	}
	if (two === '/*') {
		const close = src.indexOf('*/', i + 2);
		return close < 0 ? src.length : close + 2;
	}
	return -1;
}

/** `i` の引用符に対応する閉じ位置 (`\` エスケープは飛ばす)。 */
function endOfQuoted(src: string, i: number, quote: string): number {
	for (let k = i + 1; k < src.length; k++) {
		if (src[k] === '\\') {
			k++;
			continue;
		}
		if (src[k] === quote) return k;
	}
	return src.length;
}

/**
 * コメントと文字列を空白で埋める (**長さは変えない** ので index がずれない)。
 *
 * コメントの中の `setActivityVisibility(…)` や `parentGateResponse(…)` を呼び出しと
 * 数えると、**説明を書いただけで判定が反転する** (実測: visibility route に経緯コメントを
 * 足した時点で [D2] が偽陽性になった)。
 */
function maskNonCode(src: string): string {
	const out = src.split('');
	const blank = (from: number, to: number) => {
		for (let k = from; k < to && k < out.length; k++) {
			if (out[k] !== '\n') out[k] = ' ';
		}
	};
	for (let i = 0; i < src.length; i++) {
		const commentEnd = endOfComment(src, i);
		if (commentEnd >= 0) {
			blank(i, commentEnd);
			i = commentEnd;
			continue;
		}
		const c = src[i];
		if (c === "'" || c === '"' || c === '`') {
			const close = endOfQuoted(src, i, c);
			blank(i + 1, close);
			i = close;
		}
	}
	return out.join('');
}

/** `export const GET: …` / `export async function POST(` の開始位置で本文を切り分ける。 */
function splitHandlers(src: string): { method: string; body: string }[] {
	const START =
		/export\s+(?:async\s+)?(?:const|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
	const marks: { method: string; at: number }[] = [];
	for (;;) {
		const m = START.exec(src);
		if (!m) break;
		marks.push({ method: m[1] ?? '', at: m.index });
	}
	return marks.map((mark, i) => ({
		method: mark.method,
		body: src.slice(mark.at, marks[i + 1]?.at ?? src.length),
	}));
}

const ROUTE_FILES = globSync('src/routes/api/v1/**/+server.ts', { cwd: ROOT })
	.map((f) => f.replace(/\\/g, '/'))
	// `/api/v1/admin` は ROUTE_RULES 側が ['owner','parent'] に閉じているので対象外
	.filter((f) => !f.startsWith('src/routes/api/v1/admin/'))
	.sort();

const FOUND: Handler[] = [];
for (const file of ROUTE_FILES) {
	const src = readFileSync(join(ROOT, file), 'utf8');
	for (const { method, body } of splitHandlers(src)) {
		if (!(WRITE_METHODS as readonly string[]).includes(method)) continue;
		// コメント / 文字列の中の同名を拾わない (経緯コメントで判定が反転する)
		const code = maskNonCode(body);
		const calls = Object.keys(PARENT_ONLY_SERVICE_CALLS).filter((fn) =>
			new RegExp(`\\b${fn}\\s*\\(`).test(code),
		);
		if (calls.length === 0) continue;
		// role 判定はルート横断の唯一の seam (#3528 / 14-セキュリティ設計書 §5.2.3 §5.2.5)。
		// ハンドラ内の ad-hoc な `context.role !== …` は seam ではないので数えない。
		const guardAt = code.indexOf('parentGateResponse(');
		const firstCallAt = Math.min(...calls.map((fn) => code.search(new RegExp(`\\b${fn}\\s*\\(`))));
		FOUND.push({
			file,
			method,
			calls,
			guardedBeforeCall: guardAt >= 0 && guardAt < firstCallAt,
		});
	}
}

describe('[D1][D2][D3] 親限定の状態変更に第 2 の入口を作らせない', () => {
	it('route を 1 件以上見つけている (glob が空振りしていない)', () => {
		expect(ROUTE_FILES.length).toBeGreaterThan(20);
	});

	it('[D3] 台帳の service 名が実在する (改名で検査が空振りしない)', () => {
		const src = SERVICE_FILES.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
		const missing = Object.keys(PARENT_ONLY_SERVICE_CALLS).filter(
			(fn) => !new RegExp(`export\\s+(?:async\\s+)?function\\s+${fn}\\b`).test(src),
		);
		expect(
			missing.join(', '),
			`${SERVICE_FILES.join(' / ')} に export されていない名前が台帳にある。` +
				'改名したなら台帳も同じ commit で直すこと (名前が消えると本検査は全 route を素通りさせる)',
		).toBe('');
	});

	it('[D1] 親限定 service を呼ぶ書き込みハンドラが台帳と完全一致する', () => {
		const actual: Record<string, string[]> = {};
		for (const h of FOUND) {
			const methods = actual[h.file] ?? [];
			methods.push(h.method);
			actual[h.file] = methods;
		}
		const files = [...new Set([...Object.keys(EXPECTED_HANDLERS), ...Object.keys(actual)])].sort();
		const diff = files
			.map((f) => ({
				f,
				want: [...(EXPECTED_HANDLERS[f] ?? [])].sort().join('/') || '(なし)',
				got: [...(actual[f] ?? [])].sort().join('/') || '(なし)',
			}))
			.filter((r) => r.want !== r.got);
		expect(
			diff.map((r) => `${r.f}: 台帳 ${r.want} / 実測 ${r.got}`).join('\n'),
			'親限定 service を呼ぶ入口が台帳とずれている。増やしたなら EXPECTED_HANDLERS と ' +
				'tests/unit/routes/api-parent-only-role-guard.test.ts の振る舞い側の両方に足すこと ' +
				'(#4869: DELETE だけ閉じて visibility を開けたままにした形の再発防止)',
		).toBe('');
	});

	for (const h of FOUND) {
		it(`[D2] ${h.file} ${h.method} — ${h.calls.join(' / ')} を呼ぶ前に seam で倒している`, () => {
			expect(
				h.guardedBeforeCall,
				`${h.file} の ${h.method} が role seam なし (または service 呼び出しより後) で ` +
					`${h.calls.map((fn) => `${fn} (${PARENT_ONLY_SERVICE_CALLS[fn]})`).join(' / ')} を呼んでいる。` +
					'/api/v1 は ROUTE_RULES が child を通すので、この経路自身が止める以外に場所が無い',
			).toBe(true);
		});
	}
});
