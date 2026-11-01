import { inflateSync, deflateSync } from "node:zlib";

interface Pixels { width: number; height: number; channels: number; bytes: Uint8Array }

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, bytes: Buffer): Buffer {
	const body = Buffer.concat([Buffer.from(type), bytes]);
	const length = Buffer.alloc(4), crc = Buffer.alloc(4);
	length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

/** Enlarge only screenshot pixels for OCR; source input geometry is unchanged. */
export function enlargeForOcr(png: Uint8Array, cropHeight?: number, cleanControls = false): Uint8Array {
	const source = decode(png);
	const width = source.width * 2, height = Math.min(cropHeight ?? source.height, source.height) * 2;
	const scanlines = Buffer.alloc((width * 3 + 1) * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const input = (Math.floor(y / 2) * source.width + Math.floor(x / 2)) * source.channels;
			const output = y * (width * 3 + 1) + 1 + x * 3;
			if (cleanControls) {
				const isGreen = (index: number) => source.bytes[index + 1]! > source.bytes[index]! * 1.15 && source.bytes[index + 1]! > source.bytes[index + 2]! * 1.05;
				let value = Math.max(source.bytes[input]!, source.bytes[input + 1]!, source.bytes[input + 2]!) < 165 ? 0 : 255;
				if (isGreen(input)) value = 255;
				else if (value === 255) {
					const sx = Math.floor(x / 2), sy = Math.floor(y / 2);
					for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) {
						if (sx + dx! >= 0 && sx + dx! < source.width && sy + dy! >= 0 && sy + dy! < source.height && isGreen(((sy + dy!) * source.width + sx + dx!) * source.channels)) value = 0;
					}
				}
				scanlines[output] = value; scanlines[output + 1] = value; scanlines[output + 2] = value;
			} else {
				scanlines[output] = source.bytes[input]!;
				scanlines[output + 1] = source.bytes[input + 1]!;
				scanlines[output + 2] = source.bytes[input + 2]!;
			}
		}
	}
	if (cleanControls) {
		const white = (x: number, y: number) => { const index = y * (width * 3 + 1) + 1 + x * 3; scanlines.fill(255, index, index + 3); };
		const black = (x: number, y: number) => scanlines[y * (width * 3 + 1) + 1 + x * 3] === 0;
		for (let y = 0; y < height; y++) {
			let start = -1;
			for (let x = 0; x <= width; x++) {
				if (x < width && black(x, y)) { if (start < 0) start = x; }
				else if (start >= 0) { if (x - start >= 60) for (let point = start; point < x; point++) white(point, y); start = -1; }
			}
		}
		for (let x = 0; x < width; x++) {
			let start = -1;
			for (let y = 0; y <= height; y++) {
				if (y < height && black(x, y)) { if (start < 0) start = y; }
				else if (start >= 0) { if (y - start >= 36) for (let point = start; point < y; point++) white(x, point); start = -1; }
			}
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
	return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(scanlines)), pngChunk("IEND", Buffer.alloc(0))]);
}
function decode(png: Uint8Array): Pixels {
	const source = Buffer.from(png);
	if (source.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Not PNG");
	const width = source.readUInt32BE(16);
	const height = source.readUInt32BE(20);
	const channels = source[25] === 6 ? 4 : source[25] === 2 ? 3 : 0;
	if (!channels || source[24] !== 8 || source[28] !== 0 || width * height > 4_000_000) throw new Error("Unsupported PNG");
	const parts: Buffer[] = [];
	for (let offset = 8; offset + 12 <= source.length;) {
		const length = source.readUInt32BE(offset);
		if (offset + length + 12 > source.length) throw new Error("Invalid PNG chunk");
		if (source.toString("ascii", offset + 4, offset + 8) === "IDAT") parts.push(source.subarray(offset + 8, offset + 8 + length));
		offset += length + 12;
	}
	const stride = width * channels;
	const packed = inflateSync(Buffer.concat(parts), { maxOutputLength: (stride + 1) * height });
	if (packed.length !== (stride + 1) * height) throw new Error("Invalid PNG data");
	const bytes = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = packed[y * (stride + 1)]!;
		for (let x = 0; x < stride; x++) {
			const left = x >= channels ? bytes[y * stride + x - channels]! : 0;
			const up = y ? bytes[(y - 1) * stride + x]! : 0;
			const upperLeft = y && x >= channels ? bytes[(y - 1) * stride + x - channels]! : 0;
			let prediction = 0;
			if (filter === 1) prediction = left;
			else if (filter === 2) prediction = up;
			else if (filter === 3) prediction = Math.floor((left + up) / 2);
			else if (filter === 4) {
				const p = left + up - upperLeft;
				const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
				prediction = a <= b && a <= c ? left : b <= c ? up : upperLeft;
			} else if (filter !== 0) throw new Error("Invalid PNG filter");
			bytes[y * stride + x] = (packed[y * (stride + 1) + x + 1]! + prediction) & 255;
		}
	}
	return { width, height, channels, bytes };
}

/** Allow only a narrow text-caret blink, not animation, hover, geometry or modal changes. */
export function differsOnlyByCaret(left: Uint8Array, right: Uint8Array): boolean {
	try {
		const a = decode(left), b = decode(right);
		if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) return false;
		let count = 0, minX = a.width, maxX = -1, minY = a.height, maxY = -1;
		for (let pixel = 0; pixel < a.width * a.height; pixel++) {
			const offset = pixel * a.channels;
			if (a.bytes[offset] === b.bytes[offset] && a.bytes[offset + 1] === b.bytes[offset + 1] && a.bytes[offset + 2] === b.bytes[offset + 2]) continue;
			count++;
			if (count > 80) return false;
			const x = pixel % a.width, y = Math.floor(pixel / a.width);
			minX = Math.min(minX, x); maxX = Math.max(maxX, x);
			minY = Math.min(minY, y); maxY = Math.max(maxY, y);
			if (maxX - minX > 2 || maxY - minY > 31) return false;
		}
		return count > 0 && maxY - minY >= 4;
	} catch { return false; }
}
