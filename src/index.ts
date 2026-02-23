// Workers-native port of ai-sdk-openai-websocket-fetch.
// Uses fetch-based WebSocket upgrade instead of the "ws" npm package.

function connectWebSocket(
  url: string,
  headers: Record<string, string>
): Promise<WebSocket> {
  const fetchUrl = url
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://");

  return fetch(fetchUrl, {
    headers: { Upgrade: "websocket", ...headers }
  }).then((resp) => {
    const ws = (resp as unknown as { webSocket: WebSocket | null }).webSocket;
    if (!ws) throw new Error("Failed to establish WebSocket connection");
    ws.accept();
    return ws;
  });
}

function normalizeHeaders(
  headers: HeadersInit | undefined
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  if (headers instanceof Headers) {
    headers.forEach((v, k) => {
      result[k.toLowerCase()] = v;
    });
  } else if (Array.isArray(headers)) {
    for (const [k, v] of headers) {
      result[k.toLowerCase()] = v;
    }
  } else {
    for (const [k, v] of Object.entries(headers)) {
      if (v != null) result[k.toLowerCase()] = v;
    }
  }
  return result;
}

const WS_OPEN = 1;

export function createWebSocketFetch(options?: { url?: string }) {
  const wsUrl = options?.url ?? "wss://api.openai.com/v1/responses";
  let ws: WebSocket | null = null;
  let connecting: Promise<WebSocket> | null = null;
  let busy = false;

  function getConnection(authorization: string): Promise<WebSocket> {
    if (ws?.readyState === WS_OPEN && !busy) {
      return Promise.resolve(ws);
    }
    if (connecting && !busy) return connecting;
    connecting = connectWebSocket(wsUrl, {
      Authorization: authorization,
      "OpenAI-Beta": "responses_websockets=2026-02-06"
    }).then((socket) => {
      ws = socket;
      connecting = null;
      socket.addEventListener("close", () => {
        if (ws === socket) ws = null;
      });
      return socket;
    });
    connecting.catch(() => {
      connecting = null;
    });
    return connecting;
  }

  async function websocketFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url =
      input instanceof URL
        ? input.toString()
        : typeof input === "string"
          ? input
          : input.url;

    if (init?.method !== "POST" || !url.endsWith("/responses")) {
      return globalThis.fetch(input, init);
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(typeof init.body === "string" ? init.body : "");
    } catch {
      return globalThis.fetch(input, init);
    }

    if (!body.stream) {
      return globalThis.fetch(input, init);
    }

    const headers = normalizeHeaders(init.headers);
    const authorization = headers["authorization"] ?? "";
    const connection = await getConnection(authorization);
    busy = true;

    const { stream: _, ...requestBody } = body;
    const encoder = new TextEncoder();

    function onMessage(evt: MessageEvent) {
      const text = String(evt.data);
      controller.enqueue(encoder.encode(`data: ${text}\n\n`));
      try {
        const event = JSON.parse(text);
        if (event.type === "response.completed" || event.type === "error") {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          cleanup();
          controller.close();
        }
      } catch {}
    }

    function onError() {
      cleanup();
      controller.error(new Error("WebSocket error"));
    }

    function onClose() {
      cleanup();
      try {
        controller.close();
      } catch {}
    }

    function cleanup() {
      connection.removeEventListener("message", onMessage);
      connection.removeEventListener("error", onError);
      connection.removeEventListener("close", onClose);
      busy = false;
    }

    let controller: ReadableStreamDefaultController;
    const responseStream = new ReadableStream({
      start(c) {
        controller = c;

        connection.addEventListener("message", onMessage);
        connection.addEventListener("error", onError);
        connection.addEventListener("close", onClose);

        if (init?.signal) {
          if (init.signal.aborted) {
            cleanup();
            controller.error(
              init.signal.reason ?? new DOMException("Aborted", "AbortError")
            );
            return;
          }
          init.signal.addEventListener(
            "abort",
            () => {
              cleanup();
              try {
                controller.error(
                  init.signal!.reason ??
                    new DOMException("Aborted", "AbortError")
                );
              } catch {}
            },
            { once: true }
          );
        }

        connection.send(
          JSON.stringify({ type: "response.create", ...requestBody })
        );
      }
    });

    return new Response(responseStream, {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
  }

  return Object.assign(websocketFetch, {
    close() {
      if (ws) {
        ws.close();
        ws = null;
      }
    }
  });
}
