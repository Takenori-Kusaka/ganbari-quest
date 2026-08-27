// tests/unit/components/ai-input-notice-4599.test.ts
// #4599 (EPIC #4495 / 派生元 #4583): 生成 AI に送信される 4 経路すべてに入力時の注意書きが出る。
//
// ## なぜ 4 経路をまとめて pin するか
//
// プライバシーポリシー第9条④ (#4583 / PR #4598) は「AI 提案機能に入力した文章と、
// アップロードされた領収書画像は生成 AI に送信される」と述べた。実務上の注意が要るのは
// **入力する瞬間**であり、条文の段落末尾ではない。経路は 4 本 (AI 提案 3 種 + 領収書 OCR) あり、
// 1 本だけ注意書きが落ちると「その画面だけ気づけない」状態が静かに戻る。
//
// - render 検証 (AI 提案 3 種): 実際に notice が描画されることを component 層で確認する
// - source 検証 (4 経路): 領収書 OCR は `+page.svelte` で load データ依存のため render せず、
//   4 経路すべてが共有 component 経由であることを file 内容で確認する (1 経路欠けたら fail)
// - 文言検証: #4583 と矛盾する表現 (製品名直書き / 「送信しません」型の否定) が入ったら fail

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { AI_INPUT_NOTICE_LABELS } from '$lib/domain/labels';
import AiSuggestChecklistPanel from '$lib/features/admin/components/AiSuggestChecklistPanel.svelte';
import AiSuggestPanel from '$lib/features/admin/components/AiSuggestPanel.svelte';
import AiSuggestRewardPanel from '$lib/features/admin/components/AiSuggestRewardPanel.svelte';

/** vitest は repo root を cwd として起動する (`vite.config.ts` の root と一致)。 */
const repoRoot = process.cwd();

/** 生成 AI が送信先となる 4 経路。ここに 1 行足せば注意書きの実装も強制される。 */
const AI_INPUT_ROUTES = [
	{
		name: 'AI 提案 (活動)',
		file: 'src/lib/features/admin/components/AiSuggestPanel.svelte',
		testid: 'ai-input-notice-activity',
	},
	{
		name: 'AI 提案 (チェックリスト)',
		file: 'src/lib/features/admin/components/AiSuggestChecklistPanel.svelte',
		testid: 'ai-input-notice-checklist',
	},
	{
		name: 'AI 提案 (ごほうび)',
		file: 'src/lib/features/admin/components/AiSuggestRewardPanel.svelte',
		testid: 'ai-input-notice-reward',
	},
	{
		name: 'ポイント変換 (領収書 OCR)',
		file: 'src/routes/(parent)/admin/points/+page.svelte',
		testid: 'ai-input-notice-receipt',
	},
] as const;

/** #4583 / #4370 と同一規律: 生成 AI の製品名・モデル名は UI 文言に書かない。 */
const FORBIDDEN_PRODUCT_NAMES = [
	'Bedrock',
	'Gemini',
	'Claude',
	'GPT',
	'OpenAI',
	'Anthropic',
	'Vertex',
];

afterEach(() => cleanup());

describe('#4599 AI 送信の注意書き — 4 経路すべてに出る', () => {
	it.each(AI_INPUT_ROUTES)('$name が共有 component 経由で注意書きを出す', ({ file, testid }) => {
		const source = readFileSync(join(repoRoot, file), 'utf-8');
		expect(source).toContain('AiInputNotice');
		expect(source).toContain(testid);
	});

	it('AI 提案 (活動) が入力欄とともに注意書きを描画する', () => {
		render(AiSuggestPanel, { props: { onaccept: () => {}, isFamily: true } });
		expect(screen.getByTestId('ai-input-notice-activity').textContent).toContain(
			AI_INPUT_NOTICE_LABELS.text,
		);
	});

	it('AI 提案 (チェックリスト) が入力欄とともに注意書きを描画する', () => {
		render(AiSuggestChecklistPanel, { props: { onaccept: () => {}, isFamily: true } });
		expect(screen.getByTestId('ai-input-notice-checklist').textContent).toContain(
			AI_INPUT_NOTICE_LABELS.text,
		);
	});

	it('AI 提案 (ごほうび) が入力欄とともに注意書きを描画する', () => {
		render(AiSuggestRewardPanel, { props: { onaccept: () => {}, isFamily: true } });
		expect(screen.getByTestId('ai-input-notice-reward').textContent).toContain(
			AI_INPUT_NOTICE_LABELS.text,
		);
	});

	it('プラン未解放 (isFamily=false) でも注意書きは消えない', () => {
		render(AiSuggestPanel, { props: { onaccept: () => {}, isFamily: false } });
		expect(screen.getByTestId('ai-input-notice-activity')).toBeDefined();
	});
});

describe('#4599 文言 — #4583 (プライバシーポリシー第9条④) と食い違わない', () => {
	const texts = [AI_INPUT_NOTICE_LABELS.text, AI_INPUT_NOTICE_LABELS.image];

	it('送信される事実を述べている', () => {
		for (const t of texts) {
			expect(t).toContain('生成 AI');
			expect(t).toContain('送信されます');
		}
	});

	it('特定につながる情報を書かないよう促している', () => {
		for (const t of texts) {
			expect(t).toMatch(/お名前|特定につながる/);
		}
	});

	it('領収書経路は画像が送られることを述べている', () => {
		expect(AI_INPUT_NOTICE_LABELS.image).toContain('領収書画像');
	});

	it('生成 AI の製品名を書かない (#4370 / #4583 と同一規律)', () => {
		for (const t of [...texts, AI_INPUT_NOTICE_LABELS.linkLabel]) {
			for (const name of FORBIDDEN_PRODUCT_NAMES) {
				expect(t).not.toContain(name);
			}
		}
	});

	it('「送信しません」型の否定が入らない (条文と逆の事実を述べない)', () => {
		for (const t of texts) {
			expect(t).not.toMatch(/送信(は行いません|しません)/);
		}
	});

	it('送信先の詳細はプライバシーポリシー第9条④ にリンクする', () => {
		expect(AI_INPUT_NOTICE_LABELS.linkHref).toContain('privacy.html#under-age');
	});
});
