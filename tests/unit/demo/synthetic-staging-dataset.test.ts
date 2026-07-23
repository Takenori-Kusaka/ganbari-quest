// tests/unit/demo/synthetic-staging-dataset.test.ts — 合成 staging dataset の機械保証 (#3412)
//
// AC1 (PII-free): dataset 全走査で「合成名 allowlist 外の nickname 0 件 / email 0 件 / 電話番号
//   pattern 0 件」を機械 assert する。実在人名の denylist はそれ自体が PII になるため置けない —
//   代わりに「出現してよい名前の完全列挙 (allowlist)」方式で混入を fail-closed 検出する。
// AC2 (網羅次元): research §2 の各軸 (5 age mode / 5 theme / trial 3 状態 / 単独子・兄弟 /
//   per-child・family master / marketplace 取込前後 / 空状態 / archive) が dataset に存在する。
// AC3 (決定性): 同一 anchor で byte 同一。anchor shift は日付の純関数。

import { describe, expect, it } from 'vitest';
import {
	buildSyntheticStagingDataset,
	daysBetween,
	resolveTrialWindow,
	SYNTHETIC_NICKNAME_ALLOWLIST,
	SYNTHETIC_SEED_ANCHOR,
} from '../../../src/lib/server/demo/synthetic-staging-dataset';

// 電話番号様 pattern (0 始まりハイフン区切り)。前後 lookaround で UUID
// (`0000-4000-8000` のようなハイフン連結 hex run) と日付を誤検出しない。
const PHONE_LIKE = /(?<![\d-])0\d{1,4}-\d{2,4}-\d{3,4}(?![\d-])/;

