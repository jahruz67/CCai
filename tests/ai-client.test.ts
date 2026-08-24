import { describe, expect, it, vi } from "vitest";
import {
  AiClient,
  AiProviderError,
  AiTimeoutError,
  extractChatCompletionsText,
  extractResponsesText,
} from "../src/ai-client.js";
import type { BotConfig } from "../src/config.js";
import { SearchService } from "../src/search-provider.js";

function config(
  overrides: Partial<BotConfig["ai"]> = {},
): BotConfig["ai"] {
  return {
    apiKey: "secret-key",
    baseUrl: "https://example.test/v1",
    chatTokenField: "auto",
    maxOutputTokens: 200,
    model: "test-model",
    reasoningEffort: "off",
    style: "responses",
    systemPrompt: "Be helpful.",
    timeoutMs: 1_000,
    webSearchEnabled: true,
    ...overrides,
  };
}

describe("AI response extraction", () => {
  it("extracts Responses API output shapes", () => {
    expect(extractResponsesText({ output_text: "  two  " })).toBe("two");
    expect(
      extractResponsesText({
        output: [
          { content: [{ text: "part one", type: "output_text" }] },
          { content: [{ text: "part two", type: "output_text" }] },
        ],
      }),
    ).toBe("part one\npart two");
  });

  it("adds clean clickable sources and strips raw citation markers from web-search results", () => {
    expect(
      extractResponsesText({
        output: [
          {
            name: "browser.open",
            output:
              "L0:\nL1: URL: https://example.com/current?utm_source=test\nL2: Current information",
            type: "mcp_call",
          },
          {
            content: [
              {
                annotations: [],
                text: "The current answer【1†L1-L2】.",
                type: "output_text",
              },
            ],
            type: "message",
          },
        ],
      }),
    ).toBe(
      "The current answer.\n\n**Sources & References**\n- [example.com](<https://example.com/current>)",
    );
  });

  it("sends Groq GPT-OSS reasoning without its unsupported store field", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ output_text: "2" }), { status: 200 }),
    );
    const client = new AiClient(
      config({
        baseUrl: "https://api.groq.com/openai/v1",
        model: "openai/gpt-oss-120b",
        reasoningEffort: "high",
      }),
      fetcher,
    );

    await client.generate([{ content: "one plus one", role: "user" }]);

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.groq.com/openai/v1/responses",
    );
    expect(body).toMatchObject({
      model: "openai/gpt-oss-120b",
      reasoning: { effort: "high" },
      tools: [{ type: "browser_search" }],
    });
    expect(body).not.toHaveProperty("store");
  });

  it("extracts Chat Completions output and cleans citation artifacts", () => {
    expect(
      extractChatCompletionsText({
        choices: [{ message: { content: "  two 【1†source】 " } }],
      }),
    ).toBe("two");
  });
});

