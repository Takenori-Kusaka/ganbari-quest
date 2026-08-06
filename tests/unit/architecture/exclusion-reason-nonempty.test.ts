// tests/unit/architecture/exclusion-reason-nonempty.test.ts
// #4030 class B (AC5) — 除外理由が「あることになっている」だけの状態を潰す。
//
// ## 何が壊れているか
//
// 本 repo の allowlist / 除外リストは `reason` フィールドを持ち、コメントで
// 「理由を書く」と宣言している。しかし **value を読む assertion が 0 件**で、
// **空文字でも通る**。つまり「除外理由を書く」は運用上の願いであって強制ではない。
//
// #4030 の横展開調査でこの class が 10 件見つかった。実データは全件 reason ありで
// 現時点の違反は 0 だが、**強制が無い以上いつでも空にできる**（latent）。
//
// **特筆**: `admin-resource-model-registry.ts` は #4025 が「正しい実装」として引用した
// 当のファイルである。姉妹の `NON_CANONICAL_ADMIN_RESOURCES` には非空 assertion があるのに
// `NON_RESOURCE_ADMIN_PAGE_ROUTES` には無い。**先例が自分自身に対する反証**になっていた。
//
// ## なぜ「空でない」だけでは足りないか
//
// `TODO` / `n/a` / `-` のような定型 stub は非空だが理由ではない。#3956 で
// 「理由の非強制を作らない」を学んでいるので、**stub も弾く**。
//
// ## scope
//
// **本 file が見るのは import 可能な (= 実装側から export されている) 2 件**。
// test file 内の const (`EXEMPT_GUIDE_PATHS` / `MUTATION_ALLOWLIST` / `PREDICATE_ALLOWLIST`)
// は import すると当該 test file の describe が二重実行されるため、**各 test file 内に
// assertion を置く**（データを持つ file が自分で守る）。どこにあるかは PR body に列挙した。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { NON_RESOURCE_ADMIN_PAGE_ROUTES } from '$lib/features/admin/admin-resource-model-registry';
import { LOW_RISK_THIRD_PARTY_ALLOWLIST } from '../../../scripts/check-action-sha-pin.mjs';
import {
	findBaselineReasonDefects,
	findReasonDefect,
} from '../../../scripts/lib/ci/exclusion-reason.mjs';

// #4030 AC6: 判定規則は `scripts/lib/ci/exclusion-reason.mjs` に一本化した。
// 旧実装は本 file 内に同じ規則の copy を持っていたが、orphan baseline 側 (script) が
// 同じ規則を使う必要が出たため SSOT を module に移した。**規則が 2 つあると、
// 片方だけ緩めて通す抜け道になる**。
//
// 各 fitness test file 内 (`EXEMPT_GUIDE_PATHS` / `MUTATION_ALLOWLIST` / `PREDICATE_ALLOWLIST`)
// にある同型判定は #4237 の意図的な分散のまま (test file 同士を import すると describe が
// 二重実行される)。それらは判定関数を持つのではなく「データを持つ file が自分で守る」形。

// repo 走査 test の区分宣言 (#4085、SSOT = scripts/lib/ci/repo-scan-test-registry.mjs)。
// 並列 worker との CPU / FS 競合で既定 5s を超えうるため明示 timeout を置く。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BASELINE_DIR = path.join(REPO_ROOT, 'scripts', 'orphan-baselines');

