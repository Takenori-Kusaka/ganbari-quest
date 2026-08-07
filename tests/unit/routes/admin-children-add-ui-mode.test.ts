// tests/unit/routes/admin-children-add-ui-mode.test.ts
// #4419: /admin/children から登録した子供の uiMode が年齢どおりになることを固定する。
//
// **本番 backend (dsql repo) で検証する**。dsql repo は PGlite で verbatim 再利用される
// (ADR-0064) ため、実 schema を適用した PGlite に対して route action → child-service →
// dsql child-repo の実経路をそのまま通す。demo backend だけが getDefaultUiMode を呼んで
// いたので、demo で検証しても本 defect は再現しない (#4419 §検出されなかった理由)。
//
// 固定する不変条件:
//   [A] 5 年齢帯の境界 (2/3/5/6/12/13/15/16 歳) が getDefaultUiMode どおりに入る
//   [B] birthDate なし (age のみ) の登録でも正しい — dsql は birth_date NULL 行で
//       compute-on-read の再導出が効かず stored 値がそのまま出るため、ここが実害の本体
//   [C] birthDate あり の登録でも正しい (stored 値自体が正しいこと)

import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { getDefaultUiMode } from '../../../src/lib/domain/validation/age-tier';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { IChildRepo } from '../../../src/lib/server/db/interfaces/child-repo.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000004a1';

let repo: IChildRepo;

// ---------- mocks: 本経路 (route → service → child-repo) 以外は最小 stub ----------

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: (locals: { context?: { tenantId?: string } }) => {
		if (!locals.context?.tenantId) throw new Error('Unauthorized');
		return locals.context.tenantId;
	},
}));

// child-repo だけは「本番 backend の実物」を差す (PGlite 上の dsql repo に委譲)。
vi.mock('$lib/server/db/child-repo', () => ({
	insertChild: (input: Parameters<IChildRepo['insertChild']>[0], tenantId: string) =>
		repo.insertChild(input, tenantId),
	findAllChildren: (tenantId: string) => repo.findAllChildren(tenantId),
	findChildById: (id: never, tenantId: string) => repo.findChildById(id, tenantId),
	findChildByUserId: (userId: string, tenantId: string) => repo.findChildByUserId(userId, tenantId),
	updateChild: (id: never, input: never, tenantId: string) =>
		repo.updateChild(id, input, tenantId),
	deleteChild: (id: never, tenantId: string) => repo.deleteChild(id, tenantId),
	resetChildProgressData: vi.fn(),
	findArchivedChildren: vi.fn().mockResolvedValue([]),
	archiveChild: vi.fn(),
	restoreChild: vi.fn(),
}));

vi.mock('$lib/server/services/plan-limit-service', () => ({
	checkChildLimit: vi.fn().mockResolvedValue({ allowed: true, max: 10 }),
	getPlanLimits: vi.fn().mockReturnValue({ historyRetentionDays: null }),
	hasArchivedData: vi.fn().mockResolvedValue(false),
	applyRetentionFilter: <T>(rows: T) => rows,
	resolveFullPlanTier: vi.fn().mockResolvedValue('free'),
}));

