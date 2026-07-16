// tests/unit/services/export-checksum-roundtrip.test.ts
// #3518-1: export body を 1 回だけ直列化して checksum 入力と data.json body に流用する
// finalizeExport の round-trip 不変条件を固定する。二重 JSON.stringify を解消した後も、import 側
// verifyChecksum (`JSON.stringify({ ...data, checksum: undefined })` を再 hash) がバイト一致で通ること
// = export/import の checksum 正規化整合を保証する (failing-test-first、ADR-0061)。

import { describe, expect, it } from 'vitest';
import type { ExportData } from '../../../src/lib/domain/export-format';
import { finalizeExport } from '../../../src/lib/server/services/export-service';
import { verifyChecksum } from '../../../src/lib/server/services/import-service';

function sampleBody(): Omit<ExportData, 'checksum'> {
	return {
		format: 'ganbari-quest-backup',
		version: '1.3.0',
		exportedAt: '2026-07-16T00:00:00.000Z',
		master: {
			categories: [],
			activities: [{ name: 'あさのしたく', categoryCode: 'seikatsu' }],
			titles: [],
			achievements: [],
			avatarItems: [],
		},
		family: { children: [{ exportId: 'child-1', nickname: 'テスト' }] },
		data: { activityLogs: [{ points: 10 }], pointLedger: [], statuses: [] },
	} as unknown as Omit<ExportData, 'checksum'>;
}

describe('finalizeExport checksum round-trip (#3518-1)', () => {
	it('data.json を parse した body が import verifyChecksum を通る (二重 stringify 解消後もバイト一致)', async () => {
		const body = sampleBody();
		const { exportData, dataJson } = await finalizeExport(body);

		// checksum は sha256 形式で、data.json / exportData の双方に同一値が入る
		expect(exportData.checksum.startsWith('sha256:')).toBe(true);
		const parsed = JSON.parse(dataJson) as ExportData;
		expect(parsed.checksum).toBe(exportData.checksum);
		// data.json 先頭キーは checksum (先頭差し込み方式)。import は位置に依らず checksum を除去するが、
		// 先頭固定にすることで「除去後 = serializedBody」を byte 一致で保証する。
		expect(Object.keys(parsed)[0]).toBe('checksum');

		// import 側 checksum 検証が data.json / exportData の双方で通る (往復整合)
		expect(await verifyChecksum(parsed)).toBe(true);
		expect(await verifyChecksum(exportData)).toBe(true);
	});

	it('exportData の checksum を書き換えると verifyChecksum が false になる (検証が実効している証左)', async () => {
		const { exportData } = await finalizeExport(sampleBody());
		const tampered = { ...exportData, checksum: 'sha256:deadbeef' };
		expect(await verifyChecksum(tampered)).toBe(false);
	});

	it('key が 1 つだけの body でも先頭差し込みが壊れない', async () => {
		const { exportData, dataJson } = await finalizeExport({
			version: '0',
		} as unknown as Omit<ExportData, 'checksum'>);
		const parsed = JSON.parse(dataJson) as ExportData;
		expect(parsed.checksum).toBe(exportData.checksum);
		expect(await verifyChecksum(parsed)).toBe(true);
	});
});
