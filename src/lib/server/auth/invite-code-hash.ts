// src/lib/server/auth/invite-code-hash.ts
// EPIC #3424 / PR-R2 / 設計 SSOT: dsql-data-model.md §6.6 invites.token_hash
//
// 招待コード hash の SSOT。DSQL invites 表は raw 招待コードを保存せず、
// sha256(raw) の hex のみを token_hash に保存する (CWE-522: bare bearer token の
// DB 平文保存による機密性退行を防ぐ。DB dump が漏れても招待リンクとして使えない)。
//
// - lookup は WHERE token_hash = hashInviteCode(raw) の等値照合。ユーザ入力と
//   秘密の直接比較を行わないため、B-tree 照合の timing で raw が漏れる面は
//   hash の前像困難性で遮断される (現行 DynamoDB inviteCode capability 機構の写像)。
// - salt / pepper は不採用: 招待コードは inv-<uuid v4> で 122bit エントロピーがあり
//   総当たり・レインボー表が成立しない (パスワード hash とは脅威モデルが異なる)。
//   決定的 hash でないと WHERE 等値 lookup ができない。

import { createHash } from 'node:crypto';

/** 招待コード raw → invites.token_hash 保存値 (sha256 hex、決定的)。 */
export function hashInviteCode(code: string): string {
	return createHash('sha256').update(code).digest('hex');
}
