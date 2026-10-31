import { resolve } from "node:path";
import { NoVncDesktop } from "./vnc.ts";

const viewerUrl = process.env.DESKTOP_URL;
const password = process.env.DESKTOP_PASSWORD;
if (!viewerUrl || !password) {
	throw new Error("DESKTOP_URL and DESKTOP_PASSWORD must be configured");
}

const output = resolve("artifacts/desktop-login.png");
const desktop = await NoVncDesktop.login({
	viewerUrl,
	password,
	...(process.env.CHROMIUM_EXECUTABLE
		? { executablePath: process.env.CHROMIUM_EXECUTABLE }
		: {}),
});
try {
	const frame = await desktop.capture(output);
	if (frame.width !== 1280 || frame.height !== 800) {
		throw new Error(
			`Unexpected desktop dimensions: ${frame.width}x${frame.height}`,
		);
	}
	console.log(
		`PASS noVNC login; captured ${frame.width}x${frame.height} at ${output}`,
	);
} finally {
	await desktop.close();
}
