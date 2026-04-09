// Omikuji rank → stamp image mapping (#607)

/** Omikuji fortune ranks (from best to worst) */
export const OMIKUJI_RANKS = [
	'daidaikichi',
	'daikichi',
	'chukichi',
	'shokichi',
	'kichi',
	'suekichi',
] as const;

export type OmikujiRank = (typeof OMIKUJI_RANKS)[number];

/** Map rarity to possible omikuji ranks */
const RARITY_TO_OMIKUJI: Record<string, readonly OmikujiRank[]> = {
	UR: ['daidaikichi'],
	SR: ['daikichi'],
	R: ['chukichi', 'shokichi'],
	N: ['kichi', 'suekichi'],
};

/** Map omikuji rank to display label */
export const OMIKUJI_LABELS: Record<OmikujiRank, string> = {
	daidaikichi: '大大吉',
	daikichi: '大吉',
	chukichi: '中吉',
	shokichi: '小吉',
	kichi: '吉',
	suekichi: '末吉',
};

/** Get the stamp image path for an omikuji rank */
export function getStampImagePath(rank: string): string {
	return `/assets/stamps/${rank}.png`;
}

/** Pick a random omikuji rank based on stamp rarity */
export function pickOmikujiRank(rarity: string): OmikujiRank {
	const candidates = RARITY_TO_OMIKUJI[rarity] ?? RARITY_TO_OMIKUJI.N ?? ['kichi'];
	return candidates[Math.floor(Math.random() * candidates.length)] as OmikujiRank;
}
