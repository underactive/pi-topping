import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { isPlainObject, stripControlChars } from "./util.ts";
import { WORDS, type WordEntry } from "./words.ts";

const PACK_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const RESERVED_BUNDLED_PACK_IDS = new Set(["doctor-who", "firefly", "hitchhikers-guide", "lord-of-the-rings", "matrix", "portal", "simcity", "star-trek", "star-wars"]);

export function isWordPackId(value: string): boolean { return PACK_ID_PATTERN.test(value); }
const BUNDLED_PACK_DIRECTORY = fileURLToPath(new URL("../wordpacks/", import.meta.url));

export interface WordPack {
	id: string;
	name: string;
	description?: string;
	attribution?: string;
	words: readonly WordEntry[];
	bundled: boolean;
}

export interface WorkingTextSelection {
	text: string;
	pastTense: string;
}

export function wordPacksPath(): string {
	return join(getAgentDir(), "pi-topping", "word-packs.json");
}

function safeText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = stripControlChars(value).trim();
	return text || undefined;
}

/** Validate a pack document, discarding invalid packs and entries. */
export function parseWordPacks(value: unknown, bundled = false): WordPack[] {
	if (!isPlainObject(value)) return [];
	const rawPacks = Array.isArray(value.packs) ? value.packs : [value];
	const packs: WordPack[] = [];
	const ids = new Set<string>();
	for (const rawPack of rawPacks) {
		if (!isPlainObject(rawPack)) continue;
		const id = safeText(rawPack.id);
		const name = safeText(rawPack.name);
		if (!id || !name || !isWordPackId(id) || ids.has(id) || (!bundled && RESERVED_BUNDLED_PACK_IDS.has(id))) continue;
		const words: WordEntry[] = [];
		if (Array.isArray(rawPack.words)) {
			for (const rawWord of rawPack.words) {
				if (!isPlainObject(rawWord)) continue;
				const present_tense = safeText(rawWord.present_tense);
				const past_tense = safeText(rawWord.past_tense);
				if (present_tense && past_tense) words.push({ present_tense, past_tense });
			}
		}
		if (!words.length) continue;
		ids.add(id);
		const description = safeText(rawPack.description);
		const attribution = safeText(rawPack.attribution);
		packs.push({ id, name, ...(description ? { description } : {}), ...(attribution ? { attribution } : {}), words, bundled });
	}
	return packs;
}

/** Load every shipped JSON pack. Missing or invalid bundled data is a package-integrity error. */
export function loadBundledWordPacks(): WordPack[] {
	const files = readdirSync(BUNDLED_PACK_DIRECTORY).filter((file) => file.endsWith(".json")).sort();
	const packs: WordPack[] = [];
	const ids = new Set<string>();
	for (const file of files) {
		let value: unknown;
		try {
			value = JSON.parse(readFileSync(join(BUNDLED_PACK_DIRECTORY, file), "utf8"));
		} catch (error) {
			throw new Error(`Invalid bundled word pack: ${file}`, { cause: error });
		}
		const parsed = parseWordPacks(value, true);
		if (!parsed.length) throw new Error(`Invalid bundled word pack: ${file}`);
		for (const pack of parsed) {
			if (ids.has(pack.id)) throw new Error(`Duplicate bundled word pack ID: ${pack.id}`);
			ids.add(pack.id);
			packs.push(pack);
		}
	}
	const bundledIds = new Set(packs.map((pack) => pack.id));
	for (const id of RESERVED_BUNDLED_PACK_IDS) {
		if (!bundledIds.has(id)) throw new Error(`Missing bundled word pack: ${id}`);
	}
	for (const id of bundledIds) {
		if (!RESERVED_BUNDLED_PACK_IDS.has(id)) throw new Error(`Bundled word pack "${id}" must be listed in RESERVED_BUNDLED_PACK_IDS to prevent user-pack shadowing`);
	}
	return packs;
}

/** User pack failures are intentionally non-fatal. */
export function loadUserWordPacks(): WordPack[] {
	try {
		return parseWordPacks(JSON.parse(readFileSync(wordPacksPath(), "utf8")));
	} catch {
		return [];
	}
}

export function isWordPackEnabled(id: string, enabled: Record<string, boolean>): boolean {
	return enabled[id] === true;
}

export function selectWorkingTextSelection(enabled: Record<string, boolean>, packs: readonly WordPack[], fraction: number): WorkingTextSelection {
	const pool = [...WORDS, ...packs.filter((pack) => isWordPackEnabled(pack.id, enabled)).flatMap((pack) => pack.words)];
	const entry = pool[Math.min(pool.length - 1, Math.floor(fraction * pool.length))]!;
	return { text: `${entry.present_tense}…`, pastTense: entry.past_tense };
}

export function pickWorkingTextSelection(enabled: Record<string, boolean>, packs: readonly WordPack[]): WorkingTextSelection {
	return selectWorkingTextSelection(enabled, packs, Math.random());
}
