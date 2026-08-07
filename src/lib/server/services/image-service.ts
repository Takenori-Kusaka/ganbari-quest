import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/image-service.ts
// 画像の**参照系**サービス。
//
// #4397: アバター / favicon の AI 生成 (Gemini 呼び出し) はここから撤去した。
// 子供のニックネームと年齢を運営者の環境の外にある生成 AI へ送る配線であり、
// site/privacy.html 第 3 条 / 第 10 条の開示と食い違っていたため機能ごと廃止した。
// アバターの設定手段は写真アップロード (POST /api/v1/children/[id]/avatar) のみ。
//
// 既存顧客のアバター (アップロード画像 / 過去に保存されたフォールバック SVG) は
// children.avatar_url 経由でそのまま表示され続ける。

import { findChildForImage } from '$lib/server/db/image-repo';
import { fileExists } from '$lib/server/storage';

/** 子供の現在のアバターURLを取得（未設定ならnull） */
export async function getAvatarUrl(childId: ChildId, tenantId: string): Promise<string | null> {
	const child = await findChildForImage(childId, tenantId);
	return child?.avatarUrl ?? null;
}

/** favicon の現在パスを取得 */
export async function getFaviconPath(_tenantId: string): Promise<string> {
	if (await fileExists('generated/favicon.png')) return '/generated/favicon.png';
	if (await fileExists('icon-character.png')) return '/icon-character.png';
	return '';
}
