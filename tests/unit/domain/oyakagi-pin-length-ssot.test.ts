// tests/unit/domain/oyakagi-pin-length-ssot.test.ts
// #4661 / #4662: おやカギコードの桁数が 4 通りに割れ、保護者が見守り画面から締め出される
// 経路を作っていた class を機械 gate 化する。
//
// 観測された実害:
//   - `/switch` の入力欄は `PinInput length={4}` = **ちょうど 4 桁しか打てない**
//   - parent-gate setup / verify / reset-verified / stripe portal は `/^\d{4,6}$/`
//   - `/admin/settings/account` の変更フォームだけが 4〜8 桁を受理
//   - 文言は「4桁」「4〜6桁」「4〜8桁」が混在 (#4661 M1 / #4662 F1 / M1)
//   → 設定 > アカウント で 5 桁以上に変更すると、`/switch` から正しいコードを送れなくなり
//     見守り画面に入れない (復旧は パスワード / 確認コードによる再設定が必要)。
//
// 正は **実際に打てる桁数** = `constants/oyakagi.ts` の `PIN_LENGTH`。
// 検証側は `PIN_PATTERN`、表示側は `OYAKAGI_TERMS.digitRange` を引く。
// 本 test は「桁数がどこかに直書きされたら落ちる」形で再発を止める (ADR-0061 same-class → guard)。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PIN_LENGTH, PIN_PATTERN } from '$lib/domain/constants/oyakagi';
import {
	OYAKAGI_LABELS,
	PAGE_GUIDE_LABELS,
	PIN_GATE_ONBOARDING_LABELS,
	PIN_RESET_LABELS,
} from '$lib/domain/labels';
import { OYAKAGI_TERMS } from '$lib/domain/terms';
import { buildOyakagiTerms } from '../../../scripts/generate-lp-labels.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ACCOUNT_DIR = path.join(REPO_ROOT, 'src/routes/(parent)/admin/settings/account');
const ACCOUNT_SERVER = path.join(ACCOUNT_DIR, '+page.server.ts');
const ACCOUNT_PAGE = path.join(ACCOUNT_DIR, '+page.svelte');

/**
 * おやカギコードを検証 / 入力する全ての箇所 (#4661)。
 * 新しい検証点を足したらここにも足す。列挙漏れは [P6] の横断 scan が拾う。
 */
const PIN_CALLSITES = [
	'src/lib/domain/validation/auth.ts',
	'src/routes/(parent)/login/+page.svelte',
	'src/routes/(parent)/admin/settings/account/+page.server.ts',
	'src/routes/api/v1/parent-gate/verify/+server.ts',
	'src/routes/api/v1/parent-gate/setup/+server.ts',
	'src/routes/api/v1/parent-gate/reset-verified/+server.ts',
	'src/routes/api/stripe/portal/+server.ts',
	'src/routes/auth/reset-pin/+page.svelte',
	'src/routes/switch/+page.svelte',
	'src/lib/features/admin/components/SaasLicensePanel.svelte',
] as const;

/** コメント (行 / ブロック / HTML) を落とす。経緯説明で旧表記に触れるのは許す。 */
function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '')
		.replace(/<!--[\s\S]*?-->/g, '');
}

/** 「N桁」「N〜M桁」の形で桁数を直書きしている箇所を集める。 */
function hardcodedDigitMentions(text: string): string[] {
	return [...text.matchAll(/\d+\s*(?:〜\s*\d+\s*)?桁/g)].map((m) => m[0]);
}

