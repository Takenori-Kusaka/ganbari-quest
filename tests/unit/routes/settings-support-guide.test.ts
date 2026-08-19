// tests/unit/routes/settings-support-guide.test.ts
// #4667 (EPIC #4650): サポート画面のガイドが「このページで最も多い問い」に答えていなかった
// class を機械 gate 化する。
//
// 観測された実害:
//   - step 2 の how が「内容を入力 → 送信」の 2 手順だけで、フォーム先頭の「ご用件」ラジオ
//     （感想・要望 / 相談・困りごと）に一言も触れていなかった
//   - そのため「解約や使い方の相談はどこから？」「送ったら返事は来る？」に答えられず、
//     相談したい保護者が「感想・要望（返信は不要）」のまま送ってしまう
//   - 相談時にだけ返信先メールが必要になる分岐も未説明
//   - NUC でだけ出る「バックアップの状態」カードと、末尾の「アプリ情報」に step が無かった
//   - フォームの呼称が「お問い合わせのフォーム」で、画面見出し「サポート・ご意見」と違った

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAGE_GUIDE_LABELS, SETTINGS_LABELS } from '$lib/domain/labels';
import { SETTINGS_SUPPORT_GUIDE } from '../../../src/routes/(parent)/admin/settings/support/_guide';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PAGE = path.join(REPO_ROOT, 'src/routes/(parent)/admin/settings/support/+page.svelte');
const BACKUP_CARD = path.join(
	REPO_ROOT,
	'src/lib/features/admin/components/BackupHealthCard.svelte',
);

const STEPS = PAGE_GUIDE_LABELS.adminSettingsSupport.steps;
type GuideStepText = {
	title: string;
	what: string;
	how: string;
	goal: string;
	tips?: readonly string[];
};
const textOf = (id: keyof typeof STEPS): string => {
	const s = STEPS[id] as GuideStepText;
	return [s.title, s.what, s.how, s.goal, ...(s.tips ?? [])].join('\n');
};
const ALL_TEXT = (Object.keys(STEPS) as (keyof typeof STEPS)[]).map(textOf).join('\n');

describe('#4667 サポート画面のガイドがフォームの分岐と返信を説明する', () => {
	// 今回の中心。ご用件 2 択に触れない step を通さない。
	it('[U1] フォーム step が「ご用件」2 択を画面と同じ語で挙げている', () => {
		const text = textOf('settings-support-form');
		expect(text).toContain(SETTINGS_LABELS.feedbackIntentLabel);
		expect(text).toContain(SETTINGS_LABELS.feedbackIntentFeedback);
		expect(text).toContain(SETTINGS_LABELS.feedbackIntentConsult);
	});

	it('[U2] 相談時の返信先メールと返信目安を説明している', () => {
		const text = textOf('settings-support-form');
		expect(text).toContain(SETTINGS_LABELS.feedbackReplyEmailLabel);
		expect(text, '返信の目安（1〜2 日）に触れていない').toMatch(/1〜2\s*日/);
	});

	it('[U3] 送信ボタン名と送信後の結果（受付番号）を述べている', () => {
		const step = STEPS['settings-support-form'] as GuideStepText;
		expect(step.how).toContain(SETTINGS_LABELS.feedbackSubmitButton);
		expect(step.goal, '受付番号に触れていない').toMatch(/受付番号/);
	});

	it('[U4] 感想・要望のときだけ出る「種類」3 択に触れている', () => {
		const how = STEPS['settings-support-form'].how;
		expect(how).toContain(SETTINGS_LABELS.feedbackCategoryLabel);
		for (const label of [
			SETTINGS_LABELS.feedbackCategoryFeature,
			SETTINGS_LABELS.feedbackCategoryBug,
		]) {
			expect(how, `種類「${label}」がガイドに出てこない`).toContain(label);
		}
	});

	it('[U5] NUC のバックアップ状態 step があり、4 表示と相談導線を説明している', () => {
		const step = SETTINGS_SUPPORT_GUIDE.steps.find((s) => s.id === 'settings-support-backup');
		expect(step, 'バックアップ状態 step が無い').toBeDefined();
		// NUC 限定描画 = 静的軸 + 起動時 DOM 判定の 2 軸
		expect(step?.requiredRuntime).toBe('nuc');
		expect(step?.optional).toBe(true);
		const text = textOf('settings-support-backup');
		expect(text, '昇格時の見出しに触れていない').toContain(
			SETTINGS_LABELS.backupRotationBlockedCriticalTitle,
		);
		expect(text, 'うまくいかないときの相談導線が無い').toMatch(/フォーム/);
	});

	it('[U6] アプリ情報 step があり、バージョン確認に触れている', () => {
		expect(
			SETTINGS_SUPPORT_GUIDE.steps.some((s) => s.id === 'settings-support-appinfo'),
			'アプリ情報 step が無い',
		).toBe(true);
		expect(textOf('settings-support-appinfo')).toMatch(/バージョン/);
	});

	// #4667 F5: 「お問い合わせのフォーム」は画面のどこにも無い名前。
	it('[U7] フォームの呼称が画面見出し「サポート・ご意見」に揃っている', () => {
		expect(ALL_TEXT, '画面に無い呼称が残っている').not.toContain('お問い合わせのフォーム');
		// 絵文字を除いた見出し語がガイドに出ること
		expect(ALL_TEXT).toContain(SETTINGS_LABELS.feedbackSectionTitle.replace(/^[^\p{L}]+/u, ''));
	});

	// #4667 F6: 実 DOM ではフォームがバックアップカードより上にある。
	it('[U8] バックアップの案内が実 DOM の方向（上のフォーム）を指している', () => {
		expect(SETTINGS_LABELS.backupActionHint).toContain('上のフォーム');
		const page = fs.readFileSync(PAGE, 'utf8');
		const formAt = page.indexOf('data-tutorial="feedback-section"');
		const backupAt = page.indexOf('<BackupHealthCard');
		expect(formAt).toBeGreaterThanOrEqual(0);
		expect(backupAt).toBeGreaterThanOrEqual(0);
		expect(formAt, 'フォームがバックアップカードより下にある（案内の方向と矛盾）').toBeLessThan(
			backupAt,
		);
	});

	it('[U9] ガイドが指す anchor が実在し、常設 step に optional が付いていない', () => {
		const sources = `${fs.readFileSync(PAGE, 'utf8')}\n${fs.readFileSync(BACKUP_CARD, 'utf8')}`;
		for (const step of SETTINGS_SUPPORT_GUIDE.steps) {
			if (!step.selector) continue;
			const anchor = step.selector.match(/data-tutorial="([a-z0-9-]+)"/)?.[1];
			expect(anchor, `${step.id} の selector が data-tutorial 形式でない`).toBeDefined();
			expect(sources, `${step.id} の anchor "${anchor}" がどこにも無い`).toContain(
				`data-tutorial="${anchor}"`,
			);
			if (step.id !== 'settings-support-backup') {
				expect(step.optional ?? false, `${step.id} に optional が付いている`).toBe(false);
			}
		}
	});
});