vi.mock('$lib/server/services/activity-log-service', () => ({ getActivityLogs: vi.fn() }));
vi.mock('$lib/server/services/point-service', () => ({ getPointBalance: vi.fn() }));
vi.mock('$lib/server/services/status-service', () => ({
	getChildStatus: vi.fn(),
	updateStatus: vi.fn(),
}));
vi.mock('$lib/server/services/voice-service', () => ({
	activateVoice: vi.fn(),
	deleteVoice: vi.fn(),
	listVoices: vi.fn(),
	uploadVoice: vi.fn(),
}));
vi.mock('$lib/server/storage', () => ({
	deleteByPrefix: vi.fn(),
	deleteFile: vi.fn(),
	listFiles: vi.fn().mockResolvedValue([]),
	saveFile: vi.fn(),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { actions } = await import('../../../src/routes/(parent)/admin/children/+page.server');

function createEvent(formValues: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(formValues)) fd.set(k, v);
	return {
		request: { formData: () => Promise.resolve(fd) } as unknown as Request,
		locals: { context: { tenantId: FAMILY } },
		// biome-ignore lint/suspicious/noExplicitAny: SvelteKit RequestEvent の全 field は不要
	} as any;
}

/** /admin/children の addChild action を実行して、保存された子供を DB から読み直す。 */
async function addViaAdminRoute(form: Record<string, string>) {
	// biome-ignore lint/suspicious/noExplicitAny: action の戻り値 union を絞らない
	const result: any = await actions.addChild(createEvent(form));
	expect(result?.success, `addChild が失敗した: ${JSON.stringify(result)}`).toBe(true);
	const reloaded = await repo.findChildById(result.addedChild.id, FAMILY);
	return { returned: result.addedChild, reloaded };
}

describe('#4419 /admin/children 登録時の uiMode (本番 backend = dsql/PGlite)', () => {
	let t: DsqlTestDb;

	beforeAll(async () => {
		t = await createDsqlTestDb();
		repo = createDsqlChildRepo(t.db, createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 }));
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	// #4419 完了条件「15 歳を登録すると senior」は年齢帯の境界が 1 段ずれている。
	// SSOT (docs/DESIGN.md §8 / getDefaultUiMode) では 13〜15 歳 = junior、16〜18 歳 = senior。
	// 完了条件の意図 (中高生に幼児 UI を出さない) を、正しい境界で 2 件に分けて表明する。
	it('[A] 中学生 (15 歳) は junior、高校生 (16 歳) は senior で登録される', async () => {
		const jr = await addViaAdminRoute({ nickname: 'ちゅう3', age: '15', theme: 'blue' });
		expect(jr.returned.uiMode).toBe('junior');
		expect(jr.reloaded?.uiMode).toBe('junior');

		const sr = await addViaAdminRoute({ nickname: 'こう1', age: '16', theme: 'blue' });
		expect(sr.returned.uiMode).toBe('senior');
		expect(sr.reloaded?.uiMode).toBe('senior');

		// いずれも「幼児 UI が出る」= 本 defect の症状ではないこと
		expect(jr.reloaded?.uiMode).not.toBe('preschool');
		expect(sr.reloaded?.uiMode).not.toBe('preschool');
	});

	// 5 年齢帯すべての境界 — docs/DESIGN.md §8 / getDefaultUiMode の SSOT に一致させる。
	const BOUNDARIES: Array<[number, string]> = [
		[0, 'baby'],
		[2, 'baby'],
		[3, 'preschool'],
		[5, 'preschool'],
		[6, 'elementary'],
		[12, 'elementary'],
		[13, 'junior'],
		[15, 'junior'],
		[16, 'senior'],
		[18, 'senior'],
	];

	it.each(BOUNDARIES)('[B] age=%i (birthDate なし) → %s', async (age, expected) => {
		expect(getDefaultUiMode(age)).toBe(expected); // SSOT 自体の境界も固定する
		const { reloaded } = await addViaAdminRoute({
			nickname: `age${age}`,
			age: String(age),
			theme: 'pink',
		});
		expect(reloaded?.uiMode).toBe(expected);
		expect(reloaded?.uiModeManuallySet).toBe(0); // 自動判定は手動フラグを立てない
	});

	it('[C] birthDate 指定の登録でも stored 値が年齢どおりになる', async () => {
		const today = new Date();
		const birthDate = `${today.getUTCFullYear() - 14}-01-01`;
		const { reloaded } = await addViaAdminRoute({
			nickname: 'ちゅうがくせい',
			birthDate,
			theme: 'green',
		});
		expect(reloaded?.uiMode).toBe('junior');
	});
});

// [B] の 15 歳ケースが本 issue の中心。dsql は birth_date NULL 行では compute-on-read の
// ui_mode 再導出をせず stored 値を返すため、insert 時の既定値がそのまま子供の画面になる。
