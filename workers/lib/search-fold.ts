// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Letters the search tokenizers' `remove_diacritics` can't fold, because
 * Unicode doesn't write them as a base letter and a mark: ø, æ, ß, ł and the
 * like. Index text and search words both go through `foldLetters`, so
 * "unicode" finds "ünïcødé". SQL that writes the index uses `foldLettersSql`.
 * Migration 0009 holds the same list; tests/search-engine.test.mjs keeps them equal.
 */
export const LETTER_FOLDS: readonly [string, string][] = [
	["ø", "o"], ["Ø", "O"], ["æ", "ae"], ["Æ", "AE"], ["œ", "oe"], ["Œ", "OE"], ["ß", "ss"],
	["ł", "l"], ["Ł", "L"], ["đ", "d"], ["Đ", "D"], ["ð", "d"], ["Ð", "D"], ["þ", "th"], ["Þ", "TH"], ["ı", "i"],
];

const FOLDS = new Map(LETTER_FOLDS);
const LETTERS = new RegExp(`[${LETTER_FOLDS.map(([from]) => from).join("")}]`, "g");

export function foldLetters(text: string): string {
	return text.replace(LETTERS, (c) => FOLDS.get(c) ?? c);
}

/** `expr` with the same letters folded, in SQL. */
export function foldLettersSql(expr: string): string {
	return LETTER_FOLDS.reduce((sql, [from, to]) => `replace(${sql}, '${from}', '${to}')`, expr);
}
