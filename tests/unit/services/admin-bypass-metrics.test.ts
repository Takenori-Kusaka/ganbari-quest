// #1201 / ADR-0044: admin bypass metrics service の基本動作テスト
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('admin-bypass-metrics-service', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('GITHUB_TOKEN 未設定時は available=false で reason を返す', async () => {
		vi.doMock('$lib/runtime/env', () => ({ env: {} }));
		const { getAdminBypassMetrics } = await import(
			'../../../src/lib/server/services/admin-bypass-metrics-service'
		);
		const report = await getAdminBypassMetrics(3);
		expect(report.available).toBe(false);
		expect(report.reason).toMatch(/GITHUB_TOKEN/);
		expect(report.monthly).toEqual([]);
	});

	it('API 404 時は available=false で GitHub API エラー文字列を返す', async () => {
		vi.doMock('$lib/runtime/env', () => ({ env: { GITHUB_TOKEN: 'ghp_test' } }));
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response('not found', { status: 404 }));
		const { getAdminBypassMetrics } = await import(
			'../../../src/lib/server/services/admin-bypass-metrics-service'
		);
		const report = await getAdminBypassMetrics(3);
		expect(report.available).toBe(false);
		expect(report.reason).toContain('404');
		fetchSpy.mockRestore();
	});

	it('merged PR が無い場合は monthly 空配列 / totals=0', async () => {
		vi.doMock('$lib/runtime/env', () => ({ env: { GITHUB_TOKEN: 'ghp_test' } }));
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
		);
		const { getAdminBypassMetrics } = await import(
			'../../../src/lib/server/services/admin-bypass-metrics-service'
		);
		const report = await getAdminBypassMetrics(3);
		expect(report.available).toBe(true);
		expect(report.monthly).toEqual([]);
		expect(report.totalAdminBypass).toBe(0);
		expect(report.totalEvidenceMissing).toBe(0);
	});

	it('APPROVED review 無し + Self-Review 証跡 無しは evidenceMissing に計上される', async () => {
		vi.doMock('$lib/runtime/env', () => ({ env: { GITHUB_TOKEN: 'ghp_test' } }));
		const now = new Date();
		const mergedAt = new Date(now.getTime() - 86400000).toISOString();
		const prs = [
			{
				number: 999,
				title: 'test',
				merged_at: mergedAt,
				user: { login: 'alice' },
				body: 'no evidence here',
				labels: [],
			},
		];
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(JSON.stringify(prs), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			)
			.mockResolvedValueOnce(
				new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
			);
		const { getAdminBypassMetrics } = await import(
			'../../../src/lib/server/services/admin-bypass-metrics-service'
		);
		const report = await getAdminBypassMetrics(3);
		expect(report.available).toBe(true);
		expect(report.totalAdminBypass).toBe(1);
		expect(report.totalEvidenceMissing).toBe(1);
		expect(report.monthly).toHaveLength(1);
	});

	it('Self-Review 証跡 があれば evidenceMissing に計上されない', async () => {
		vi.doMock('$lib/runtime/env', () => ({ env: { GITHUB_TOKEN: 'ghp_test' } }));
		const now = new Date();
		const mergedAt = new Date(now.getTime() - 86400000).toISOString();
		const prs = [
			{
				number: 1000,
				title: 'test2',
				merged_at: mergedAt,
				user: { login: 'alice' },
				body: '## Self-Review 証跡 (admin bypass)\n\n### 確認した観点\n- [x] OK',
				labels: [],
			},
		];
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(JSON.stringify(prs), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			)
			.mockResolvedValueOnce(
				new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
			);
		const { getAdminBypassMetrics } = await import(
			'../../../src/lib/server/services/admin-bypass-metrics-service'
		);
		const report = await getAdminBypassMetrics(3);
		expect(report.totalAdminBypass).toBe(1);
		expect(report.totalEvidenceMissing).toBe(0);
	});

	it('APPROVED review があれば admin bypass に計上されない', async () => {
		vi.doMock('$lib/runtime/env', () => ({ env: { GITHUB_TOKEN: 'ghp_test' } }));
		const now = new Date();
		const mergedAt = new Date(now.getTime() - 86400000).toISOString();
		const prs = [
			{
				number: 1001,
				title: 'approved',
				merged_at: mergedAt,
				user: { login: 'bob' },
				body: 'whatever',
				labels: [],
			},
		];
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(JSON.stringify(prs), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify([{ state: 'APPROVED' }]), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			);
		const { getAdminBypassMetrics } = await import(
			'../../../src/lib/server/services/admin-bypass-metrics-service'
		);
		const report = await getAdminBypassMetrics(3);
		expect(report.totalAdminBypass).toBe(0);
		expect(report.totalEvidenceMissing).toBe(0);
	});
});
