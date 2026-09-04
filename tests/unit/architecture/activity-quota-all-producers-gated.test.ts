// tests/unit/architecture/activity-quota-all-producers-gated.test.ts
//
// #4693 PO 判断「quota は strategy 層で一元強制し、経路 (手動 / 一括 / コピー / 取込 / 復元 / REST)
// が増えても素通りしない構造にする + fitness test (全 insert 経路が quota 関数を通ること)」の
// fitness function (Architecture Fitness Function、ADR-0061)。
//
// child_activities を新しく作る呼び出し箇所 (producer) を src から機械的に列挙し、各 producer が
// どこで quota gate (`enforceActivityQuota` / `checkActivityLimit`) を通るかを registry で宣言する。
// - registry に無い producer が現れたら fail (no-silent-gap: 経路を足したら gate 位置を決めさせる)
// - 宣言された gate file が実際に gate 関数を呼んでいなければ fail (宣言だけの空洞化を防ぐ)
// - registry に書かれた producer が実在しなければ fail (撤去済み経路の記述が腐らない)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test (tests/CLAUDE.md §repo 走査 test、#4085): unit lane の並列実行で timeout を超えないよう明示する
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = join(__dirname, '../../..');
const SCAN_ROOTS = ['src/lib/server/services', 'src/routes'];

/** child_activities に行を作る repo 呼び出し (repo 実装自体と test は対象外) */
const PRODUCER_CALL = /childActivity(?:Repo)?\s*\.\s*(insertActivity|insertActivitiesBulk)\s*\(/;
// #4693 (PO 回答 2026-09-03 #2): 復元経路の gate は「捨てる」ではなく「archived で入れる」に
// 変わったため、`archiveActivityQuotaOverflow` も quota gate として数える (どちらも
// activity-quota.ts の同じ判定 `judgeActivityQuota` を通る)。
const GATE_CALL = /\b(enforceActivityQuota|archiveActivityQuotaOverflow|checkActivityLimit)\s*\(/;

/**
 * route の form action ごとに gate を要求する表 (#4693 QM 再レビュー)。
 *
 * 「宣言された file のどこかに gate 呼び出しが 1 つでもあれば通る」検査は、**5 action のうち
 * 2 つを無 gate にしても緑のまま**だった (実測: `importPack` / `importPackToChildren` から
 * `checkActivityLimit` を外しても fail しない。極端には 1 action だけ残せば全部外せる)。
 * これでは「経路を足したら gate 位置を決めさせる」という本 test の目的を満たさないので、
 * **action 単位**で「gate を通す」か「通さない (理由付き)」を宣言させる。
 *
 * `exempt` の理由は空文字だと下の test が落とす (理由なしの素通しを作らない)。
 */
const ACTION_GATE_REGISTRY: Record<
	string,
	{ gated: readonly string[]; exempt: Readonly<Record<string, string>> }
> = {
	'src/routes/(parent)/admin/activities/+page.server.ts': {
		gated: ['create', 'bulkCreateForChildren', 'copyFromChild'],
		exempt: {
			importPack:
				'marketplace プリセット取込は seed 行しか作らず custom quota を消費しない (#4693 PO 回答 #1)',
			importPackToChildren:
				'同上。取込側の上限は strategy 層 enforceActivityQuota が custom 行だけを見て切る',
			importFile:
				'バックアップ復元は strategy 層 archiveActivityQuotaOverflow が超過分を保管する。捨てないので route で 403 にしない (#4693 PO 回答 #2)',
			edit: '既存行の更新のみ。child_activities の行数を増やさないので quota に影響しない',
			delete: '行を減らす操作。quota を消費しない',
			toggleVisibility: '既存行の表示切替のみ。行数を増やさない',
			toggleMainQuest: '既存行のメインクエスト切替のみ。行数を増やさない',
			clearAll: '行を全削除する操作。quota を消費しない',
		},
	},
};

/** `actions` オブジェクト直下の action 名 → 本文 (次の action 宣言まで) を切り出す。 */
function splitActions(src: string): Map<string, string> {
	const bodies = new Map<string, string>();
	const decl = /^\t(\w+):\s*async\s*\(/gm;
	const starts: { name: string; at: number }[] = [];
	let m = decl.exec(src);
	while (m !== null) {
		const name = m[1];
		if (name !== undefined) starts.push({ name, at: m.index });
		m = decl.exec(src);
	}
	for (const [i, s] of starts.entries()) {
		bodies.set(s.name, src.slice(s.at, starts[i + 1]?.at ?? src.length));
	}
	return bodies;
}

/**
 * producer file → その経路の quota gate を呼ぶ file (同一 file なら自分自身)。
 * 新しい producer を足すときは、どの gate を通すかを決めてここに 1 行足す。
 */
const GATE_REGISTRY: Record<string, { gateFiles: string[]; why: string }> = {
	'src/lib/server/services/activity-import-service.ts': {
		gateFiles: ['src/lib/server/services/activity-import-service.ts'],
		why: 'dispatchImport 経由の取込 (marketplace / ?/importFile / api/v1/activities/import) は importActivities 内で enforceActivityQuota。母集団は custom 行のみで、プリセット取込 (seed 行) は 0 行と数えられて通る (#4693 PO 回答 #1)',
	},
	'src/lib/server/services/import-service.ts': {
		gateFiles: ['src/lib/server/services/import-service.ts'],
		why: 'backup ZIP / JSON の全体復元 (api/v1/import) は importChildActivitiesData 内で archiveActivityQuotaOverflow (超過分は捨てず archived で復元、#4693 PO 回答 #2)',
	},
	'src/routes/api/v1/import/cloud/+server.ts': {
		gateFiles: ['src/routes/api/v1/import/cloud/+server.ts'],
		why: 'クラウドテンプレート取込は route 内で archiveActivityQuotaOverflow (超過分は捨てず archived、#4693 PO 回答 #2)',
	},
	'src/lib/server/services/activity-service.ts': {
		gateFiles: [
			'src/routes/(parent)/admin/activities/+page.server.ts',
			'src/routes/api/v1/activities/+server.ts',
		],
		why: '手動追加 (createActivity) は action / REST の入口で checkActivityLimit',
	},
	'src/lib/server/services/child-activity-copy-service.ts': {
		gateFiles: ['src/routes/(parent)/admin/activities/+page.server.ts'],
		why: '別のお子さまからコピーは action 入口で checkActivityLimit (copy による quota 迂回は source 保全で防ぐ、#3669)',
	},
	'src/routes/(parent)/admin/activities/+page.server.ts': {
		gateFiles: ['src/routes/(parent)/admin/activities/+page.server.ts'],
		why: '一括追加 (bulkAdd) は同 action 内で checkActivityLimit',
	},
};

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			walk(full, out);
		} else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
			out.push(full);
		}
	}
	return out;
}

