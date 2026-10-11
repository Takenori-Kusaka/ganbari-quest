// tests/unit/routes/setup-import-tenant-guard.test.ts
//
// 初期セットアップの取込 action が、フォームから来た childId を**自分の家族の子供か確かめてから**
// 取込に渡すことを固定する (CWE-639 / IDOR、admin/rewards の importPresetToChildren /
// importMarketplaceRewardSet と同じ防御)。
//
// ## なぜ要るか
//
// `/setup/rewards` の `importRewards` と `/setup/rules` の `importRules` (交換ルール) は、
// hidden input の childId をそのまま取込に渡していた。取込の service は childId と
// tenantId を別々に受け取り、childId が tenantId の子供かを見ない。そのため改ざんした
// childId を送ると、**自分のテナントの中に「他の家族の子供 ID に紐づいたごほうび」行**が
// 作られる (admin/rewards 側は #2474 / #4928 で照合済み。setup だけ抜けていた)。
//
// ## 固定する不変条件
//
//   [S1] rewards: テナント外の childId なら 403 を返し、取込 (dispatchImport) を呼ばない
//   [S2] rewards: 自分の子供なら従来どおり取り込み、次の step へ進む
//   [S3] rules:   テナント外の childId なら 403 を返し、ルールの取込を呼ばない (ボーナスのみでも)
//   [S4] rules:   自分の子供なら従来どおり交換ルールを取り込む
//   [S5] rules:   childId 未指定 (「選択しない」) はこれまでどおり通す (ボーナスのみ取込)
//
// 取込系の action はほかに `/setup/packs` と `/setup/challenges` があるが、どちらも
// 配信先を `getAllChildren(tenantId)` から作り、フォームの childId を読まない (対象外)。
// `/setup/first-adventure` の `record` は `recordActivity` が child をテナント内で引き直す。

import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT_ID = 't-1';
const OWN_CHILD_ID = 'c-own';
const FOREIGN_CHILD_ID = 'c-other-family';

const mockGetAllChildren = vi.fn();
const mockDispatchImport = vi.fn();
const mockGetMarketplaceItem = vi.fn();
const mockPreviewRulePreset = vi.fn();
const mockApplyRulePreset = vi.fn();

vi.mock('$lib/server/auth/factory', () => ({ requireTenantId: () => TENANT_ID }));
vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: (...args: unknown[]) => mockGetAllChildren(...args),
}));
vi.mock('$lib/server/services/setup-funnel-service', () => ({ trackSetupFunnel: vi.fn() }));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/data/marketplace', () => ({
	getMarketplaceIndex: vi.fn(() => []),
	getMarketplaceItem: (...args: unknown[]) => mockGetMarketplaceItem(...args),
}));
vi.mock('$lib/marketplace', () => ({
	dispatchImport: (...args: unknown[]) => mockDispatchImport(...args),
	marketplaceRegistry: {
		get: () => ({
			strategy: {
				previewRulePreset: (...args: unknown[]) => mockPreviewRulePreset(...args),
				applyRulePreset: (...args: unknown[]) => mockApplyRulePreset(...args),
			},
		}),
	},
}));

const rewardsMod = await import('../../../src/routes/setup/rewards/+page.server');
const rulesMod = await import('../../../src/routes/setup/rules/+page.server');

type ActionFn = (event: { request: Request; locals: App.Locals }) => Promise<unknown>;
const importRewards = rewardsMod.actions.importRewards as unknown as ActionFn;
const importRules = rulesMod.actions.importRules as unknown as ActionFn;

function makeEvent(path: string, fields: Record<string, string | string[]>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
	}
	return {
		request: new Request(`https://x${path}`, { method: 'POST', body }),
		locals: { context: { tenantId: TENANT_ID, role: 'owner' } } as unknown as App.Locals,
	};
}

/**
 * action を実行し、redirect (= 正常に次の step へ進んだ) なら location を、
 * ActionFailure なら status を返す。どちらでもない戻り値は test の前提違反として落とす。
 */
async function run(action: ActionFn, event: ReturnType<typeof makeEvent>) {
	try {
		const result = (await action(event)) as { status?: number; data?: { error?: string } };
		if (result && typeof result.status === 'number') {
			return { kind: 'fail' as const, status: result.status, error: result.data?.error };
		}
		throw new Error(`想定外の戻り値: ${JSON.stringify(result)}`);
	} catch (e) {
		if (isRedirect(e)) return { kind: 'redirect' as const, location: e.location };
		throw e;
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetAllChildren.mockResolvedValue([{ id: OWN_CHILD_ID, nickname: 'まさと', age: 7 }]);
	mockDispatchImport.mockResolvedValue({ imported: 3, skipped: 0, errors: [] });
	mockPreviewRulePreset.mockResolvedValue({ alreadyImported: false });
	mockApplyRulePreset.mockResolvedValue({ imported: 2, skipped: 0, errors: [], warnings: [] });
});

