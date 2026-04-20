#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/lib/data/marketplace/activity-packs';
const CATEGORIES = ['seikatsu', 'undou', 'benkyou', 'souzou', 'kouryuu'];

let fail = 0;
for (const file of readdirSync(DIR).sort()) {
	if (!file.endsWith('.json')) continue;
	const data = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
	const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
	for (const a of data.payload.activities) {
		counts[a.categoryCode] = (counts[a.categoryCode] ?? 0) + 1;
	}
	const total = data.payload.activities.length;
	const badCats = CATEGORIES.filter((c) => counts[c] < 5);
	const flag = badCats.length === 0 ? 'OK  ' : 'FAIL';
	if (badCats.length) fail++;
	console.log(
		`${flag} ${file.padEnd(30)} total=${String(total).padStart(3)} | ` +
			CATEGORIES.map((c) => `${c}=${counts[c]}`).join(' ') +
			(badCats.length ? `  <<< ${badCats.join(',')} < 5` : ''),
	);
}
process.exit(fail ? 1 : 0);
