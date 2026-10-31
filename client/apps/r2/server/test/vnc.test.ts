import assert from "node:assert/strict";
import { test } from "node:test";
import { toNoVncViewerUrl } from "../src/vnc.ts";

test("official websocket desktop URLs resolve to the noVNC viewer", () => {
	assert.equal(
		toNoVncViewerUrl("wss://desktop.test/websockify"),
		"https://desktop.test/",
	);
	assert.equal(
		toNoVncViewerUrl("ws://desktop.test/websockify?ignored=viewer"),
		"http://desktop.test/",
	);
	assert.equal(
		toNoVncViewerUrl("https://desktop.test/vnc.html?autoconnect=true"),
		"https://desktop.test/vnc.html?autoconnect=true",
	);
	assert.throws(() => toNoVncViewerUrl("file:///tmp/websockify"));
});
