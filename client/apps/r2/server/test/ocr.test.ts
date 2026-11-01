import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTesseractHints } from "../src/ocr.ts";

test("OCR hints preserve text and expose normalized measured centers", () => {
	const header = "level\tpage\tblock\tpar\tline\tword\tleft\ttop\twidth\theight\tconf\ttext";
	const row = `5\t1\t1\t1\t1\t1\t91\t43\t64\t10\t95.2\tComercial`;
	const hints = formatTesseractHints(`${header}\n${row}`, 1280, 800);
	assert.match(hints, /"Comercial" @ \(96,60\)/);
	assert.equal(formatTesseractHints(header, 1280, 800), "");
});
