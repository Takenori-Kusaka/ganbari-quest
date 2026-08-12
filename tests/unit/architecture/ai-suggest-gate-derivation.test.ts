// tests/unit/architecture/ai-suggest-gate-derivation.test.ts
//
// #4506 (EPIC #4495) AC5 — AI 提案パネルの `isFamily` 導出を機械で 1 本に固定する
// fitness function (ADR-0061 原則 2: same-class N 回目は instance 修正をやめて guard に畳む)。
//
// ## なぜ機械 guard にしたか
//
// 同じ class の欠陥が 3 現場目である。
//
// - 1 現場目 #2902: activities が `data.planTier === 'family'` を渡すが load が planTier 未返却
//   → 常に false。**当時は「その画面だけ」直した (isPremium を渡す)。**
// - 2 現場目 #4506 GAMMA2-ADM1-01: checklists がまったく同じ状態のまま残っていた
//   → プレミアム加入者が購入済み機能を使えない (money)。
// - 3 現場目 #4506 GAMMA2-ADM1-02: activities の暫定策 (isPremium) が今度は standard に
//   解放表示を出す (legal、有利誤認)。
//
// 3 回とも「導出式が callsite ごとに手書きされている」ことが原因で、レビューでは 3 回とも
// 通ってしまった。式の正しさを人が毎回読む運用をやめ、**callsite が共有述語を経由していること**
// を機械が見る。
//
// ## 何を検査するか
//
// `src/routes/**/+page.svelte` の `<AiSuggest*Panel ... isFamily={...} />` 全 callsite が
// `isAiSuggestUnlocked(` を経由していること。経由しない callsite は
// `DEFERRED_DERIVATIONS` に **理由付きで** 登録されていなければ fail する。
// 「あとで直す」を無言で置けないようにするための登録であって、免除の入口ではない。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findReasonDefect } from '../../../scripts/lib/ci/exclusion-reason.mjs';

const repoRoot = resolve(__dirname, '../../..');

/** 導出の SSOT。callsite はこれを経由しなければならない。 */
const SHARED_PREDICATE = 'isAiSuggestUnlocked(';

/** AI 提案パネル callsite。`isFamily={...}` の中身を捕まえる。 */
const CALLSITE_PATTERN = /<AiSuggest(\w*)Panel\b[^>]*?isFamily=\{([^}]*)\}/gs;

/**
 * 共有述語へ未移行のまま許容する callsite。
 *
 * key は repo root からの POSIX 相対パス。**理由には追跡先 Issue 番号を必ず含める**
 * (`findReasonDefect` が空 / stub を弾き、本 file が `#\d+` を追加で要求する)。
 */
const DEFERRED_DERIVATIONS: Record<string, string> = {
	'src/routes/(parent)/admin/activities/+page.svelte':
		'#4506 で checklists (顧客救済側) のみ先行させた。activities を共有述語に移すと standard 加入者の表示が解放 → ロックに変わるが、この引き締めは PO の順序制約により #4501 (プレミアムのトライアル化) と同 wave か後に実施する。LP が「全機能お試し」を約束している間に先に締めると、見込み客に対する新たな誤認を作るため',
};

function listPageSvelte(dir: string): string[] {
	const found: string[] = [];
	const walk = (current: string): void => {
		for (const entry of readdirSync(current)) {
			const full = join(current, entry);
			if (statSync(full).isDirectory()) {
				if (entry === 'node_modules' || entry === '.svelte-kit') continue;
				walk(full);
				continue;
			}
			if (entry === '+page.svelte') found.push(full);
		}
	};
	walk(dir);
	return found;
}

interface Callsite {
	path: string;
	panel: string;
	expression: string;
}

const callsites: Callsite[] = listPageSvelte(join(repoRoot, 'src', 'routes')).flatMap((path) => {
	const source = readFileSync(path, 'utf-8');
	const rel = relative(repoRoot, path).replace(/\\/g, '/');
	return [...source.matchAll(CALLSITE_PATTERN)].map((m) => ({
		path: rel,
		panel: `AiSuggest${m[1]}Panel`,
		expression: (m[2] ?? '').trim(),
	}));
});

// repo 走査 test の区分宣言 (#4085、SSOT = scripts/lib/ci/repo-scan-test-registry.mjs)。
// src/routes 全体を walk するため、並列 worker との CPU / FS 競合で既定 5s を超えうる。
describe('AI 提案パネル isFamily 導出の単一実装 (#4506 AC5)', { timeout: 30000 }, () => {
	it('callsite を検出できている (検査が空振りしていない)', () => {
		// 0 件で PASS すると「callsite が無い」ことを健全と見なしてしまう。
		// panel の rename / prop 名変更で pattern が外れた場合もここで落ちる。
		expect(callsites.length).toBeGreaterThanOrEqual(3);
	});

	it('すべての callsite が共有述語 isAiSuggestUnlocked() を経由する (除外登録を除く)', () => {
		const violations = callsites
			.filter((c) => !c.expression.includes(SHARED_PREDICATE))
			.filter((c) => !(c.path in DEFERRED_DERIVATIONS))
			.map((c) => `${c.path} (${c.panel}): isFamily={${c.expression}}`);

		expect(
			violations,
			`isFamily の導出を手書きしている callsite があります。$lib/domain/ai-suggest-gate の ` +
				`isAiSuggestUnlocked() を使ってください (#4506)。意図的な未移行なら ` +
				`DEFERRED_DERIVATIONS に理由付きで登録してください:\n${violations.join('\n')}`,
		).toEqual([]);
	});

	it('除外登録は実在の callsite を指し、かつ現に未移行である (腐った除外を残さない)', () => {
		for (const path of Object.keys(DEFERRED_DERIVATIONS)) {
			const matching = callsites.filter((c) => c.path === path);
			expect(matching.length, `${path} に AI 提案パネルの callsite がありません`).toBeGreaterThan(
				0,
			);
			// 共有述語へ移行済みなのに除外が残っている = 除外の目的が消えている。消させる。
			const stillDeferred = matching.some((c) => !c.expression.includes(SHARED_PREDICATE));
			expect(
				stillDeferred,
				`${path} は共有述語へ移行済みです。DEFERRED_DERIVATIONS から削除してください`,
			).toBe(true);
		}
	});

	it('除外登録の理由が成立している (空 / stub / Issue 番号なしを弾く)', () => {
		for (const [path, reason] of Object.entries(DEFERRED_DERIVATIONS)) {
			const defect = findReasonDefect(reason);
			expect(defect, `${path} の除外理由: ${defect}`).toBeNull();
			expect(reason, `${path} の除外理由に追跡先 Issue 番号がありません`).toMatch(/#\d{3,}/);
		}
	});
});
