// tests/unit/auth/invite-code-not-logged.test.ts
//
// **招待コードをログに出さない**ことを固定する (#4867 adversarial の「同 class」指摘)。
//
// なぜ PIN と同じ重さか:
//   - 招待コードは**家族テナントへ参加できる capability そのもの**
//   - とくに **受諾失敗の経路では未消費 = まだ生きている**。失敗ログに出た瞬間、
//     そのコードは「拾った人が他人の家族に参加できる」材料になる
//   - 本番の logger は CloudWatch へ出るため、ログ閲覧権限がそのまま参加権限に化ける
//
// **この test は source を読む**。呼び出し側 (cognito provider) は Cognito / cookie /
// membership の依存が重く、「ログに出ないこと」を確かめる目的に対して mock の量が
// 釣り合わないため。見ているのは `context: { … }` の中身だけで、
// **変数に組んでから渡す / 別名で渡す形は見えない** — その限界を明記しておく。
// (mock を置いた file の中では同じ検査が mutation を取り逃したため、mock を持たない
//  独立した file に分けてある。分けた状態で mutation が効くことは確認済み)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const COGNITO_PROVIDER = 'src/lib/server/auth/providers/cognito.ts';

describe('招待コードが logger の context に載っていない', () => {
	it(`${COGNITO_PROVIDER}`, () => {
		const src = readFileSync(join(__dirname, '../../..', COGNITO_PROVIDER), 'utf8');
		const leaked = src.match(/context:\s*\{[^}]*\binviteCode\b/);
		expect(
			leaked?.[0] ?? null,
			'logger の context に inviteCode を渡している。受諾失敗の経路では未消費なので、' +
				'ログを読めた人が他人の家族に参加できる',
		).toBeNull();
	});

	it('招待コードを直接 logger へ渡していない (context 以外の形も見る)', () => {
		const src = readFileSync(join(__dirname, '../../..', COGNITO_PROVIDER), 'utf8');
		// `logger.xxx(` から 400 文字を見て、その中に inviteCode が現れないこと。
		// 呼び出しの終端を正しく取る実装は境界を間違えやすいので、**広めに見て**誤検出側に倒す。
		for (const m of src.matchAll(/logger\.(?:info|warn|error|debug)\(/g)) {
			const window = src.slice(m.index ?? 0, (m.index ?? 0) + 400);
			expect(
				/\binviteCode\b/.test(window),
				`logger 呼び出しの近くに inviteCode がある:\n${window.slice(0, 200)}`,
			).toBe(false);
		}
	});
});
