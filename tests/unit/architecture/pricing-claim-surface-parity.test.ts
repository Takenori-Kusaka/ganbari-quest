// tests/unit/architecture/pricing-claim-surface-parity.test.ts
//
// **同じ約束・同じ確認語が、面によって違う形にならないこと**を固定する
// (#4866 系 QM 監査 consistency / PO 差し戻し 2026-09-09)。
//
// ## なぜ要るか
//
// 1. **チェックリストの枠**: 「3 個/子まで」の枠は取込んだぶんも消費する (#4713)。
//    LP pricing だけが「（取込を含む）」に直り、**パンフとアプリ内 /pricing は旧文言のまま**
//    だった。顧客は 3 面のどれを読むか選べないので、面ごとに枠の数え方が違って見える。
//
// 2. **ダウングレードの確認語**: 保護者が自分で打つ確認語が client / server / test の
//    **3 箇所に直書き**されていた。1 つだけ変えると、顧客は「画面の指示どおり打っているのに
//    通らない」に当たる。画面の指示と server の照合がずれた理由は顧客からは見えない。
//
// ## 固定する不変条件
//
//   [P1] チェックリストの枠の言い方が LP pricing / パンフ / アプリ内 pricing で一致する
//   [P2] ダウングレードの確認語は atom 1 つで、client / server / test が直書きしない

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	LP_PAMPHLET_PHASEB_LABELS,
	LP_PRICING_PHASEB_LABELS,
} from '../../../src/lib/domain/labels';
import { PRICING_PAGE_FEATURES } from '../../../src/lib/domain/plan-features';
import { PLAN_TERMS } from '../../../src/lib/domain/terms';

const REPO_ROOT = join(__dirname, '../../..');

/** 取込んだチェックリストも同じ枠を消費する (#4713) ことを明示する注記。 */
const IMPORT_INCLUDED_NOTE = '（取込を含む）';

describe('[P1] チェックリストの枠の言い方は 3 面で一致する', () => {
	it('LP pricing が「取込を含む」と書いている', () => {
		expect(LP_PRICING_PHASEB_LABELS.k6).toContain(IMPORT_INCLUDED_NOTE);
	});

	it('パンフも同じ注記を持つ', () => {
		expect(
			LP_PAMPHLET_PHASEB_LABELS.k34,
			'LP だけ直すと、パンフを見た顧客は取込ぶんが枠外だと読む',
		).toContain(IMPORT_INCLUDED_NOTE);
	});

	it('アプリ内 /pricing (無料プランの機能一覧) も同じ注記を持つ', () => {
		const line = PRICING_PAGE_FEATURES.free.find((f) => f.includes('チェックリスト'));
		expect(line, '無料プランの機能一覧にチェックリストの行が無い').toBeTruthy();
		expect(line, '契約前 (LP) と契約後 (アプリ内) で枠の数え方が違って見える').toContain(
			IMPORT_INCLUDED_NOTE,
		);
	});
});

describe('[P2] ダウングレードの確認語は atom 1 つ', () => {
	// 確認語を直書きしてよい場所は terms.ts だけ。ここを増やすと、画面と server の
	// 照合がずれても CI は緑のまま通る (#4642 の削除確認語と同じ規律)。
	const CALLERS = [
		'src/lib/features/admin/components/SaasLicensePanel.svelte',
		'src/routes/api/stripe/portal/+server.ts',
		'tests/unit/routes/stripe-portal-intent.test.ts',
	];

	it('atom が存在する', () => {
		expect(PLAN_TERMS.downgradeConfirmPhrase).toBeTruthy();
	});

	for (const file of CALLERS) {
		it(`${file} は確認語を直書きしない`, () => {
			const source = readFileSync(join(REPO_ROOT, file), 'utf8');
			const phrase = PLAN_TERMS.downgradeConfirmPhrase;
			expect(
				source.includes(`'${phrase}'`) || source.includes(`"${phrase}"`),
				`${file} が確認語を直書きしている。1 箇所だけ変わると顧客は ` +
					'「画面の指示どおり打っているのに通らない」に当たる',
			).toBe(false);
			expect(source, `${file} が atom を参照していない`).toContain('downgradeConfirmPhrase');
		});
	}
});
