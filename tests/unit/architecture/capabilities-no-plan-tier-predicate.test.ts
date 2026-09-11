// tests/unit/architecture/capabilities-no-plan-tier-predicate.test.ts (#4710 / ADR-0061)
//
// **プラン別の可否判定は `plan-limit-service.ts` だけが持つ**ことを機械で保証する。
//
// # なぜ必要か
//
// `src/lib/policy/capabilities.ts` は 9 capability を定義していたが、production から呼ばれるのは
// `write.db` の 1 つだけだった。残りは未配線であるにもかかわらず、3 つが**独自にプラン条件を
// 持って**いた。しかも `invite.family_member` は `tier !== 'family'` で deny =
// **スタンダードは家族を招待できない**という定義で、`plan-limit-service`
// (`maxFamilyMembers: standard = 4`) と正反対だった (#4710 F3)。
//
// 未配線なので今は誰も困らない。しかし `ensureCan(ctx, 'invite.family_member')` を 1 行足した
// 瞬間にスタンダード契約者の招待が 403 になる。**判定が 2 箇所にあること自体が地雷**なので、
// 3 件を削除したうえで「プラン条件を policy 層に書き足せない」ことを本 test が保つ。
//
// # 何を fail させるか
//
// `capabilities.ts` に plan tier を見る述語 (`ctx.plan`, `tier === 'family'` 等) が現れた状態。

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getPlanLimits } from '$lib/server/services/plan-limit-service';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CAPABILITIES = join(REPO_ROOT, 'src/lib/policy/capabilities.ts');

/** コメント (`//` 行 / `/* *\/` ブロック) を除いた実コードだけを返す。 */
function stripComments(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('#4710 policy/capabilities はプラン条件を持たない (SSOT = plan-limit-service)', () => {
	const code = stripComments(readFileSync(CAPABILITIES, 'utf-8'));

	it('ctx.plan を読む述語が無い', () => {
		const hits = code.match(/ctx\.plan\b[^\n]*/g) ?? [];
		expect(
			hits,
			[
				'capabilities.ts がプラン条件を持っています。',
				`  該当: ${hits.join(' / ')}`,
				'→ プラン別の可否は plan-limit-service.ts (PLAN_LIMITS / checkXxxLimit) に置いてください。',
				'  2 箇所に置くと、片方だけ直したときに「配線した瞬間に正しい契約者が 403」になります (#4710)。',
			].join('\n'),
		).toEqual([]);
	});

	it("plan tier リテラル ('free' / 'standard' / 'family') を判定に使っていない", () => {
		const hits = code.match(/tier\s*[!=]==?\s*'(free|standard|family)'/g) ?? [];
		expect(hits).toEqual([]);
	});

	it('plan-tier-insufficient という拒否理由を持たない (使う判定が無いため)', () => {
		expect(code).not.toContain('plan-tier-insufficient');
	});

	it('家族メンバー上限の SSOT は plan-limit-service 側にあり、standard は招待できる', () => {
		// 削除した capability の定義 (tier !== 'family' で deny) が誤りだったことの根拠。
		expect(getPlanLimits('standard').maxFamilyMembers).toBeGreaterThan(1);
		expect(getPlanLimits('family').maxFamilyMembers).toBeNull(); // 無制限
	});
});
