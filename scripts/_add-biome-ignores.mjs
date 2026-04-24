#!/usr/bin/env node
// Temporary helper script for #1432: add biome-ignore comments from warning list
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REASONS = {
	'style/noNonNullAssertion': '非null保証済み、#1432 Phase B でリファクタ予定',
	'complexity/noExcessiveCognitiveComplexity': '既存の複雑さ、#1432 Phase B でリファクタ予定',
	'performance/noBarrelFile': '既存バレルファイル、削除は #1432 Phase B で実施',
	'complexity/useMaxParams': '引数は設計上必要、#1432 Phase B でリファクタ検討',
};

const warningsText = readFileSync(
	`${process.env.USERPROFILE || process.env.HOME}/biome-warnings.txt`,
	'utf8',
);
const warnings = warningsText
	.trim()
	.split('\n')
	.map((line) => {
		const m = line.match(/^(.+?):(\d+):\d+ (lint\/.+)$/);
		if (!m) return null;
		const filePath = m[1].replace(/\\/g, '/');
		return { file: filePath, line: Number.parseInt(m[2], 10), rule: m[3] };
	})
	.filter(Boolean);

const byFile = {};
for (const w of warnings) {
	if (!byFile[w.file]) byFile[w.file] = [];
	byFile[w.file].push(w);
}

let modified = 0;
for (const [filePath, ws] of Object.entries(byFile)) {
	const absPath = resolve(filePath);
	if (!existsSync(absPath)) {
		console.error('NOT FOUND:', absPath);
		continue;
	}
	const content = readFileSync(absPath, 'utf8');
	const lines = content.split('\n');
	ws.sort((a, b) => b.line - a.line);
	for (const w of ws) {
		const lineIdx = w.line - 1;
		const reason = REASONS[w.rule] || '既存コード、別Issueで対応予定';
		const prevLine = lines[lineIdx - 1];
		if (prevLine?.includes(`biome-ignore ${w.rule}`)) continue;
		const targetLine = lines[lineIdx] || '';
		const indent = targetLine.match(/^(\s*)/)[1];
		const comment = `${indent}// biome-ignore ${w.rule}: ${reason}`;
		lines.splice(lineIdx, 0, comment);
	}
	writeFileSync(absPath, lines.join('\n'));
	modified++;
}
console.log(`Modified ${modified} files`);