describe("AiClient", () => {
  it("sends an ordered Responses API request", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ output_text: "2" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
    );
    const client = new AiClient(config(), fetcher);

    await expect(
      client.generate([{ content: "one plus one", role: "user" }]),
    ).resolves.toBe("2");

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://example.test/v1/responses");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer secret-key" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      input: [{ content: "one plus one", role: "user" }],
      max_output_tokens: 200,
      model: "test-model",
      store: false,
      tools: [{ type: "web_search" }],
    });
  });

  it("can disable Responses API web search", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ output_text: "2" }), { status: 200 }),
    );
    const client = new AiClient(config({ webSearchEnabled: false }), fetcher);

    await client.generate([{ content: "one plus one", role: "user" }]);

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).not.toHaveProperty(
      "tools",
    );
  });

  it("formats multimodal content with input_image for Responses API", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ output_text: "It is a cat" }), { status: 200 }),
    );
    const client = new AiClient(config(), fetcher);

    await client.generate([
      {
        content: [
          { text: "What is in this image?", type: "text" },
          { image_url: { url: "data:image/png;base64,iVBORw0KGgo=" }, type: "image_url" },
        ],
        role: "user",
      },
    ]);

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      input: Array<{
        content: Array<{ image_url?: string; text?: string; type: string }>;
        role: string;
      }>;
    };
    expect(body.input[0]?.content).toEqual([
      { text: "What is in this image?", type: "input_text" },
      { image_url: "data:image/png;base64,iVBORw0KGgo=", type: "input_image" },
    ]);
  });

  it("formats multimodal content with image_url for Chat Completions API", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "It is a puppy" } }] }),
          { status: 200 },
        ),
    );
    const client = new AiClient(config({ style: "chat-completions" }), fetcher);

    await client.generate([
      {
        content: [
          { text: "What animal is this?", type: "text" },
          { image_url: { url: "https://example.com/dog.jpg" }, type: "image_url" },
        ],
        role: "user",
      },
    ]);

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{
        content: unknown;
        role: string;
      }>;
    };
    const userMsg = body.messages.find((m) => m.role === "user");
    expect(userMsg?.content).toEqual([
      { text: "What animal is this?", type: "text" },
      { image_url: { url: "https://example.com/dog.jpg" }, type: "image_url" },
    ]);
  });

  it("supports an OpenAI-compatible chat-completions endpoint with web_search tool calling", async () => {
    const searchFetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [
              {
                content: "Node 24 released in 2026",
                title: "Node.js v24",
                url: "https://nodejs.org/v24",
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const searchService = new SearchService(
      { maxResults: 3, provider: "tavily", tavilyApiKey: "test_key", timeoutMs: 5000 },
      searchFetcher,
    );

    const aiFetcher = vi.fn()
      // First round: model chooses to search
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  role: "assistant",
                  tool_calls: [
                    {
                      function: {
                        arguments: JSON.stringify({ query: "latest node version" }),
                        name: "web_search",
                      },
                      id: "call_1",
                      type: "function",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      // Second round: model receives tool output and answers
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: "The latest version is Node.js 24.",
                  role: "assistant",
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const client = new AiClient(
      config({ style: "chat-completions" }),
      aiFetcher,
      searchService,
    );

    const result = await client.generate([{ content: "what is latest node?", role: "user" }]);
    expect(result).toContain("The latest version is Node.js 24.");
    expect(result).toContain("**Sources & References**");
    expect(result).toContain("[nodejs.org](<https://nodejs.org/v24>)");

    expect(aiFetcher).toHaveBeenCalledTimes(2);
  });

  it("uses max_completion_tokens for OpenAI and o-series chat models", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "2" } }] }),
          { status: 200 },
        ),
    );
    const client = new AiClient(
      config({
        baseUrl: "https://api.openai.com/v1",
        model: "o3",
        style: "chat-completions",
      }),
      fetcher,
    );
    await client.generate([{ content: "one plus one", role: "user" }]);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      max_completion_tokens: 200,
    });
  });

  it("enables Groq browser search in chat-completions mode", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "answer" } }] }),
          { status: 200 },
        ),
    );
    const client = new AiClient(
      config({
        baseUrl: "https://api.groq.com/openai/v1",
        style: "chat-completions",
      }),
      fetcher,
    );

    await client.generate([{ content: "latest news", role: "user" }]);

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      tools: [{ type: "browser_search" }],
    });
  });

  it("handles valid refusal and incomplete Responses results", async () => {
    const refusalFetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            output: [{ content: [{ refusal: "No", type: "refusal" }] }],
            status: "completed",
          }),
          { status: 200 },
        ),
    );
    await expect(
      new AiClient(config(), refusalFetcher).generate([
        { content: "request", role: "user" },
      ]),
    ).rejects.toMatchObject({ name: "AiRefusalError" });

    const incompleteFetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            incomplete_details: { reason: "max_output_tokens" },
            output: [],
            status: "incomplete",
          }),
          { status: 200 },
        ),
    );
    await expect(
      new AiClient(config(), incompleteFetcher).generate([
        { content: "request", role: "user" },
      ]),
    ).rejects.toMatchObject({ name: "AiIncompleteResponseError" });
  });

  it("turns provider errors into controlled typed errors", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          headers: { "x-request-id": "req_123" },
          status: 429,
        }),
    );
    const client = new AiClient(config(), fetcher);

    const promise = client.generate([{ content: "hello", role: "user" }]);
    await expect(promise).rejects.toMatchObject({
      name: "AiProviderError",
      requestId: "req_123",
      status: 429,
    });
  });

  it("times out stalled requests", async () => {
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const client = new AiClient(config({ timeoutMs: 5 }), fetcher);
    await expect(
      client.generate([{ content: "hello", role: "user" }]),
    ).rejects.toBeInstanceOf(AiTimeoutError);
  });
});
