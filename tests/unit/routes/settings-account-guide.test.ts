// tests/unit/routes/settings-account-guide.test.ts
// #4662 (EPIC #4650): 設定 > アカウント のページガイドが画面の実態とずれる class を機械 gate 化する。
//
// 観測された実害:
//   - ② と ③ が同じ `pin-settings` カードを連続で光らせ、内容もほぼ同じで実質 1 枚分だった
//   - 手順が 3 段（現在 / 新しい / ボタン）で、実フォールにある「新しい…（確認）」欄の再入力が
//     抜けていた → ガイドどおり操作すると required エラーで必ず失敗する
//   - ボタン名がガイドでは「変更ボタン」と汎称で、画面表記（OYAKAGI_LABELS.changeAction）と違った
//   - ページ下部の ログアウト / アカウント削除（最も不可逆）に step が無かった
//
// 文言そのものの良し悪しは機械判定できないが、**画面に出ている文字列と一致しているか**と
// **同じ anchor を連続で光らせていないか**は判定できる。ここを固定する (ADR-0061 same-class → guard)。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OYAKAGI_LABELS, PAGE_GUIDE_LABELS, SETTINGS_LABELS } from '$lib/domain/labels';
import { SETTINGS_ACCOUNT_GUIDE } from '../../../src/routes/(parent)/admin/settings/account/_guide';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ACCOUNT_PAGE = path.join(
	REPO_ROOT,
	'src/routes/(parent)/admin/settings/account/+page.svelte',
);

const STEPS = PAGE_GUIDE_LABELS.adminSettingsAccount.steps;

describe('#4662 設定 > アカウント のガイドが画面の実態と一致する', () => {
	it('[A1] 同じ anchor を連続する step で光らせない (同じカードが 2 回続かない)', () => {
		const selectors = SETTINGS_ACCOUNT_GUIDE.steps.map((s) => s.selector ?? null);
		for (let i = 1; i < selectors.length; i++) {
			expect(
				selectors[i] !== null && selectors[i] === selectors[i - 1],
				`step ${i} と ${i + 1} が同じ selector (${selectors[i]}) を指している`,
			).toBe(false);
		}
	});

	it('[A2] おやカギ変更の手順が実フォームの 3 入力欄すべてに触れている', () => {
		const how = STEPS['settings-account-pin'].how;
		for (const label of [
			OYAKAGI_LABELS.currentInputLabel,
			OYAKAGI_LABELS.newInputLabel,
			OYAKAGI_LABELS.confirmInputLabel,
		]) {
			expect(how, `手順に入力欄「${label}」が出てこない`).toContain(label);
		}
	});

	it('[A3] 手順のボタン名が画面表記 (OYAKAGI_LABELS.changeAction) と一致する', () => {
		expect(STEPS['settings-account-pin'].how).toContain(OYAKAGI_LABELS.changeAction);
	});

	it('[A4] ログアウト / アカウント削除の step が画面のボタン名・見出しを引用している', () => {
		expect(STEPS['settings-account-logout'].how).toContain(SETTINGS_LABELS.logoutAction);
		expect(STEPS['settings-account-delete'].how).toContain(
			SETTINGS_LABELS.accountDeleteExportAction,
		);
	});

	// cognito 環境でしか描画されないカードを指す step は、静的軸 (requiredRuntime) と
	// 起動時 DOM 判定 (optional) の**両方**が要る。片方だけだと SaaS の demo / local で
	// 中央 fallback (0×0 spotlight) の step が出てしまう。
	it('[A5] 条件付きカードを指す step は requiredRuntime="saas" かつ optional', () => {
		for (const id of ['settings-account-logout', 'settings-account-delete']) {
			const step = SETTINGS_ACCOUNT_GUIDE.steps.find((s) => s.id === id);
			expect(step, `${id} が存在しない`).toBeDefined();
			expect(step?.requiredRuntime, `${id} の requiredRuntime`).toBe('saas');
			expect(step?.optional, `${id} の optional`).toBe(true);
		}
	});

	it('[A6] 常設カードを指す step には optional を付けない (anchor 退行を隠さない)', () => {
		const pin = SETTINGS_ACCOUNT_GUIDE.steps.find((s) => s.id === 'settings-account-pin');
		expect(pin?.optional ?? false).toBe(false);
	});

	it('[A7] ガイドが指す anchor がページに実在する', () => {
		const source = fs.readFileSync(ACCOUNT_PAGE, 'utf8');
		for (const step of SETTINGS_ACCOUNT_GUIDE.steps) {
			if (!step.selector) continue;
			const anchor = step.selector.match(/data-tutorial="([a-z0-9-]+)"/)?.[1];
			expect(anchor, `${step.id} の selector が data-tutorial 形式でない`).toBeDefined();
			expect(source, `${step.id} の anchor "${anchor}" がページに無い`).toContain(
				`data-tutorial="${anchor}"`,
			);
		}
	});

	// 猶予日数はプランごとに違い、`accountDeleteGraceNotice` が画面で述べる値と同じ SSOT
	// (DELETION_GRACE_TERMS) から出ていなければ、ガイドと画面が別の日数を言い出す。
	it('[A8] アカウント削除 step が 3 プランすべての猶予に触れている', () => {
		const goal = STEPS['settings-account-delete'].goal;
		for (const days of ['即時', '7日', '30日']) {
			expect(goal, `猶予 "${days}" がガイドに出てこない`).toContain(days);
		}
	});
});