describe('/setup/rewards importRewards — 取込先の子供がテナント内か確かめる', () => {
	beforeEach(() => {
		mockGetMarketplaceItem.mockReturnValue({
			itemId: 'reward-set-a',
			name: 'ごほうびセットA',
			payload: { rewards: [] },
		});
	});

	it('[S1] テナント外の childId は 403 で、dispatchImport を呼ばない', async () => {
		const out = await run(
			importRewards,
			makeEvent('/setup/rewards', { itemIds: ['reward-set-a'], childId: FOREIGN_CHILD_ID }),
		);
		expect(out.kind).toBe('fail');
		expect(out.kind === 'fail' && out.status).toBe(403);
		expect(out.kind === 'fail' && typeof out.error).toBe('string');
		expect(mockDispatchImport).not.toHaveBeenCalled();
		expect(mockGetAllChildren).toHaveBeenCalledWith(TENANT_ID);
	});

	it('[S2] 自分の子供なら取り込んで次の step (/setup/rules) へ進む', async () => {
		const out = await run(
			importRewards,
			makeEvent('/setup/rewards', { itemIds: ['reward-set-a'], childId: OWN_CHILD_ID }),
		);
		expect(out.kind).toBe('redirect');
		expect(out.kind === 'redirect' && out.location).toBe(
			'/setup/rules?rewardsImported=3&rewardsSkipped=0',
		);
		expect(mockDispatchImport).toHaveBeenCalledTimes(1);
		expect(mockDispatchImport.mock.calls[0]?.[0]).toMatchObject({
			ctx: { tenantId: TENANT_ID, childId: OWN_CHILD_ID },
		});
	});
});

describe('/setup/rules importRules — 交換ルールの紐付け先がテナント内か確かめる', () => {
	function rulePreset(ruleType: 'bonus' | 'exchange') {
		return {
			itemId: `rule-${ruleType}`,
			name: `ルール(${ruleType})`,
			icon: '📜',
			payload: { ruleType, rules: [] },
		};
	}

	it('[S3] テナント外の childId は 403 で、交換ルールを取り込まない', async () => {
		mockGetMarketplaceItem.mockReturnValue(rulePreset('exchange'));
		const out = await run(
			importRules,
			makeEvent('/setup/rules', { itemIds: ['rule-exchange'], childId: FOREIGN_CHILD_ID }),
		);
		expect(out.kind).toBe('fail');
		expect(out.kind === 'fail' && out.status).toBe(403);
		expect(mockApplyRulePreset).not.toHaveBeenCalled();
		expect(mockPreviewRulePreset).not.toHaveBeenCalled();
	});

	it('[S3] ボーナスだけを選んでいても、改ざんされた childId は 403 (何も取り込まない)', async () => {
		mockGetMarketplaceItem.mockReturnValue(rulePreset('bonus'));
		const out = await run(
			importRules,
			makeEvent('/setup/rules', { itemIds: ['rule-bonus'], childId: FOREIGN_CHILD_ID }),
		);
		expect(out.kind).toBe('fail');
		expect(out.kind === 'fail' && out.status).toBe(403);
		expect(mockApplyRulePreset).not.toHaveBeenCalled();
	});

	it('[S4] 自分の子供なら交換ルールを取り込んで次の step へ進む', async () => {
		mockGetMarketplaceItem.mockReturnValue(rulePreset('exchange'));
		const out = await run(
			importRules,
			makeEvent('/setup/rules', { itemIds: ['rule-exchange'], childId: OWN_CHILD_ID }),
		);
		expect(out.kind).toBe('redirect');
		expect(mockApplyRulePreset).toHaveBeenCalledTimes(1);
		expect(mockApplyRulePreset.mock.calls[0]?.[2]).toMatchObject({
			tenantId: TENANT_ID,
			childId: OWN_CHILD_ID,
		});
	});

	it('[S5] childId 未指定 (選択しない) はこれまでどおりボーナスだけ取り込む', async () => {
		mockGetMarketplaceItem.mockReturnValue(rulePreset('bonus'));
		const out = await run(
			importRules,
			makeEvent('/setup/rules', { itemIds: ['rule-bonus'], childId: '' }),
		);
		expect(out.kind).toBe('redirect');
		expect(mockApplyRulePreset).toHaveBeenCalledTimes(1);
		expect(mockApplyRulePreset.mock.calls[0]?.[2]).toMatchObject({
			tenantId: TENANT_ID,
			childId: undefined,
		});
	});
});
