export function pngDimensions(png: Uint8Array): { width: number; height: number } {
  const signature = "89504e470d0a1a0a";
  if (png.byteLength < 24 || Buffer.from(png.subarray(0, 8)).toString("hex") !== signature) {
    throw new Error("Image is not a supported PNG");
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("PNG dimensions are invalid");
  }
  return { width, height };
}
