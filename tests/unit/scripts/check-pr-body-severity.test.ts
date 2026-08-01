import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	BLOCKING_GATES,
	BLOCKING_VIOLATION_IDS,
	formatAdvisoryReport,
	partitionBySeverity,
} from '../../../scripts/check-pr-body.mjs';

/**
 * #4121 決裁 4 — check-pr-body の blocking / advisory 切り分け。
 *
 * 本 script は 26 の検査を持つが、判断原則 v2 (ADR-0007 §1-2) では大半が
 * 類型 3 (書式・網羅性) = 「warn 降格 or 撤去」に当たる。1 本の script に 類型 1 と 類型 3 が
 * 同居していたため script 単位で全部 hard-fail になっていた構造を、id 単位の切り分けに変える。
 */
describe('#4121 blocking / advisory 切り分け', () => {
	const makeViolation = (id: string) => ({ id, message: `${id} の説明`, issue: '#0000' });

	describe('partitionBySeverity', () => {
		it('BLOCKING_GATES に列挙された id だけが blocking になる', () => {
			const violations = [
				makeViolation('evidence-pr-mismatch'),
				makeViolation('missing-required-sections'),
				makeViolation('tbd'),
			];
			const { blocking, advisory } = partitionBySeverity(violations);
			expect(blocking.map((v) => v.id)).toEqual(['evidence-pr-mismatch']);
			expect(advisory.map((v) => v.id)).toEqual(['missing-required-sections', 'tbd']);
		});

		it('未知の id は advisory に落ちる（新しい検査の既定は advisory）', () => {
			const { blocking, advisory } = partitionBySeverity([makeViolation('brand-new-check')]);
			expect(blocking).toHaveLength(0);
			expect(advisory.map((v) => v.id)).toEqual(['brand-new-check']);
		});

		it('violations が空なら両方空', () => {
			expect(partitionBySeverity([])).toEqual({ blocking: [], advisory: [] });
		});

		it('元の violation オブジェクトを壊さない（message / issue が保たれる）', () => {
			const v = makeViolation('tbd');
			const { advisory } = partitionBySeverity([v]);
			expect(advisory[0]).toBe(v);
		});
	});

	describe('formatAdvisoryReport', () => {
		it('advisory が 0 件なら何も出さない（無音で緩めた印象を作らない代わりに、出す物が無い）', () => {
			expect(formatAdvisoryReport([])).toEqual([]);
		});

		it('ADVISORY-IDS 行を 1 行だけ出し、id を カンマ区切りで並べる（#4121 AC7 の集計単位）', () => {
			const lines = formatAdvisoryReport([makeViolation('tbd'), makeViolation('xxx')]);
			const idLines = lines.filter((l) => l.includes('ADVISORY-IDS'));
			expect(idLines).toHaveLength(1);
			expect(idLines[0]).toContain('ADVISORY-IDS tbd,xxx');
		});

		it('各 advisory の message を本文に含める（検出内容を握り潰さない）', () => {
			const lines = formatAdvisoryReport([makeViolation('tbd')]).join('\n');
			expect(lines).toContain('tbd の説明');
			expect(lines).toContain('⚠ [tbd]');
		});

		it('「検査していない」ではなく「止めない」であることを明示する', () => {
			const text = formatAdvisoryReport([makeViolation('tbd')]).join('\n');
			expect(text).toContain('検出したが merge を止めない');
			expect(text).toContain('2 run 連続');
		});
	});

	describe('BLOCKING_GATES の健全性（gate が生きているつもりで死んでいる状態を作らない）', () => {
		const source = readFileSync(resolve(process.cwd(), 'scripts/check-pr-body.mjs'), 'utf-8');

		it('列挙された id は全て check-pr-body.mjs が実際に生成する id である', () => {
			// id をタイプミスすると **その gate は無言で advisory に落ちる**。
			// #3969 (gate が生きているつもりで死んでいた) と同 class なので機械で固定する。
			const producedIds = new Set([...source.matchAll(/\bid:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]));
			for (const gate of BLOCKING_GATES) {
				expect(producedIds.has(gate.id), `${gate.id} が実装側に存在しない`).toBe(true);
			}
		});

		it('各 gate は「何を守るか」(why) を持つ — 理由なしの hard-fail を作らない', () => {
			for (const gate of BLOCKING_GATES) {
				expect(gate.why, `${gate.id} に why がない`).toBeTruthy();
				expect(gate.why.length, `${gate.id} の why が短すぎる`).toBeGreaterThanOrEqual(20);
			}
		});

		it('id が重複していない', () => {
			expect(BLOCKING_VIOLATION_IDS.size).toBe(BLOCKING_GATES.length);
		});

		it('証跡の真正性を守る 3 本が blocking から外れていない（降格の巻き戻し検出）', () => {
			// この 3 本は ADR-0004 / #4170 / #3899 が hard-fail 維持と定めたもの。
			// 「advisory を増やす」方向の変更でうっかり外れたら落とす。
			for (const id of [
				'evidence-pr-mismatch',
				'closes-not-landed',
				'self-review-evidence-missing',
			]) {
				expect(BLOCKING_VIOLATION_IDS.has(id), `${id} が blocking から外れている`).toBe(true);
			}
		});
	});
});