describe('#4661 おやカギコードの桁数は 1 つの SSOT から出る', () => {
	it('[P1] digitRange / PIN_PATTERN は PIN_LENGTH から導出される', () => {
		expect(OYAKAGI_TERMS.digitRange).toBe(`${PIN_LENGTH}桁`);
		expect(PIN_PATTERN.test('0'.repeat(PIN_LENGTH))).toBe(true);
		expect(PIN_PATTERN.test('0'.repeat(PIN_LENGTH + 1))).toBe(false);
		expect(PIN_PATTERN.test('0'.repeat(PIN_LENGTH - 1))).toBe(false);
	});

	// LP labels 生成 script は TS を実行せず text parse するため digitRange を自前で組み立て直す
	// (buildPriceTerms / buildPlanRetentionTerms と同型)。その再現が TS 側とずれないことを固定する。
	it('[P1b] LP labels 生成 script が組み立てる digitRange が TS 側と一致する', () => {
		expect((buildOyakagiTerms() as { digitRange: string }).digitRange).toBe(
			OYAKAGI_TERMS.digitRange,
		);
	});

	it('[P2] おやカギ関連ラベルは digitRange 以外の桁数を名乗らない', () => {
		const labelled: [string, string][] = [
			['OYAKAGI_LABELS.inputLabel', OYAKAGI_LABELS.inputLabel],
			['OYAKAGI_LABELS.newInputLabel', OYAKAGI_LABELS.newInputLabel],
			['OYAKAGI_LABELS.formatError', OYAKAGI_LABELS.formatError],
			['OYAKAGI_LABELS.gateFormatNotice', OYAKAGI_LABELS.gateFormatNotice],
			['OYAKAGI_LABELS.gateCreateDescription', OYAKAGI_LABELS.gateCreateDescription],
			['PIN_RESET_LABELS.resetPinLabel', PIN_RESET_LABELS.resetPinLabel],
			['PIN_RESET_LABELS.errorPinFormat', PIN_RESET_LABELS.errorPinFormat],
			['PIN_GATE_ONBOARDING_LABELS.dialogPinHint', PIN_GATE_ONBOARDING_LABELS.dialogPinHint],
		];
		for (const [key, value] of labelled) {
			const stray = hardcodedDigitMentions(value).filter((m) => m !== OYAKAGI_TERMS.digitRange);
			expect(stray, `${key} に digitRange 以外の桁数表記: ${stray.join(', ')}\n  ${value}`).toEqual(
				[],
			);
		}
		// 桁数を述べるべきラベルが「述べなくなる」退行も止める
		for (const [key, value] of labelled) {
			expect(value, `${key} が桁数を述べていない`).toContain(OYAKAGI_TERMS.digitRange);
		}
	});

	it('[P3] ページガイド (設定ハブ / アカウント) が述べる桁数は digitRange だけ', () => {
		const steps: {
			title: string;
			what: string;
			how: string;
			goal: string;
			tips?: readonly string[];
		}[] = [
			...Object.values(PAGE_GUIDE_LABELS.adminSettings.steps),
			...Object.values(PAGE_GUIDE_LABELS.adminSettingsAccount.steps),
		];
		const guideTexts = steps.flatMap((step) => [
			step.title,
			step.what,
			step.how,
			step.goal,
			...(step.tips ?? []),
		]);

		for (const text of guideTexts) {
			const stray = hardcodedDigitMentions(text).filter((m) => m !== OYAKAGI_TERMS.digitRange);
			expect(
				stray,
				`ページガイド文言に digitRange 以外の桁数表記: ${stray.join(', ')}\n  ${text}`,
			).toEqual([]);
		}
	});

	it('[P4] account ページ / server が桁数を直書きしていない (定数経由)', () => {
		for (const file of [ACCOUNT_SERVER, ACCOUNT_PAGE]) {
			const body = stripComments(fs.readFileSync(file, 'utf8'));
			const stray = hardcodedDigitMentions(body);
			expect(
				stray,
				`${path.relative(REPO_ROOT, file)} に桁数の直書き: ${stray.join(', ')}\n` +
					'→ OYAKAGI_LABELS の入力ラベル / OYAKAGI_TERMS.digitRange を参照すること',
			).toEqual([]);
		}
	});

	it('[P5] 全ての検証 / 入力箇所が constants/oyakagi.ts を import する', () => {
		for (const rel of PIN_CALLSITES) {
			const source = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
			expect(source, `${rel} が おやカギ桁数の SSOT を参照していない`).toMatch(
				/from '\$lib\/domain\/constants\/oyakagi'/,
			);
		}
	});

	// 「打てる桁数」と「受理される桁数」が再びずれる書き方 (数値直書き / 独自 regex) を横断で禁止する。
	// 列挙 (PIN_CALLSITES) に足し忘れても、ここが `\d{4,6}` 等の再出現を拾う。
	it('[P6] おやカギの桁数を独自に判定するコードが残っていない', () => {
		const offenders: string[] = [];
		for (const rel of PIN_CALLSITES) {
			const body = stripComments(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
			// 独自の桁数 regex (例: /^\d{4,6}$/) と PinInput の length 数値直書き
			if (/\\d\{\d+(?:,\d+)?\}/.test(body)) offenders.push(`${rel}: 独自の桁数 regex`);
			// PinInput の length 数値直書き (おやカギ / 確認コードとも定数経由にする)
			const inputs = [...body.matchAll(/<PinInput[^>]*length=\{(\d+)\}/g)].map((m) => m[1]);
			if (inputs.length > 0)
				offenders.push(`${rel}: PinInput length 直書き (${inputs.join(', ')})`);
		}
		expect(
			offenders,
			`桁数を独自判定している箇所:\n  ${offenders.join('\n  ')}\n` +
				'→ PIN_PATTERN / PIN_LENGTH を使うこと (入口と受理側がずれると締め出しになる)',
		).toEqual([]);
	});
});