function producers(): string[] {
	const found: string[] = [];
	for (const root of SCAN_ROOTS) {
		for (const file of walk(join(REPO_ROOT, root))) {
			const src = readFileSync(file, 'utf8');
			// コメント / docblock の言及は数えない (コード行だけを見る)
			const code = src
				.split('\n')
				.filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
				.join('\n');
			if (PRODUCER_CALL.test(code)) found.push(relative(REPO_ROOT, file).replace(/\\/g, '/'));
		}
	}
	return found.sort();
}

describe('#4693 fitness: child_activities を作る全経路が quota gate を通る', () => {
	const found = producers();

	it('producer は 1 件以上検出される (検出 regex の空振りを見逃さない)', () => {
		expect(found.length).toBeGreaterThan(0);
	});

	it('registry に無い producer が無い (経路を足したら gate 位置を宣言する)', () => {
		const unregistered = found.filter((f) => !(f in GATE_REGISTRY));
		expect(
			unregistered,
			`child_activities を作る経路が registry 未宣言です。どの quota gate を通すかを決め、` +
				`GATE_REGISTRY に追加してください: ${unregistered.join(', ')}`,
		).toEqual([]);
	});

	it('registry の producer は実在する (撤去済み経路の記述が残らない)', () => {
		const stale = Object.keys(GATE_REGISTRY).filter((f) => !found.includes(f));
		expect(
			stale,
			`registry に producer でなくなった file が残っています: ${stale.join(', ')}`,
		).toEqual([]);
	});

	// #4693 QM 再レビュー: 「file のどこかに 1 つあれば通る」を action 単位に締める。
	describe('route の action ごとに gate の有無を宣言する (file 単位の素通しを作らない)', () => {
		for (const [file, { gated, exempt }] of Object.entries(ACTION_GATE_REGISTRY)) {
			const actions = splitActions(readFileSync(join(REPO_ROOT, file), 'utf8'));

			it(`${file}: actions が抽出できている (regex の空振りを見逃さない)`, () => {
				expect(actions.size).toBeGreaterThan(0);
			});

			it(`${file}: gate 必須と宣言した action は自分の本文で gate を呼ぶ`, () => {
				for (const name of gated) {
					const body = actions.get(name);
					expect(body, `action "${name}" が ${file} に存在しません`).toBeDefined();
					expect(
						GATE_CALL.test(body ?? ''),
						`action "${name}" は gate 必須と宣言されていますが、本文で ` +
							`checkActivityLimit / enforceActivityQuota / archiveActivityQuotaOverflow を呼んでいません`,
					).toBe(true);
				}
			});

			it(`${file}: gate 免除と宣言した action は理由を持ち、実際に gate を呼んでいない`, () => {
				for (const [name, why] of Object.entries(exempt)) {
					const body = actions.get(name);
					expect(body, `action "${name}" が ${file} に存在しません`).toBeDefined();
					expect(why.trim().length, `action "${name}" の免除理由が空です`).toBeGreaterThan(10);
					expect(
						GATE_CALL.test(body ?? ''),
						`action "${name}" は gate 免除と宣言されていますが実際には gate を呼んでいます ` +
							`(宣言と実装が食い違っています)`,
					).toBe(false);
				}
			});

			it(`${file}: すべての action が gated / exempt のどちらかで宣言されている`, () => {
				const declared = new Set([...gated, ...Object.keys(exempt)]);
				const undeclared = [...actions.keys()].filter((name) => !declared.has(name));
				expect(
					undeclared,
					`gate の要否が未宣言の action があります (足したら ACTION_GATE_REGISTRY に書く): ${undeclared.join(', ')}`,
				).toEqual([]);
			});
		}
	});

	it('宣言された gate file は実際に quota gate 関数を呼んでいる', () => {
		for (const [producer, { gateFiles }] of Object.entries(GATE_REGISTRY)) {
			for (const gateFile of gateFiles) {
				const src = readFileSync(join(REPO_ROOT, gateFile), 'utf8');
				expect(
					GATE_CALL.test(src),
					`${producer} の gate として宣言された ${gateFile} が enforceActivityQuota / checkActivityLimit を呼んでいません`,
				).toBe(true);
			}
		}
	});
});
