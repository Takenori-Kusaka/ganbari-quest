// tests/unit/architecture/irreversible-deletion-confirm-parity.test.ts
//
// #4642 (PO 決裁): 家族グループを物理削除する経路は、**どれも同じ重さの確認**を要求する。
//
// 退会 (/admin/settings/account) と 引っ越し合流 (/auth/invite/[code]) は結果が同じ
// (`fullTenantDeletion` = テナント物理削除、復旧不可) なのに、要求するものが
// 「文字入力 + 同意」と「チェック 1 つ」で非対称だった。これは「**軽いほうの経路から全損する**」
// を作る。しかも引っ越しは他人から渡された招待コードが起点で、自分で削除しに来たわけではない。
//
// 本 guard は (a) 確認語の atom が 1 つであること (複製を作らない、ADR-0045) と、
// (b) 両画面がその atom を経由していること を固定する。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INVITE_RELOCATION_LABELS, SETTINGS_LABELS } from '../../../src/lib/domain/labels';
import { CANCEL_TERMS } from '../../../src/lib/domain/terms';

const REPO_ROOT = join(__dirname, '../../..');

/** 家族グループを物理削除する経路の画面と、そのサーバー側。 */
const DESTRUCTIVE_SCREENS = [
	'src/routes/(parent)/admin/settings/account/+page.svelte',
	'src/lib/features/auth/InviteRelocationConfirmCard.svelte',
	'src/routes/auth/invite/[code]/+page.server.ts',
];

describe('#4642 不可逆削除の確認は経路で軽くしない', () => {
	it('確認語の atom は 1 つで、両経路がそれを参照する', () => {
		expect(CANCEL_TERMS.confirmPhrase).toBeTruthy();
		// 退会側の入力ラベル / 引っ越し側の placeholder・ラベルが同じ atom から組み立てられている
		expect(SETTINGS_LABELS.dangerConfirmInputLabel).toContain(CANCEL_TERMS.confirmPhrase);
		expect(INVITE_RELOCATION_LABELS.confirmInputPlaceholder).toBe(CANCEL_TERMS.confirmPhrase);
		expect(INVITE_RELOCATION_LABELS.confirmInputLabel).toBe(
			SETTINGS_LABELS.dangerConfirmInputLabel,
		);
		expect(INVITE_RELOCATION_LABELS.confirmInputMismatch).toContain(CANCEL_TERMS.confirmPhrase);
	});

	it('確認語を画面側に直書きしない (経路ごとに別の語が生まれない)', () => {
		for (const file of DESTRUCTIVE_SCREENS) {
			const source = readFileSync(join(REPO_ROOT, file), 'utf8');
			expect(
				source.includes(`'${CANCEL_TERMS.confirmPhrase}'`) ||
					source.includes(`"${CANCEL_TERMS.confirmPhrase}"`) ||
					source.includes(`「${CANCEL_TERMS.confirmPhrase}」`),
				`${file} が確認語を直書きしています。CANCEL_TERMS.confirmPhrase を参照してください (#4642)`,
			).toBe(false);
		}
	});

	it('両経路とも確認語の atom を実際に通している', () => {
		for (const file of DESTRUCTIVE_SCREENS) {
			const source = readFileSync(join(REPO_ROOT, file), 'utf8');
			expect(
				source.includes('CANCEL_TERMS.confirmPhrase') ||
					source.includes('dangerConfirmInputLabel') ||
					source.includes('confirmInputLabel'),
				`${file} が確認語の atom を経由していません。同意チェックだけで不可逆操作を実行させないこと (#4642)`,
			).toBe(true);
		}
	});
});