describe('synthetic-staging-dataset (#3412)', () => {
	it('AC1: PII-free — nickname は合成 allowlist のみ / email・電話番号 pattern 0 件 (全走査)', async () => {
		const dataset = await buildSyntheticStagingDataset();

		const nicknames = dataset.tenants.flatMap(
			(t) => t.data?.family.children.map((c) => c.nickname) ?? [],
		);
		expect(nicknames.length).toBeGreaterThan(0);
		for (const nickname of nicknames) {
			expect(SYNTHETIC_NICKNAME_ALLOWLIST, `allowlist 外の nickname: ${nickname}`).toContain(
				nickname,
			);
		}

		// 全 field 走査 (serialize して素朴に scan する = field 追加漏れが構造的に起きない)
		const serialized = JSON.stringify(dataset);
		expect(serialized.includes('@'), 'email 様文字列 (@) が dataset に含まれる').toBe(false);
		expect(PHONE_LIKE.test(serialized), '電話番号様 pattern が dataset に含まれる').toBe(false);
	});

	it('AC3: 決定性 — 同一 anchor で 2 回 build した出力が byte 同一', async () => {
		const a = await buildSyntheticStagingDataset();
		const b = await buildSyntheticStagingDataset();
		expect(JSON.stringify(a)).toEqual(JSON.stringify(b));

		const c = await buildSyntheticStagingDataset('2026-04-27');
		const d = await buildSyntheticStagingDataset('2026-04-27');
		expect(JSON.stringify(c)).toEqual(JSON.stringify(d));
	});

	it('AC3: anchor shift — 全日付が anchor 差分だけ一律 shift される (履歴の相対位置不変)', async () => {
		const base = await buildSyntheticStagingDataset();
		const shifted = await buildSyntheticStagingDataset('2026-04-27');
		const offset = daysBetween(SYNTHETIC_SEED_ANCHOR, '2026-04-27');
		expect(offset).toBe(31);

		const baseA = base.tenants[0]?.data;
		const shiftedA = shifted.tenants[0]?.data;
		expect(baseA && shiftedA).toBeTruthy();
		// 件数は不変 (drop 判定は anchor 非依存)
		expect(shiftedA?.data.activityLogs.length).toBe(baseA?.data.activityLogs.length);
		// 代表 field の日付が offset ぶん shift
		const baseDate = baseA?.data.activityLogs[0]?.recordedDate;
		const shiftedDate = shiftedA?.data.activityLogs[0]?.recordedDate;
		expect(baseDate && shiftedDate && daysBetween(baseDate, shiftedDate)).toBe(offset);
		// birthDate も shift = compute-on-read の age-tier 網羅が anchor に依らず保たれる
		const baseBirth = baseA?.family.children[0]?.birthDate;
		const shiftedBirth = shiftedA?.family.children[0]?.birthDate;
		expect(baseBirth && shiftedBirth && daysBetween(baseBirth, shiftedBirth)).toBe(offset);
	});

	it('anchor の形式不正は throw する', async () => {
		await expect(buildSyntheticStagingDataset('not-a-date')).rejects.toThrow('YYYY-MM-DD');
	});

	it('AC2: 5 age mode × 5 theme × 単独子/兄弟 両構成を網羅する (D1-D3 / D9)', async () => {
		const dataset = await buildSyntheticStagingDataset();
		const children = dataset.tenants.flatMap((t) => t.data?.family.children ?? []);

		const uiModes = new Set(children.map((c) => c.uiMode));
		for (const mode of ['baby', 'preschool', 'elementary', 'junior', 'senior']) {
			expect(uiModes, `uiMode ${mode} が欠落`).toContain(mode);
		}
		const themes = new Set(children.map((c) => c.theme));
		for (const theme of ['blue', 'pink', 'green', 'purple', 'orange']) {
			expect(themes, `theme ${theme} が欠落`).toContain(theme);
		}
		// 兄弟あり (tenant A = 5 人) + 単独子 (tenant B/C = 1 人)
		const childCounts = dataset.tenants.map((t) => t.data?.family.children.length ?? 0);
		expect(Math.max(...childCounts)).toBeGreaterThanOrEqual(5);
		expect(childCounts).toContain(1);
		// 全 child に birthDate (compute-on-read の唯一の年齢ソース、#3584 cutover gate 整合)
		for (const c of children) expect(c.birthDate, `${c.nickname} birthDate 欠落`).toBeTruthy();
	});

	it('AC2: plan / trial 軸 — premium + free + trial active/expired/not-started (D4 / D6)', async () => {
		const dataset = await buildSyntheticStagingDataset();
		const byKey = new Map(dataset.tenants.map((t) => [t.key, t]));

		expect(byKey.get('premium-family')?.family.plan).toBe('family-monthly');
		expect(byKey.get('free')?.family.plan).toBeNull();
		expect(byKey.get('free')?.trial).toBeNull(); // not-started

		const active = byKey.get('trial-active')?.trial;
		expect(active?.tier).toBe('standard');
		expect(active && active.startOffsetDays < 0 && active.endOffsetDays > 0).toBe(true);

		const expired = byKey.get('trial-expired')?.trial;
		expect(expired?.tier).toBe('family');
		expect(expired && expired.endOffsetDays < 0).toBe(true);

		// resolveTrialWindow は anchor 相対の純関数
		expect(active && resolveTrialWindow(active, '2026-03-27')).toEqual({
			startDate: '2026-03-25',
			endDate: '2026-04-01',
		});
	});

	it('AC2: per-child / family master / marketplace 取込前後 / 空状態 / archive (D10 / D11 / D18 / D19)', async () => {
		const dataset = await buildSyntheticStagingDataset();
		const byKey = new Map(dataset.tenants.map((t) => [t.key, t]));
		const tenantA = byKey.get('premium-family')?.data;
		expect(tenantA).toBeTruthy();

		// D10: per-child instance + family master (checklist) 両モデル
		expect(tenantA?.data.childActivities.length).toBeGreaterThan(0);
		expect(tenantA?.data.checklistTemplates.length).toBeGreaterThan(0);

		// D11: marketplace 取込済 (sourcePresetId 付き) が activity / reward / checklist に存在
		expect(tenantA?.data.childActivities.some((a) => a.sourcePresetId)).toBe(true);
		expect(tenantA?.data.specialRewards.some((r) => r.sourcePresetId)).toBe(true);
		expect(tenantA?.data.checklistTemplates.some((t) => t.sourcePresetId)).toBe(true);
		// demo 内部識別子 (`demo:<n>`) は marketplace 由来として持ち出さない
		for (const a of tenantA?.data.childActivities ?? []) {
			expect(a.sourcePresetId?.startsWith('demo:')).not.toBe(true);
		}

		// D11 (取込前): free tenant は marketplace 未取込 + checklist なし (empty admin)
		const tenantB = byKey.get('free')?.data;
		expect(tenantB?.data.childActivities.every((a) => !a.sourcePresetId)).toBe(true);
		expect(tenantB?.data.checklistTemplates.length).toBe(0);

		// D18: 空 tenant (子供 0 人)
		expect(byKey.get('empty')?.data).toBeNull();

		// D19: archive 済データ (trial-expired tenant)
		const tenantC2 = byKey.get('trial-expired')?.data;
		expect(tenantC2?.data.childActivities.some((a) => a.isArchived === 1)).toBe(true);
		expect(tenantC2?.data.checklistTemplates.some((t) => t.isArchived)).toBe(true);
	});

	it('AC2: 活動属性 / ごほうび交換 3 status / スタンプ / 証明書 / 履歴深さ / コミュニケーション (D13-D17 / D20)', async () => {
		const dataset = await buildSyntheticStagingDataset();
		const tenantA = dataset.tenants.find((t) => t.key === 'premium-family')?.data;
		expect(tenantA).toBeTruthy();
		const tx = tenantA?.data;

		// D13: must 属性 + main quest
		expect(tx?.childActivities.some((a) => a.priority === 'must')).toBe(true);
		expect(tx?.childActivities.some((a) => a.isMainQuest === 1)).toBe(true);

		// D14: 交換申請 pending / approved / rejected の 3 status
		const statuses = new Set(tx?.rewardRedemptions.map((r) => r.status));
		expect(statuses).toContain('pending_parent_approval');
		expect(statuses).toContain('approved');
		expect(statuses).toContain('rejected');

		// D15: スタンプカード + 押印 entry
		expect(tx?.stampCards.length).toBeGreaterThan(0);
		expect(tx?.stampCards.some((c) => c.entries.length > 0)).toBe(true);

		// D16: status 5 軸 + 証明書
		expect(new Set(tx?.statuses.map((s) => s.categoryCode)).size).toBeGreaterThanOrEqual(5);
		expect(tx?.certificates.length).toBeGreaterThan(0);

		// D17: 履歴の深さ (レーダー / MilestoneBanner / 月次レポートが空にならない件数)
		expect(tx?.activityLogs.length).toBeGreaterThanOrEqual(50);

		// D20: 親→子メッセージ + きょうだい応援
		expect(tx?.parentMessages.length).toBeGreaterThan(0);
		expect(tx?.siblingCheers.length).toBeGreaterThan(0);

		// 活動ログの参照整合 (childRef × activityName が per-child 活動に解決できる)
		const namesByRef = new Map<string, Set<string>>();
		for (const a of tx?.childActivities ?? []) {
			const set = namesByRef.get(a.childRef) ?? new Set<string>();
			set.add(a.name);
			namesByRef.set(a.childRef, set);
		}
		for (const log of tx?.activityLogs ?? []) {
			expect(
				namesByRef.get(log.childRef)?.has(log.activityName),
				`log の activityName が未解決: ${log.childRef}/${log.activityName}`,
			).toBe(true);
		}
	});
});
