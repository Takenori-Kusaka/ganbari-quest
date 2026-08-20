// tests/unit/scripts/graphify-hook-appendix.test.ts
// #4638 ①: `graphify hook install` の自己追記を捨てる helper の単体テスト。
//
// この helper が壊れると、`npm ci` のたびに `.husky/post-commit` が汚れ、`git add -A` で
// 開発者マシンの絶対パスが PR に混入する (PR #4635 が実際に main を汚した経路)。

import { describe, expect, it } from 'vitest';
// @ts-expect-error -- .mjs helper (型定義は無い)
import {
	GRAPHIFY_APPENDIX_MARKER,
	stripGraphifyHookAppendix,
} from '../../../scripts/lib/graphify-hook-appendix.mjs';

const CLEAN_HOOK = [
	'#!/usr/bin/env sh',
	'',
	'_GFY_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)',
	'case "$_GFY_BRANCH" in',
	'    develop|main) ;;',
	'    *) exit 0 ;;',
	'esac',
	'',
].join('\n');

const APPENDIX = [
	GRAPHIFY_APPENDIX_MARKER,
	'# Installed by: graphify hook install',
	String.raw`_PINNED='C:\Users\someone\AppData\Roaming\uv\tools\graphify\Scripts\python.exe'`,
	'',
].join('\n');

describe('#4638 stripGraphifyHookAppendix', () => {
	it('追記ブロックを取り除き、開発者マシンの絶対パスを残さない', () => {
		const stripped = stripGraphifyHookAppendix(`${CLEAN_HOOK}\n${APPENDIX}`);

		expect(stripped).not.toBeNull();
		expect(stripped).not.toContain(GRAPHIFY_APPENDIX_MARKER);
		expect(stripped).not.toContain('_PINNED');
		expect(stripped).not.toContain(String.raw`C:\Users`);
		// 追記の手前 (hook 本体) は 1 文字も変えない
		expect(stripped).toBe(`${CLEAN_HOOK.replace(/\n+$/, '')}\n`);
	});

	it('追記が無いファイルには触らない (no-op で null を返す)', () => {
		expect(stripGraphifyHookAppendix(CLEAN_HOOK)).toBeNull();
	});

	it('追記ブロック以外の開発者の編集は巻き添えで捨てない', () => {
		const edited = `${CLEAN_HOOK}echo "developer's own line"\n`;
		const stripped = stripGraphifyHookAppendix(`${edited}\n${APPENDIX}`);

		expect(stripped).toContain(`echo "developer's own line"`);
		expect(stripped).not.toContain('_PINNED');
	});
});
