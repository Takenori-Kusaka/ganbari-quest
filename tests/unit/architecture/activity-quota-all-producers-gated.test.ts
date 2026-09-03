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
const GATE_CALL = /\b(enforceActivityQuota|checkActivityLimit)\s*\(/;

/**
 * producer file → その経路の quota gate を呼ぶ file (同一 file なら自分自身)。
 * 新しい producer を足すときは、どの gate を通すかを決めてここに 1 行足す。
 */
const GATE_REGISTRY: Record<string, { gateFiles: string[]; why: string }> = {
	'src/lib/server/services/activity-import-service.ts': {
		gateFiles: ['src/lib/server/services/activity-import-service.ts'],
		why: 'dispatchImport 経由の取込 (marketplace / ?/importFile / api/v1/activities/import) は importActivities 内で enforceActivityQuota',
	},
	'src/lib/server/services/import-service.ts': {
		gateFiles: ['src/lib/server/services/import-service.ts'],
		why: 'backup ZIP / JSON の全体復元 (api/v1/import) は importChildActivitiesData 内で enforceActivityQuota (QM #4784)',
	},
	'src/routes/api/v1/import/cloud/+server.ts': {
		gateFiles: ['src/routes/api/v1/import/cloud/+server.ts'],
		why: 'クラウドテンプレート取込は route 内で enforceActivityQuota (QM #4784)',
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
