// tests/unit/services/email-html-escaping.test.ts (#4566)
//
// 送信 HTML メールにユーザー入力が無エスケープで埋まらないことを固定する。
//
// # 何を守るか
// テナント名 / 表示名は顧客が自由入力する値で、`<a href="...">` を注入すると
// **がんばりクエスト名義のメール本文に任意リンクを差し込める**。受信者には
// 「除外されたメンバー」= もはや信頼関係にない相手が含まれるため、cross-user の
// フィッシング経路になる (第 21 回統合監査 セキュリティ領域で検出)。
//
// # 3 層で見る
//   1. `escapeHtml` / `html` タグ単体の振る舞い
//   2. 実送信経路の pin (注入文字列を入れて SES に渡る HTML を検査する)
//   3. class lock (fitness function) — 本文組み立てに素の template literal が現れたら fail
//      instance 修正の繰り返しをやめて class を閉じる (ADR-0061 原則 2)。既に 2 instance 目
//      (既存 sendMemberRemovedEmail + #4507 が追加した 3 通) であり、次に同じ形が書かれても
//      **型検査 (HtmlSafe) と本 test の両方**が落ちる

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sesCommands: Array<{ type: 'simple' | 'raw'; params: Record<string, unknown> }> = [];

vi.mock('@aws-sdk/client-ses', () => ({
	SESClient: class {
		send = vi.fn().mockResolvedValue({});
	},
	SendEmailCommand: class {
		constructor(params: Record<string, unknown>) {
			sesCommands.push({ type: 'simple', params });
		}
	},
	SendRawEmailCommand: class {
		constructor(params: Record<string, unknown>) {
			sesCommands.push({ type: 'raw', params });
		}
	},
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		SES_SENDER_EMAIL: 'noreply@ganbari-quest.com',
		APP_BASE_URL: 'https://ganbari-quest.com',
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('$lib/runtime/env', () => ({
	getEnv: () => ({ OPS_SECRET_KEY: 'test-fixed-secret', AUTH_MODE: 'cognito' }),
	env: { OPS_SECRET_KEY: 'test-fixed-secret', AUTH_MODE: 'cognito' },
}));

import { escapeHtml, html, joinHtml } from '$lib/server/services/email-html';
import {
	sendMemberJoinedEmail,
	sendMemberRemovedEmail,
	sendWeeklyReportEmail,
	sendWelcomeEmail,
} from '$lib/server/services/email-service';

/** 注入を試みる文字列。リンク・script・属性抜けの 3 系統を 1 本に混ぜてある。 */
const INJECTION = `<a href="https://evil.example/steal">今すぐ確認</a><script>alert(1)</script>" onmouseover="x`;

/** 直前に送られた 1 通の HTML 本文を取り出す。 */
function takeSentHtml(): string {
	expect(sesCommands).toHaveLength(1);
	const sent = sesCommands[0];
	if (!sent) throw new Error('メールが 1 通も送られていません');
	if (sent.type === 'simple') {
		const message = sent.params.Message as { Body: { Html?: { Data: string } } };
		return message.Body.Html?.Data ?? '';
	}
	const raw = Buffer.from((sent.params.RawMessage as { Data: Uint8Array }).Data).toString('utf-8');
	const marker = 'Content-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64';
	const start = raw.indexOf(marker);
	if (start === -1) return '';
	const bodyStart = raw.indexOf('\r\n\r\n', start) + 4;
	const bodyEnd = raw.indexOf('\r\n--', bodyStart);
	return Buffer.from(raw.slice(bodyStart, bodyEnd), 'base64').toString('utf-8');
}

beforeEach(() => {
	sesCommands.length = 0;
	// sendEmail は process.env.AUTH_MODE を直接見る。local だと SES に出さず tmp/ へ書くだけ
	// なので、実送信経路 (SES に渡る HTML) を検査するために cognito にする。
	process.env.AUTH_MODE = 'cognito';
});

describe('escapeHtml / html タグ', () => {
	it('HTML 特殊文字 5 種をエスケープする', () => {
		expect(escapeHtml(`<&>"'`).raw).toBe('&lt;&amp;&gt;&quot;&#39;');
	});

	it('null / undefined は空文字にする (本文に "undefined" を出さない)', () => {
		expect(escapeHtml(null).raw).toBe('');
		expect(escapeHtml(undefined).raw).toBe('');
	});

	it('html タグは埋め込み値だけをエスケープし、テンプレート側のタグは保つ', () => {
		expect(html`<p>${'<b>x</b>'}</p>`.raw).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>');
	});

	it('HtmlSafe を埋め込んでも二重エスケープしない (断片の合成)', () => {
		const row = html`<td>${'a&b'}</td>`;
		expect(html`<tr>${row}</tr>`.raw).toBe('<tr><td>a&amp;b</td></tr>');
	});

	it('joinHtml は各要素の生 HTML を保ったまま連結する', () => {
		expect(joinHtml([html`<i>${'<x>'}</i>`, html`<i>b</i>`]).raw).toBe('<i>&lt;x&gt;</i><i>b</i>');
	});
});

describe('#4566 実送信経路 — ユーザー入力は生 HTML として出ない', () => {
	it('除外通知メール (cross-user 経路) のテナント名', async () => {
		await sendMemberRemovedEmail('member@example.com', INJECTION);
		const body = takeSentHtml();

		expect(body).not.toContain('<a href="https://evil.example/steal">');
		expect(body).not.toContain('<script>');
		expect(body).toContain('&lt;a href=&quot;https://evil.example/steal&quot;&gt;');
	});

	it('参加通知メールの表示名とロール', async () => {
		await sendMemberJoinedEmail('owner@example.com', INJECTION, INJECTION);
		const body = takeSentHtml();

		expect(body).not.toContain('<script>');
		expect(body).toContain('&lt;script&gt;');
	});

	it('ウェルカムメールの家族名', async () => {
		await sendWelcomeEmail('owner@example.com', INJECTION);
		const body = takeSentHtml();

		expect(body).not.toContain('<script>');
		expect(body).toContain('&lt;script&gt;');
	});

	it('週次レポートの子供名・カテゴリ名・実績名 (表の行組み立て経路)', async () => {
		await sendWeeklyReportEmail('owner@example.com', {
			childName: INJECTION,
			dateRange: '2026-08-01 〜 2026-08-07',
			categories: [{ name: INJECTION, count: 3, diff: 1 }],
			streak: 5,
			pointsEarned: 120,
			totalPoints: 900,
			newAchievements: [INJECTION],
		});
		const body = takeSentHtml();

		expect(body).not.toContain('<script>');
		expect(body).toContain('&lt;script&gt;');
		// 表の枠組み (テンプレート側の tag) は壊れていない
		expect(body).toContain('<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">');
	});
});

// ============================================================
// class lock (fitness function)
// ============================================================

const REPO_ROOT = resolve(__dirname, '../../..');

/** 本文組み立て関数 → それを持つ file。HTML メールを組み立てる経路はこの 2 file が全て。 */
const TEMPLATE_WRAPPERS: { file: string; wrappers: string[] }[] = [
	{
		file: 'src/lib/server/services/email-service.ts',
		wrappers: ['wrapTemplate', 'wrapLifecycleTemplate'],
	},
	{
		file: 'src/lib/server/services/trial-notification-service.ts',
		wrappers: ['wrapTrialEmailTemplate'],
	},
];

describe('#4566 class lock — 本文組み立てに素の string を渡せない', () => {
	it.each(
		TEMPLATE_WRAPPERS.flatMap(({ file, wrappers }) => wrappers.map((w) => [file, w] as const)),
	)('%s: %s は HtmlSafe しか受け取らない', (file, wrapper) => {
		const source = readFileSync(resolve(REPO_ROOT, file), 'utf8');
		expect(
			source,
			`${wrapper} の引数型が HtmlSafe でないと、素の string を本文に入れられてしまう`,
		).toMatch(new RegExp(`function ${wrapper}\\(content: HtmlSafe`));
	});

	it.each(
		TEMPLATE_WRAPPERS.flatMap(({ file, wrappers }) => wrappers.map((w) => [file, w] as const)),
	)('%s: %s の呼び出しに素の template literal が無い', (file, wrapper) => {
		const source = readFileSync(resolve(REPO_ROOT, file), 'utf8');
		const rawCalls = [...source.matchAll(new RegExp(`${wrapper}\\(\``, 'g'))];
		expect(
			rawCalls.length,
			`${wrapper}(\`...\`) は無エスケープ経路。html\`...\` に置き換えること (#4566)`,
		).toBe(0);
	});

	it('HtmlSafe の生成は email-html.ts の中だけで行われる (逃げ道を作らない)', () => {
		for (const { file } of TEMPLATE_WRAPPERS) {
			const source = readFileSync(resolve(REPO_ROOT, file), 'utf8');
			expect(source, `${file}: as HtmlSafe による cast は lock の迂回`).not.toMatch(
				/as HtmlSafe\b/,
			);
			expect(source, `${file}: new HtmlSafe() は lock の迂回`).not.toMatch(/new HtmlSafe\(/);
		}
	});

	it('検査対象の file が実在する (rename されたら空検査にならない)', () => {
		for (const { file, wrappers } of TEMPLATE_WRAPPERS) {
			const source = readFileSync(resolve(REPO_ROOT, file), 'utf8');
			for (const wrapper of wrappers) {
				expect(source, `${file} に ${wrapper} が無い`).toContain(`function ${wrapper}(`);
			}
		}
	});
});
