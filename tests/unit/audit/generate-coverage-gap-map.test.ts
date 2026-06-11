import { describe, expect, it } from 'vitest';
import {
	buildCoverageGapMap,
	dirKeyOf,
	formatCoverageGapMarkdown,
	normalizeCoverageKey,
} from '../../../scripts/audit/generate-coverage-gap-map.mjs';

function lines(total: number, covered: number) {
	return {
		lines: { total, covered, pct: total === 0 ? 0 : Math.round((covered / total) * 1000) / 10 },
	};
}

describe('normalizeCoverageKey', () => {
	it('絶対パス key を src/ 相対に正規化する (posix)', () => {
		expect(normalizeCoverageKey('/home/runner/work/repo/src/lib/foo.ts')).toBe('src/lib/foo.ts');
	});

	it('Windows 区切りも正規化する', () => {
		expect(normalizeCoverageKey('C:\\work\\repo\\src\\lib\\foo.ts')).toBe('src/lib/foo.ts');
	});

	it('src/ 配下でなければ null', () => {
		expect(normalizeCoverageKey('/home/runner/work/repo/scripts/foo.mjs')).toBeNull();
	});

	it('既に src/ 相対ならそのまま', () => {
		expect(normalizeCoverageKey('src/lib/foo.ts')).toBe('src/lib/foo.ts');
	});
});

describe('dirKeyOf', () => {
	it('src/lib 配下は src/lib/<area> 粒度に集計する', () => {
		expect(dirKeyOf('src/lib/server/services/foo.ts')).toBe('src/lib/server');
		expect(dirKeyOf('src/lib/domain/labels.ts')).toBe('src/lib/domain');
	});

	it('src/lib 以外は第 2 セグメント粒度', () => {
		expect(dirKeyOf('src/routes/+page.svelte')).toBe('src/routes');
	});
});

describe('buildCoverageGapMap', () => {
	const summary = {
		total: lines(100, 50),
		'/repo/src/lib/server/a.ts': lines(40, 40),
		'/repo/src/lib/server/b.ts': lines(30, 0),
		'/repo/src/lib/domain/c.ts': lines(30, 10),
	};

	it('ディレクトリ単位で lines を集計し pct 昇順に並べる', () => {
		const map = buildCoverageGapMap(summary, []);
		expect(map.dirs).toEqual([
			{ dir: 'src/lib/domain', files: 1, linesTotal: 30, linesCovered: 10, pct: 33.3 },
			{ dir: 'src/lib/server', files: 2, linesTotal: 70, linesCovered: 40, pct: 57.1 },
		]);
	});

	it('lines 0% のファイルを列挙する', () => {
		const map = buildCoverageGapMap(summary, []);
		expect(map.zeroCoverageFiles).toEqual(['src/lib/server/b.ts']);
	});

	it('coverage-summary に現れない src ファイルを untracked として列挙する', () => {
		const map = buildCoverageGapMap(summary, [
			'src/lib/server/a.ts',
			'src/lib/features/untested.ts',
		]);
		expect(map.untrackedSrcFiles).toEqual(['src/lib/features/untested.ts']);
	});

	it('total エントリを保持する', () => {
		const map = buildCoverageGapMap(summary, []);
		expect(map.total).toEqual({ lines: { total: 100, covered: 50, pct: 50 } });
	});

	it('total 不在でも null で壊れない', () => {
		const map = buildCoverageGapMap({ '/repo/src/lib/server/a.ts': lines(10, 5) }, []);
		expect(map.total).toBeNull();
		expect(map.dirs).toHaveLength(1);
	});
});

describe('formatCoverageGapMarkdown', () => {
	it('全体 lines / dir 表 / 0% 一覧 / 対象外一覧を含む', () => {
		const md = formatCoverageGapMarkdown(
			buildCoverageGapMap({ total: lines(10, 5), '/repo/src/lib/server/b.ts': lines(10, 0) }, [
				'src/lib/features/untested.ts',
				'src/lib/server/b.ts',
			]),
		);
		expect(md).toContain('全体 lines: 5/10 (50%)');
		expect(md).toContain('| src/lib/server | 1 | 0% |');
		expect(md).toContain('- src/lib/server/b.ts');
		expect(md).toContain('- src/lib/features/untested.ts');
	});
});
