import { describe, expect, it } from 'vitest';
import {
	partitionBySeverity,
	SEVERITY_ESCALATION_THRESHOLD,
} from '../../../scripts/audit/severity-filter.mjs';

const sev = (s: number) => ({ id: `s${s}`, severity: s });

describe('partitionBySeverity', () => {
	it('閾値は 3 (audit-team.md §3.6 [3])', () => {
		expect(SEVERITY_ESCALATION_THRESHOLD).toBe(3);
	});

	it('severity 1-2 は backlog、3-4 は escalated', () => {
		const r = partitionBySeverity([sev(1), sev(2), sev(3), sev(4)]);
		expect(r.escalated.map((f: { id: string }) => f.id)).toEqual(['s3', 's4']);
		expect(r.backlog.map((f: { id: string }) => f.id)).toEqual(['s1', 's2']);
	});

	it('空入力は両方空', () => {
		const r = partitionBySeverity([]);
		expect(r.escalated).toEqual([]);
		expect(r.backlog).toEqual([]);
	});

	it('severity 非整数 / 欠落は backlog 扱い (0 として)', () => {
		const r = partitionBySeverity([{ id: 'nan' }, { id: 'str', severity: 'x' }]);
		expect(r.escalated).toEqual([]);
		expect(r.backlog).toHaveLength(2);
	});

	it('threshold を返す', () => {
		expect(partitionBySeverity([]).threshold).toBe(3);
	});
});
