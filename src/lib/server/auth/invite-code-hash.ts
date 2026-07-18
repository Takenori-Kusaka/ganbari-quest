// src/lib/server/auth/invite-code-hash.ts
// EPIC #3424 / PR-R2 / 設計 SSOT: dsql-data-model.md §6.6 invites.token_hash
//
// 招待秘密 (raw 招待コード / DSQL-native token) の hash SSOT。DSQL invites 表は raw を
// 保存せず、sha256(raw) の hex のみを token_hash に保存する (CWE-522: bare bearer token の
// DB 平文保存による機密性退行を防ぐ。DB dump が漏れても招待リンクとして使えない)。
//
// - lookup は WHERE token_hash = hashInviteSecret(raw) の等値照合。ユーザ入力と
//   秘密の直接比較を行わないため、B-tree 照合の timing で raw が漏れる面は
//   hash の前像困難性で遮断される (現行 DynamoDB inviteCode capability 機構の写像)。
// - salt / pepper は不採用: 招待コードは inv-<uuid v4> で 122bit エントロピーがあり
//   総当たり・レインボー表が成立しない (パスワード hash とは脅威モデルが異なる)。
//   決定的 hash でないと WHERE 等値 lookup ができない。
//
// #3588 ①: 本ファイルが招待秘密 hash の唯一の SSOT。`invite-token.ts` の hashInviteToken /
// verifyInviteTokenHash も本 hashInviteSecret に委譲する。現行 inviteCode 写像 (hashInviteCode) と
// DSQL-native token (hashInviteToken) は用途表記が異なるだけで同一写像 (sha256 hex) であり、
// 二重定義すると将来のアルゴリズム変更時に片側更新漏れで invite lookup 不整合を招くため統合する。

import { createHash } from 'node:crypto';

/** 招待秘密 raw → invites.token_hash 保存値 (sha256 hex、決定的)。招待秘密 hash の唯一 SSOT (#3588 ①)。 */
export function hashInviteSecret(secret: string): string {
	return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * 招待コード raw → token_hash。`hashInviteSecret` の別名 (現行 inviteCode 写像の呼称)。
 * DSQL auth-repo の lookup 鍵算出に使う。
 */
export function hashInviteCode(code: string): string {
	return hashInviteSecret(code);
}
