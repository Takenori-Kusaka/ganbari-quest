// src/lib/server/services/image-service.ts
// Gemini API を使ったキャラクター画像生成サービス

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	findCachedImage,
	findChildForImage,
	insertCharacterImage,
	updateChildAvatarUrl,
} from '$lib/server/db/image-repo';
import { logger } from '$lib/server/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildAvatarPrompt, buildFaviconPrompt } from './image-prompt';

const GENERATED_DIR = join(process.cwd(), 'static', 'generated');
const FALLBACK_DIR = join(process.cwd(), 'static');

function ensureDir(dir: string) {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

function getGeminiClient(): GoogleGenerativeAI | null {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey || apiKey === 'your_gemini_api_key_here') {
		return null;
	}
	return new GoogleGenerativeAI(apiKey);
}

function hashPrompt(prompt: string): string {
	return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

/** Gemini API で画像を生成し、バイナリデータを返す */
async function generateImageWithGemini(prompt: string): Promise<Buffer | null> {
	const client = getGeminiClient();
	if (!client) return null;

	try {
		const model = client.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
		const response = await model.generateContent({
			contents: [{ role: 'user', parts: [{ text: prompt }] }],
			generationConfig: {
				responseModalities: ['TEXT', 'IMAGE'] as unknown as undefined,
			} as Record<string, unknown>,
		});

		const candidate = response.response.candidates?.[0];
		if (!candidate?.content?.parts) return null;

		for (const part of candidate.content.parts) {
			const inlineData = (part as { inlineData?: { mimeType: string; data: string } }).inlineData;
			if (inlineData?.data) {
				return Buffer.from(inlineData.data, 'base64');
			}
		}
		return null;
	} catch (err) {
		logger.error('[image-service] Gemini API error', {
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined,
		});
		return null;
	}
}

/** フォールバック SVG アバターを生成 */
function generateFallbackAvatar(nickname: string, theme: string): Buffer {
	const colors: Record<string, { bg: string; fg: string }> = {
		pink: { bg: '#fce4ec', fg: '#e91e63' },
		blue: { bg: '#e3f2fd', fg: '#1976d2' },
		green: { bg: '#e8f5e9', fg: '#388e3c' },
		purple: { bg: '#f3e5f5', fg: '#7b1fa2' },
		orange: { bg: '#fff3e0', fg: '#f57c00' },
	};
	const { bg, fg } = colors[theme] ?? colors.pink!;
	const initial = nickname.charAt(0);

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <circle cx="128" cy="128" r="128" fill="${bg}"/>
  <circle cx="128" cy="100" r="50" fill="${fg}" opacity="0.2"/>
  <text x="128" y="140" font-size="80" font-family="sans-serif" font-weight="bold" fill="${fg}" text-anchor="middle" dominant-baseline="central">${initial}</text>
  <circle cx="128" cy="128" r="124" fill="none" stroke="${fg}" stroke-width="4" opacity="0.3"/>
</svg>`;

	return Buffer.from(svg, 'utf-8');
}

/** フォールバック favicon SVG */
function generateFallbackFavicon(): Buffer {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="48" fill="#4A90D9"/>
  <polygon points="128,30 158,100 235,108 178,162 193,238 128,200 63,238 78,162 21,108 98,100" fill="#FFD700" stroke="#FFA000" stroke-width="3"/>
  <circle cx="108" cy="118" r="8" fill="#5D4037"/>
  <circle cx="148" cy="118" r="8" fill="#5D4037"/>
  <path d="M110,145 Q128,165 146,145" fill="none" stroke="#5D4037" stroke-width="4" stroke-linecap="round"/>
</svg>`;

	return Buffer.from(svg, 'utf-8');
}

export interface GenerateAvatarResult {
	filePath: string;
	isGenerated: boolean;
}

/** 子供のアバター画像を生成（またはキャッシュから取得） */
export async function generateAvatar(
	childId: number,
	statusInfo: {
		characterType: string;
		level: number;
	},
): Promise<GenerateAvatarResult | { error: string }> {
	const child = await findChildForImage(childId);
	if (!child) return { error: 'NOT_FOUND' };

	ensureDir(GENERATED_DIR);

	const prompt = buildAvatarPrompt({
		nickname: child.nickname,
		age: child.age,
		theme: child.theme,
		characterType: statusInfo.characterType,
		level: statusInfo.level,
	});
	const promptHash = hashPrompt(prompt);

	// Check cache
	const cached = await findCachedImage(childId, 'avatar', promptHash);

	if (cached && existsSync(join(process.cwd(), 'static', cached.filePath))) {
		return { filePath: `/${cached.filePath}`, isGenerated: true };
	}

	// Generate image
	const imageData = await generateImageWithGemini(prompt);
	const fileName = `avatar-${childId}-${promptHash}`;
	let filePath: string;
	let isGenerated: boolean;

	if (imageData) {
		filePath = `generated/${fileName}.png`;
		writeFileSync(join(GENERATED_DIR, `${fileName}.png`), imageData);
		isGenerated = true;
	} else {
		// Fallback SVG
		filePath = `generated/${fileName}.svg`;
		const fallback = generateFallbackAvatar(child.nickname, child.theme);
		writeFileSync(join(GENERATED_DIR, `${fileName}.svg`), fallback);
		isGenerated = false;
	}

	// Save to DB
	await insertCharacterImage({ childId, type: 'avatar', filePath, promptHash });

	// Update child avatarUrl
	await updateChildAvatarUrl(childId, `/${filePath}`);

	return { filePath: `/${filePath}`, isGenerated };
}

/** 子供の現在のアバターURLを取得（未生成ならnull） */
export async function getAvatarUrl(childId: number): Promise<string | null> {
	const child = await findChildForImage(childId);
	return child?.avatarUrl ?? null;
}

/** favicon を生成（またはキャッシュから取得） */
export async function generateFavicon(): Promise<{
	filePath: string;
	isGenerated: boolean;
}> {
	ensureDir(GENERATED_DIR);

	const faviconPng = join(GENERATED_DIR, 'favicon.png');
	const faviconSvg = join(FALLBACK_DIR, 'favicon.svg');

	// Check if already generated
	if (existsSync(faviconPng)) {
		return { filePath: '/generated/favicon.png', isGenerated: true };
	}
	if (existsSync(faviconSvg)) {
		return { filePath: '/favicon.svg', isGenerated: false };
	}

	const prompt = buildFaviconPrompt();
	const imageData = await generateImageWithGemini(prompt);

	if (imageData) {
		writeFileSync(faviconPng, imageData);
		return { filePath: '/generated/favicon.png', isGenerated: true };
	}

	// Fallback SVG
	const fallback = generateFallbackFavicon();
	writeFileSync(faviconSvg, fallback);
	return { filePath: '/favicon.svg', isGenerated: false };
}

/** favicon の現在パスを取得 */
export function getFaviconPath(): string {
	const faviconPng = join(GENERATED_DIR, 'favicon.png');
	const faviconSvg = join(FALLBACK_DIR, 'favicon.svg');

	if (existsSync(faviconPng)) return '/generated/favicon.png';
	if (existsSync(faviconSvg)) return '/favicon.svg';
	return '';
}