describe('#4030 AC5 除外理由は空でも stub でもないこと', () => {
	it('findReasonDefect が空 / stub / 極端な短文 / 機械生成を弾く (非トートロジー証明)', () => {
		expect(findReasonDefect('')).not.toBeNull();
		expect(findReasonDefect('   ')).not.toBeNull();
		expect(findReasonDefect('TODO')).not.toBeNull();
		expect(findReasonDefect('n/a')).not.toBeNull();
		expect(findReasonDefect('未定')).not.toBeNull();
		expect(findReasonDefect(undefined)).not.toBeNull();
		// #4030 AC6: guard 自身が書いた文字列は「人が理由を書いた」ことにならない
		expect(findReasonDefect('auto-added by --update-baseline')).not.toBeNull();
		expect(
			findReasonDefect(
				'repo file "src/lib/server/db/dsql/foo-repo.ts" は db facade / factory / interfaces から import されていません。',
			),
		).not.toBeNull();
		// 実データ相当は通る
		expect(findReasonDefect('resource-list ではない admin page のため対象外')).toBeNull();
	});

	it('NON_RESOURCE_ADMIN_PAGE_ROUTES の全 entry が理由を持つ', () => {
		const entries = Object.entries(NON_RESOURCE_ADMIN_PAGE_ROUTES);

		// 母数が空なら「違反 0」ではなく「検査していない」(#4084 と同じ形)
		expect(entries.length, '母数が空です。export が消えていないか確認してください').toBeGreaterThan(
			0,
		);

		const defects = entries
			.map(([route, entry]) => {
				const defect = findReasonDefect((entry as { reason?: unknown }).reason);
				return defect ? `${route}: ${defect}` : null;
			})
			.filter((v): v is string => v !== null);

		expect(
			defects,
			'除外理由が実質空です。**なぜ resource-list でないのか**を書いてください。' +
				'理由が無い除外は、次に読む人が「消し忘れ」と区別できません',
		).toEqual([]);
	});

	it('LOW_RISK_THIRD_PARTY_ALLOWLIST の全 entry が理由を持つ', () => {
		expect(LOW_RISK_THIRD_PARTY_ALLOWLIST.length, '母数が空です').toBeGreaterThan(0);

		const defects = LOW_RISK_THIRD_PARTY_ALLOWLIST.map(
			(entry: { name: string; reason?: unknown }) => {
				const defect = findReasonDefect(entry.reason);
				return defect ? `${entry.name}: ${defect}` : null;
			},
		).filter((v: string | null): v is string => v !== null);

		expect(
			defects,
			'SHA pin の floating 許容理由が実質空です。**produce / write をしないこと**を' +
				'説明してください。理由なしの許容は supply chain 防御の穴になります',
		).toEqual([]);
	});
});

// #4030 AC6 (PO 決裁 = 案 A): orphan baseline の免除理由も同じ規則で強制する。
//
// 旧実装の `--update-baseline` は検出理由 (機械が書いた現象の説明) / 'auto-added by --update-baseline'
// を reasons に自動投入していた。**guard 自身の生成物で欄が埋まる**ため、
// 「除外理由を書く」という運用が形骸化していた。
//
// 検査は `reportFindings` の check mode にも入っている (各 category の script が CI で実行される)
// が、本 test は **10 category を 1 度に横断**して落とす。script が workflow から外れても
// (= 検査が静かに消えても) ここで気づける (#4084「検査できなかったを pass にしない」)。
describe('#4030 AC6 orphan baseline の免除理由も空 / stub / 機械生成でないこと', () => {
	const baselineFiles = fs
		.readdirSync(BASELINE_DIR)
		.filter((f) => f.endsWith('.json'))
		.sort();

	it('baseline file の母数が 0 でない (検査対象が消えていない)', () => {
		expect(
			baselineFiles.length,
			`${BASELINE_DIR} に baseline JSON がありません。dir 移動なら本 test の参照も直してください`,
		).toBeGreaterThan(0);
	});

	it('全 category の全 allowed entry が理由を持つ', () => {
		const defects: string[] = [];
		let totalEntries = 0;
		for (const file of baselineFiles) {
			const parsed = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, file), 'utf8'));
			totalEntries += (parsed.allowed ?? []).length;
			for (const d of findBaselineReasonDefects(parsed)) {
				defects.push(`${file} / ${d.entry}: ${d.defect}`);
			}
		}

		// 全 category が空になったら「違反 0」ではなく「検査していない」
		expect(totalEntries, '全 baseline の allowed が 0 件です').toBeGreaterThan(0);

		expect(
			defects,
			'orphan baseline の免除理由が実質空です。**なぜ免除してよいか** を書いてください' +
				'(検出理由の貼り付けではなく、免除の正当化を書く)',
		).toEqual([]);
	});
});
