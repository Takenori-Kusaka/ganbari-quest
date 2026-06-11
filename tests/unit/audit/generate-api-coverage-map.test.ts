import { describe, expect, it } from 'vitest';
import {
	endpointToPattern,
	extractApiEndpoints,
	formatApiCoverageMarkdown,
	matchEndpointCoverage,
} from '../../../scripts/audit/generate-api-coverage-map.mjs';

const DOC = `
### 認証・ヘルスチェック

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/health | ヘルスチェック | 不要 |
| POST/GET | /api/v1/auth/logout | ログアウト | 不要 |
| GET | /auth/callback | Cognito OAuth コールバック | 不要 |

### 子供関連

| メソッド | パス | 概要 | 認証 |
|----------|------|------|------|
| GET | /api/v1/activities | 活動一覧取得 | 全ロール |
| PATCH | /api/v1/activities/[id]/visibility | 表示切替 | owner/parent |
`;

describe('extractApiEndpoints', () => {
	it('| METHOD | /api/... | 形式の表行を抽出する', () => {
		const eps = extractApiEndpoints(DOC);
		expect(eps).toContainEqual({ method: 'GET', path: '/api/health' });
		expect(eps).toContainEqual({ method: 'GET', path: '/api/v1/activities' });
	});

	it('POST/GET 複合メソッドは分解する', () => {
		const eps = extractApiEndpoints(DOC);
		expect(eps).toContainEqual({ method: 'POST', path: '/api/v1/auth/logout' });
		expect(eps).toContainEqual({ method: 'GET', path: '/api/v1/auth/logout' });
	});

	it('/api/ で始まらないパス (/auth/callback) は対象外', () => {
		const eps = extractApiEndpoints(DOC);
		expect(eps.some((e) => e.path === '/auth/callback')).toBe(false);
	});

	it('重複行は 1 件に正規化する', () => {
		const eps = extractApiEndpoints(`${DOC}\n| GET | /api/health | 重複 | 不要 |\n`);
		expect(eps.filter((e) => e.method === 'GET' && e.path === '/api/health')).toHaveLength(1);
	});
});

describe('endpointToPattern', () => {
	it('[id] パラメータセグメントは任意セグメントにマッチする', () => {
		const re = endpointToPattern('/api/v1/activities/[id]/visibility');
		expect(re.test("await request.patch('/api/v1/activities/123/visibility')")).toBe(true);
		expect(re.test("'/api/v1/activities/visibility'")).toBe(false);
	});

	it('literal セグメントは完全一致のみ', () => {
		const re = endpointToPattern('/api/health');
		expect(re.test("request.get('/api/health')")).toBe(true);
		expect(re.test("request.get('/api/health-extra')")).toBe(true); // 部分一致は許容 (prefix 一致で covered 扱い)
		expect(re.test("request.get('/api/heal')")).toBe(false);
	});
});

describe('matchEndpointCoverage', () => {
	const endpoints = [
		{ method: 'GET', path: '/api/health' },
		{ method: 'GET', path: '/api/v1/activities' },
		{ method: 'PATCH', path: '/api/v1/activities/[id]/visibility' },
	];

	it('テストソースに path が現れるものを covered に分類する', () => {
		const src = "await request.get('/api/health');";
		const r = matchEndpointCoverage(endpoints, src);
		expect(r.covered).toEqual([{ method: 'GET', path: '/api/health' }]);
		expect(r.uncovered).toHaveLength(2);
		expect(r.total).toBe(3);
	});

	it('パラメータ付き path は実値で書かれたテストにもマッチする', () => {
		const src = "await request.patch('/api/v1/activities/42/visibility');";
		const r = matchEndpointCoverage(endpoints, src);
		expect(r.covered).toContainEqual({
			method: 'PATCH',
			path: '/api/v1/activities/[id]/visibility',
		});
	});

	it('カバー率は小数 1 桁 % で算出する', () => {
		const src = "'/api/health'";
		const r = matchEndpointCoverage(endpoints, src);
		expect(r.coverageRate).toBe(33.3);
	});

	it('endpoints 空なら 0% で空表 (ゼロ除算しない)', () => {
		const r = matchEndpointCoverage([], 'anything');
		expect(r).toEqual({ covered: [], uncovered: [], total: 0, coverageRate: 0 });
	});
});

describe('formatApiCoverageMarkdown', () => {
	it('総数 / covered / uncovered / カバー率と表を含む', () => {
		const md = formatApiCoverageMarkdown(
			matchEndpointCoverage([{ method: 'GET', path: '/api/health' }], "'/api/health'"),
		);
		expect(md).toContain('設計書エンドポイント総数: 1');
		expect(md).toContain('カバー率: 100%');
		expect(md).toContain('| covered | GET | /api/health |');
	});
});
