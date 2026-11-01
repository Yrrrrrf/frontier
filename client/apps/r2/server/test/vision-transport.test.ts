import assert from "node:assert/strict";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";
import { test } from "node:test";
import { createOllamaVision } from "../src/vision.ts";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);
const input = () => ({
	frameId: "frame-transport",
	goal: "Click the visible pixel",
	image: { bytes: png, width: 1, height: 1 },
});

async function withOllama(
	handler: (request: IncomingMessage, response: ServerResponse) => void,
	run: (baseUrl: string) => Promise<void>,
) {
	const sockets = new Set<Socket>();
	const server = createServer((request, response) => {
		request.resume();
		handler(request, response);
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	try {
		await run(baseUrl);
	} finally {
		for (const socket of sockets) socket.destroy();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
}

test("Ollama timeout before headers is timeout", async () => {
	await withOllama(
		(_request, _response) => {},
		async (baseUrl) => {
			const result = await createOllamaVision({ baseUrl }).proposeAction(
				input(),
				{
					timeoutMs: 40,
				},
			);
			assert.equal(result.ok, false);
			if (!result.ok) assert.equal(result.error.code, "timeout");
		},
	);
});

test("Ollama timeout while the body is stalled is timeout", async () => {
	await withOllama(
		(_request, response) => {
			response.writeHead(200, { "Content-Type": "application/json" });
			response.write('{"message":{"content":');
		},
		async (baseUrl) => {
			const result = await createOllamaVision({ baseUrl }).proposeAction(
				input(),
				{
					timeoutMs: 40,
				},
			);
			assert.equal(result.ok, false);
			if (!result.ok) assert.equal(result.error.code, "timeout");
		},
	);
});

test("parent cancellation while the body is stalled is cancelled", async () => {
	await withOllama(
		(_request, response) => {
			response.writeHead(200, { "Content-Type": "application/json" });
			response.write('{"message":{"content":');
		},
		async (baseUrl) => {
			const parent = new AbortController();
			const timer = setTimeout(() => parent.abort(), 20);
			try {
				const result = await createOllamaVision({ baseUrl }).proposeAction(
					input(),
					{
						timeoutMs: 1_000,
						signal: parent.signal,
					},
				);
				assert.equal(result.ok, false);
				if (!result.ok) assert.equal(result.error.code, "cancelled");
			} finally {
				clearTimeout(timer);
			}
		},
	);
});

test("the first of two abort causes owns the classification", async () => {
	await withOllama(
		(_request, _response) => {},
		async (baseUrl) => {
			const vision = createOllamaVision({ baseUrl });
			const firstParent = new AbortController();
			const laterParent = setTimeout(() => firstParent.abort(), 80);
			const timed = await vision.proposeAction(input(), {
				timeoutMs: 30,
				signal: firstParent.signal,
			});
			clearTimeout(laterParent);
			assert.equal(timed.ok, false);
			if (!timed.ok) assert.equal(timed.error.code, "timeout");

			const secondParent = new AbortController();
			const earlierParent = setTimeout(() => secondParent.abort(), 10);
			const cancelled = await vision.proposeAction(input(), {
				timeoutMs: 100,
				signal: secondParent.signal,
			});
			clearTimeout(earlierParent);
			assert.equal(cancelled.ok, false);
			if (!cancelled.ok) assert.equal(cancelled.error.code, "cancelled");
		},
	);
});

test("bad envelopes are invalid_response and bad actions are invalid_action", async () => {
	const payloads = [
		"not-json",
		JSON.stringify({ message: {} }),
		JSON.stringify({ message: { content: "not-an-action" } }),
		JSON.stringify({ message: { content: '{"kind":"click","x":1002,"y":0}' } }),
	];
	await withOllama(
		(_request, response) => {
			response.writeHead(200, { "Content-Type": "application/json" });
			response.end(payloads.shift());
		},
		async (baseUrl) => {
			const vision = createOllamaVision({ baseUrl });
			const expected = [
				"invalid_response",
				"invalid_response",
				"invalid_action",
				"invalid_action",
			];
			for (const code of expected) {
				const result = await vision.proposeAction(input(), { timeoutMs: 500 });
				assert.equal(result.ok, false);
				if (!result.ok) assert.equal(result.error.code, code);
			}
		},
	);
});

test("Ollama response streaming stops at the byte limit", async () => {
	await withOllama(
		(_request, response) => {
			response.writeHead(200, { "Content-Type": "application/json" });
			response.end(Buffer.alloc(1024 * 1024 + 1, 65));
		},
		async (baseUrl) => {
			const result = await createOllamaVision({ baseUrl }).proposeAction(
				input(),
				{
					timeoutMs: 1_000,
				},
			);
			assert.equal(result.ok, false);
			if (!result.ok) assert.equal(result.error.code, "invalid_response");
		},
	);
});
