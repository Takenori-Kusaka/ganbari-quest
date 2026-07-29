// tests/unit/architecture/churn-status-predicate-ssot.test.ts
// #3987: チャーン (契約終了) 判定を `isChurnedContract` の単一 SSOT に閉じ込める fitness function。
//
// 背景: `terminated` は退会 (アカウント削除) を意味し、物理削除で families 行ごと消えるため
// 通常運用では観測されない。それを直接 churn 判定に使っていた service が 3 本あり、いずれも
// **恒常的に 0** を返していた。同 class の 4 本目が生まれないよう、KPI service 層での
// `SUBSCRIPTION_STATUS.TERMINATED` / `SUSPENDED` の直接比較を禁止する (ADR-0061)。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/**
 * チャーン / 解約数 / retention を集計する KPI service 群。
 * 新しい KPI service を足したらここに追加する (追加漏れは [C0] が検出する)。
 */
const KPI_SERVICES = [
	'src/lib/server/services/cohort-analysis-service.ts',
	'src/lib/server/services/ops-analytics-service.ts',
	'src/lib/server/services/pricing-trigger-service.ts',
	'src/lib/server/services/stripe-metrics-service.ts',
] as const;

function read(relPath: string): string {
	return readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

/** 行コメント / ブロックコメントを落とす (コメント内の言及を violation にしない)。 */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('#3987: churn 判定 SSOT (isChurnedContract)', () => {
	it('[C0] 対象 KPI service が全て実在する (パス変更で検査が空振りしない)', () => {
		for (const relPath of KPI_SERVICES) {
			expect(() => read(relPath), `${relPath} が見つからない`).not.toThrow();
		}
		expect(KPI_SERVICES.length).toBeGreaterThanOrEqual(4);
	});

	it('[C1] KPI service は SUBSCRIPTION_STATUS.TERMINATED を直接比較しない', () => {
		const violations: string[] = [];
		for (const relPath of KPI_SERVICES) {
			const code = stripComments(read(relPath));
			for (const [index, line] of code.split('\n').entries()) {
				if (line.includes('SUBSCRIPTION_STATUS.TERMINATED')) {
					violations.push(`${relPath}:${index + 1}: ${line.trim()}`);
				}
			}
		}
		expect(
			violations,
			[
				'KPI service で terminated を直接判定している。',
				'terminated は退会済みを意味し物理削除で行ごと消えるため、この判定は恒常的に 0 を返す。',
				'`isChurnedContract(tenant)` を使うこと (#3987)。',
				...violations,
			].join('\n'),
		).toEqual([]);
	});

	it('[C2] KPI service は SUBSCRIPTION_STATUS.SUSPENDED も直接比較しない (S4 と S5 の混同防止)', () => {
		const violations: string[] = [];
		for (const relPath of KPI_SERVICES) {
			const code = stripComments(read(relPath));
			for (const [index, line] of code.split('\n').entries()) {
				if (line.includes('SUBSCRIPTION_STATUS.SUSPENDED')) {
					violations.push(`${relPath}:${index + 1}: ${line.trim()}`);
				}
			}
		}
		expect(
			violations,
			[
				'KPI service で suspended を直接判定している。',
				'suspended は S4 (契約が残り復帰しうる停止) と S5 (契約終了) を兼ねるため、',
				'丸ごと数えると復帰しうるテナントを解約に混ぜる。`isChurnedContract(tenant)` を使うこと (#3987)。',
				...violations,
			].join('\n'),
		).toEqual([]);
	});

	it('[C3] churn を数える KPI service は isChurnedContract を import している', () => {
		for (const relPath of KPI_SERVICES) {
			expect(read(relPath), `${relPath} が isChurnedContract を使っていない`).toContain(
				'isChurnedContract',
			);
		}
	});
});
