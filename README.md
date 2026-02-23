# agents-sdk-openai-websocket-fetch

<img width="1212" height="804" alt="image" src="https://github.com/user-attachments/assets/241efdaf-d420-4c8b-acf8-6307144e3f80" />


Drop-in `fetch` replacement that routes OpenAI Responses API streaming requests through a persistent WebSocket connection — **ported for Cloudflare Workers**.

This is a Cloudflare Workers–native port of [`ai-sdk-openai-websocket-fetch`](https://github.com/vercel-labs/ai-sdk-openai-websocket/tree/main/packages/ai-sdk-openai-websocket-fetch) by [Vercel Labs](https://github.com/vercel-labs). Instead of the Node.js `ws` package, it uses the Workers runtime's built-in WebSocket support via `fetch` with the `Upgrade: websocket` header.

## Why?

OpenAI's WebSocket API keeps a persistent connection open. After the initial handshake, subsequent requests skip TCP/TLS/HTTP negotiation entirely — reducing TTFB in multi-step agentic workflows where the model makes many tool calls.

Cloudflare Workers don't support the `ws` npm package. This port replaces it with the native [`WebSocket` API available in the Workers runtime](https://developers.cloudflare.com/workers/runtime-apis/websockets/), making it possible to take advantage of persistent WebSocket connections to OpenAI directly from a Worker.

## Installation

```bash
npm install
```

## Usage

```ts
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createWebSocketFetch } from "./src/index";

const wsFetch = createWebSocketFetch();
const openai = createOpenAI({ fetch: wsFetch });

const result = streamText({
  model: openai("gpt-4.1-mini"),
  prompt: "Hello!",
  onFinish: () => wsFetch.close(),
});
```

## How it works

`createWebSocketFetch()` returns a function with the same signature as `fetch`. When it detects a streaming `POST` to the `/responses` endpoint, it:

1. Opens (or reuses) a persistent WebSocket connection to `wss://api.openai.com/v1/responses` using the Cloudflare Workers `fetch`-based WebSocket upgrade.
2. Sends the request payload over the WebSocket.
3. Returns a `Response` with a `ReadableStream` body that emits SSE-formatted events as they arrive.

All other requests are passed through to the global `fetch` unchanged.

## Development

```bash
npm install
npx tsc --noEmit  # type-check
```

## Credits

This project is a port of [ai-sdk-openai-websocket](https://github.com/vercel-labs/ai-sdk-openai-websocket) by [Vercel Labs](https://github.com/vercel-labs), adapted to run natively on Cloudflare Workers without Node.js dependencies.

Original project: [https://github.com/vercel-labs/ai-sdk-openai-websocket](https://github.com/vercel-labs/ai-sdk-openai-websocket)

## License

[MIT](./LICENSE)
