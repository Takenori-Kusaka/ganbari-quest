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

import { describe, expect, it } from 'vitest';
import { NON_RESOURCE_ADMIN_PAGE_ROUTES } from '$lib/features/admin/admin-resource-model-registry';
import { LOW_RISK_THIRD_PARTY_ALLOWLIST } from '../../../scripts/check-action-sha-pin.mjs';

/**
 * 「理由として通用しない」文字列。
 *
 * 空 / 空白のみ に加えて、**定型 stub** を弾く。非空チェックだけだと
 * `TODO` を書いて通す抜け道が残り、gate が形骸化する (#3956 教訓)。
 */
const STUB_REASONS = ['todo', 'tbd', 'n/a', 'na', '-', '—', '未定', 'なし', '?', '??'];

/** 理由として成立しているか。成立しない場合は理由文字列を返す。 */
export function findReasonDefect(reason: unknown): string | null {
	if (typeof reason !== 'string') return `文字列ではありません (${typeof reason})`;
	const trimmed = reason.trim();
	if (trimmed.length === 0) return '空です';
	if (STUB_REASONS.includes(trimmed.toLowerCase())) return `定型 stub です (「${trimmed}」)`;
	// 「除外した」だけで何も説明していない極端な短文を弾く。
	// 実データの最短は 20 字前後なので 8 字は十分に緩い下限。
	if (trimmed.length < 8) return `短すぎます (${trimmed.length} 字: 「${trimmed}」)`;
	return null;
}

describe('#4030 AC5 除外理由は空でも stub でもないこと', () => {
	it('findReasonDefect が空 / stub / 極端な短文を弾く (非トートロジー証明)', () => {
		expect(findReasonDefect('')).not.toBeNull();
		expect(findReasonDefect('   ')).not.toBeNull();
		expect(findReasonDefect('TODO')).not.toBeNull();
		expect(findReasonDefect('n/a')).not.toBeNull();
		expect(findReasonDefect('未定')).not.toBeNull();
		expect(findReasonDefect(undefined)).not.toBeNull();
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
