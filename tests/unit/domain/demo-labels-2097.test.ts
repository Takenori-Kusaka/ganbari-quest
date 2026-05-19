/**
 * tests/unit/domain/demo-labels-2097.test.ts (#2097 Phase B, PO 報告 2026-05-17 / #2261 PO 報告 2026-05-19)
 *
 * `DEMO_LABELS` (DemoBanner SSOT) の 3 値が PO 修正指示に沿っていることを構造的に
 * 保証する回帰防止テスト。
 *
 * 設計背景:
 *   2026-05-17 12:00 JST、demo.ganbari-quest.com 実機検証で以下の 3 defect が確認された:
 *     Bug 1: ctaStart が「ほんとうに始める」(hiragana) — DemoBanner は大人 (保護者) 向けなので
 *            漢字「本当に始める」が適切
 *     Bug 2: signupHref = '/auth/signup' (relative) — demo Lambda 上で叩くと Cognito 未注入の
 *            signup 画面 (失敗確定) が表示される。本番 (ganbari-quest.com) への absolute URL に
 *            固定する
 *     Bug 3: exitHref = '/demo/exit' (relative) — demo Lambda には /demo/exit route が無いため
 *            404。LP に戻す = https://ganbari-quest.com/ に変更
 *
 *   2026-05-19 (#2261 PO 報告): exitHref / signupHref が apex (ganbari-quest.com) を指していたが、
 *     LP canonical は www.ganbari-quest.com のため 301 リダイレクトが挟まり UX 劣化。
 *     www. canonical に統一。
 *
 * AC マッピング (Issue #2097 Phase B + #2261 follow-up):
 *   - AC1: ctaStart = '本当に始める' (漢字)
 *   - AC2: signupHref = 'https://www.ganbari-quest.com/auth/signup' (absolute, www canonical)
 *   - AC3: exitHref = 'https://www.ganbari-quest.com/' (absolute, www canonical)
 *   - AC4: 他フィールド (bannerTitle / bannerDescription / ctaExit) は変更されていない
 */

import { describe, expect, it } from 'vitest';
import { DEMO_LABELS } from '../../../src/lib/domain/labels';

describe('DEMO_LABELS (#2097 Phase B: DemoBanner CTA / href SSOT)', () => {
	it('AC1: ctaStart は漢字「本当に始める」(大人向けバナーなので hiragana NG)', () => {
		expect(DEMO_LABELS.ctaStart).toBe('本当に始める');
		// ひらがな regression を構造的に検出
		expect(DEMO_LABELS.ctaStart).not.toContain('ほんとうに');
	});

	it('AC2: signupHref は www canonical absolute URL (apex 経由 301 リダイレクトを防ぐ、#2261)', () => {
		expect(DEMO_LABELS.signupHref).toBe('https://www.ganbari-quest.com/auth/signup');
		// relative path regression を検出
		expect(DEMO_LABELS.signupHref.startsWith('http')).toBe(true);
		// apex (no www.) regression を構造的に検出 (#2261)
		expect(DEMO_LABELS.signupHref).toMatch(/^https:\/\/www\./);
	});

	it('AC3: exitHref は www canonical LP absolute URL (apex 経由 301 リダイレクト + /demo/exit 404 を防ぐ、#2261)', () => {
		expect(DEMO_LABELS.exitHref).toBe('https://www.ganbari-quest.com/');
		expect(DEMO_LABELS.exitHref.startsWith('http')).toBe(true);
		// /demo/exit regression を構造的に検出
		expect(DEMO_LABELS.exitHref).not.toContain('/demo/exit');
		// apex (no www.) regression を構造的に検出 (#2261)
		expect(DEMO_LABELS.exitHref).toMatch(/^https:\/\/www\./);
	});

	it('AC4: 他フィールド (bannerTitle / bannerDescription / ctaExit) は子供にも読める hiragana 維持', () => {
		// バナー本体テキストはひらがな (子供視点で読めることを優先)
		expect(DEMO_LABELS.bannerTitle).toBe('おためしモード');
		expect(DEMO_LABELS.bannerDescription).toBe(
			'これはおためしです。記録やせっていはほぞんされません。',
		);
		// 退出ボタンも hiragana 維持 (CTA でない / 終了動作の優しい表現)
		expect(DEMO_LABELS.ctaExit).toBe('おためしをやめる');
	});
});
