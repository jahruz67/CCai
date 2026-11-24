import { describe, expect, it, vi } from "vitest";
import {
  AiClient,
  AiProviderError,
  AiTimeoutError,
  extractChatCompletionsText,
  extractGoogleNativeText,
  extractResponsesText,
  isGemmaModel,
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
    retry: { enabled: false, initialDelayMs: 0, maxAttempts: 1, maxDelayMs: 0, requestTimeoutMs: 1_000 },
    style: "responses",
    systemPrompt: "Be helpful.",
    timeoutMs: 1_000,
    webSearchEnabled: true,
    ...overrides,
  };
}

describe("request-specific web search", () => {
  it.each(["responses", "chat-completions", "google-native"] as const)(
    "disables web tools for one %s request without affecting the next",
    async (style) => {
      const body = style === "responses" ? { output_text: "saved" }
        : style === "chat-completions" ? { choices: [{ message: { content: "saved" } }] }
        : { candidates: [{ content: { parts: [{ text: "saved" }], role: "model" } }] };
      const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(body), { status: 200 }),
      );
      const search = new SearchService({ maxResults: 5, provider: "duckduckgo", timeoutMs: 1_000 });
      const client = new AiClient(config({ style, model: "gemini-test" }), fetcher, search);
      const messages = [{ content: "extract a memory", role: "user" as const }];

      await client.generate(messages, undefined, { webSearchEnabled: false });
      await client.generate(messages);

      const bodies = fetcher.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
      expect(bodies[0]).not.toHaveProperty("tools");
      expect(bodies[1]).toHaveProperty("tools");
    },
  );

  it("preserves the request's web setting when switching to a fallback model", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: "saved" } }] }), { status: 200 }),
    ).mockResolvedValueOnce(new Response('{"error":{"message":"Unavailable"}}', { status: 503 }));
    const client = new AiClient(config({
      style: "chat-completions",
      fallback: {
        circuitBreakerCooldownMs: 60_000, circuitBreakerThreshold: 0,
        enabled: true, maxRetries: 0, models: [{ model: "fallback" }], timeoutMs: 1_000,
      },
    }), fetcher);

    await expect(client.generate([{ content: "extract a memory", role: "user" }], undefined, {
      webSearchEnabled: false,
    })).resolves.toBe("saved");

    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const call of fetcher.mock.calls) {
      expect(JSON.parse(String(call[1]?.body))).not.toHaveProperty("tools");
    }
  });
});

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

  it("extracts Google Native output and cleans citation artifacts", () => {
    expect(
      extractGoogleNativeText({
        candidates: [
          {
            content: {
              parts: [{ text: "  42 [cite: 1] " }],
            },
          },
        ],
      }),
    ).toBe("42");
  });

  it("excludes Google's thought parts from the final answer", () => {
    expect(extractGoogleNativeText({
      candidates: [{ content: { parts: [
        { text: "Private scratch work", thought: true },
        { text: "42", thought: false },
        { text: "More private scratch work", thought: true },
      ] } }],
    })).toBe("42");
    expect(extractGoogleNativeText({
      candidates: [{ content: { parts: [{ text: "Private", thought: true }] } }],
    })).toBeUndefined();
  });

  it("ignores reasoning fields and blocks in Chat Completions responses", () => {
    expect(extractChatCompletionsText({ choices: [{ message: {
      reasoning_content: "Private scratch work",
      content: [
        { type: "reasoning", text: "Private scratch work" },
        { type: "thinking", text: "More private scratch work" },
        { type: "text", text: "Private", thought: true },
        { type: "text", text: "42" },
      ],
    } }] })).toBe("42");
    expect(extractChatCompletionsText({ choices: [{ message: {
      reasoning_content: "Private scratch work",
      content: [{ type: "reasoning", text: "Private scratch work" }],
    } }] })).toBeUndefined();
  });

  it("ignores Responses API reasoning items, analysis channels, and their citations", () => {
    expect(extractResponsesText({ output: [
      { type: "reasoning", content: [{ type: "output_text", text: "Private" }] },
      { type: "message", channel: "analysis", content: [{
        type: "output_text",
        text: "Private scratch work",
        annotations: [{ type: "url_citation", url: "https://private.example.test" }],
      }] },
      { type: "message", channel: "final", content: [{ type: "output_text", text: "42" }] },
    ] })).toBe("42");
  });
});

describe.each([
  {
    name: "Google Native",
    extract: extractGoogleNativeText,
    wrap: (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  },
  {
    name: "Chat Completions",
    extract: extractChatCompletionsText,
    wrap: (text: string) => ({ choices: [{ message: { content: text } }] }),
  },
  {
    name: "Chat Completions content blocks",
    extract: extractChatCompletionsText,
    wrap: (text: string) => ({ choices: [{ message: { content: [{ type: "text", text }] } }] }),
  },
  {
    name: "Responses API",
    extract: extractResponsesText,
    wrap: (text: string) => ({ output_text: text }),
  },
])("$name reasoning filtering", ({ extract, wrap }) => {
  it("keeps only the final answer", () => {
    expect(extract(wrap("<think>Private scratch work</think>42"))).toBe("42");
  });

  it.each(["<think>Private scratch work</think>", "<think>Truncated scratch work"])(
    "returns no answer for reasoning-only output %j",
    (text) => {
      expect(extract(wrap(text))).toBeUndefined();
    },
  );
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

  describe("google-native provider", () => {
    it("identifies Gemma models correctly", () => {
      expect(isGemmaModel("gemma-4-31b-it")).toBe(true);
      expect(isGemmaModel("gemma-2-27b-it")).toBe(true);
      expect(isGemmaModel("models/gemma-2-9b-it")).toBe(true);
      expect(isGemmaModel("gemini-2.5-flash")).toBe(false);
      expect(isGemmaModel("gemini-1.5-pro")).toBe(false);
    });

    it("sends a native Google API request for Gemma models without systemInstruction and without tools", async () => {
      const fetcher = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      { text: "Private scratch work", thought: true },
                      { text: "Gemma response" },
                    ],
                    role: "model",
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      );

      const client = new AiClient(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemma-4-31b-it",
          style: "google-native",
          systemPrompt: "Be an accurate assistant.",
        }),
        fetcher,
      );

      const result = await client.generate([{ content: "explain physics", role: "user" }]);
      expect(result).toBe("Gemma response");

      expect(fetcher).toHaveBeenCalledOnce();
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent",
      );
      expect(init?.headers).toMatchObject({
        "Content-Type": "application/json",
        "x-goog-api-key": "secret-key",
      });

      const body = JSON.parse(String(init?.body)) as {
        contents: Array<{
          parts: Array<{ text?: string }>;
          role: string;
        }>;
        generationConfig: { maxOutputTokens: number };
        systemInstruction?: unknown;
        tools?: unknown;
      };

      // Gemma must not have systemInstruction or tools fields
      expect(body.systemInstruction).toBeUndefined();
      expect(body.tools).toBeUndefined();
      expect(body.generationConfig.maxOutputTokens).toBe(200);

      // System instruction must be prepended to the user content turn
      expect(body.contents).toHaveLength(1);
      expect(body.contents[0]?.role).toBe("user");
      expect(body.contents[0]?.parts[0]?.text).toContain("[System Instructions]");
      expect(body.contents[0]?.parts[0]?.text).toContain("Be an accurate assistant.");
      expect(body.contents[0]?.parts[0]?.text).toContain("explain physics");
    });

    it("sends a native Google API request for Gemini models with systemInstruction and tools", async () => {
      const fetcher = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: "Gemini response" }],
                    role: "model",
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      );

      const searchService = new SearchService({
        maxResults: 3,
        provider: "duckduckgo",
        timeoutMs: 5000,
      });

      const client = new AiClient(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          reasoningEffort: "medium",
          style: "google-native",
          systemPrompt: "Be a helpful bot.",
          webSearchEnabled: true,
        }),
        fetcher,
        searchService,
      );

      const result = await client.generate([{ content: "hello Gemini", role: "user" }]);
      expect(result).toBe("Gemini response");

      expect(fetcher).toHaveBeenCalledOnce();
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      );

      const body = JSON.parse(String(init?.body)) as {
        contents: Array<{
          parts: Array<{ text?: string }>;
          role: string;
        }>;
        generationConfig: { maxOutputTokens: number; thinkingConfig?: { thinkingBudget: number } };
        systemInstruction?: { parts: Array<{ text: string }> };
        tools?: Array<{ functionDeclarations: Array<{ name: string }> }>;
      };

      // Gemini sends native systemInstruction
      expect(body.systemInstruction?.parts[0]?.text).toContain("Be a helpful bot.");
      expect(body.contents[0]?.parts[0]?.text).toBe("hello Gemini");

      // Gemini sends web_search tool declaration
      expect(body.tools?.[0]?.functionDeclarations[0]?.name).toBe("web_search");

      // Gemini configures thinking budget when reasoning is enabled
      expect(body.generationConfig.thinkingConfig?.thinkingBudget).toBe(4096);
    });

    it("handles native Google tool calling for web_search and formats sources", async () => {
      const searchFetcher = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              results: [
                {
                  content: "Gemini 2.5 was announced by Google in 2026.",
                  title: "Google Gemini 2.5",
                  url: "https://blog.google/gemini-2-5",
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

      const aiFetcher = vi
        .fn()
        // Round 1: Gemini decides to call web_search
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: {
                          args: { query: "Gemini 2.5 release date" },
                          name: "web_search",
                        },
                      },
                    ],
                    role: "model",
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        )
        // Round 2: Gemini answers after receiving search results
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: "Gemini 2.5 was released in 2026." }],
                    role: "model",
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        );

      const client = new AiClient(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          style: "google-native",
        }),
        aiFetcher,
        searchService,
      );

      const result = await client.generate([{ content: "when was gemini 2.5 released?", role: "user" }]);
      expect(result).toContain("Gemini 2.5 was released in 2026.");
      expect(result).toContain("**Sources & References**");
      expect(result).toContain("[blog.google](<https://blog.google/gemini-2-5>)");

      expect(aiFetcher).toHaveBeenCalledTimes(2);

      // Verify the second request includes the tool response in Google format
      const secondBody = JSON.parse(String(aiFetcher.mock.calls[1]?.[1]?.body)) as {
        contents: Array<{
          parts: Array<{
            functionCall?: { name: string };
            functionResponse?: { name: string; response: { content: string } };
          }>;
          role: string;
        }>;
      };

      const toolResponseTurn = secondBody.contents.find((c) =>
        c.parts.some((p) => p.functionResponse?.name === "web_search"),
      );
      expect(toolResponseTurn).toBeDefined();
      expect(toolResponseTurn?.role).toBe("user");
      expect(toolResponseTurn?.parts[0]?.functionResponse?.response.content).toContain(
        "Gemini 2.5 was announced",
      );
    });

    it("formats multimodal content with inlineData for Gemini models and text note for Gemma models", async () => {
      const geminiFetcher = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: "A picture of a pizza" }] } }],
            }),
            { status: 200 },
          ),
      );

      const geminiClient = new AiClient(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          style: "google-native",
        }),
        geminiFetcher,
      );

      await geminiClient.generate([
        {
          content: [
            { text: "What is this?", type: "text" },
            { image_url: { url: "data:image/jpeg;base64,abc123xyz==" }, type: "image_url" },
          ],
          role: "user",
        },
      ]);

      const geminiBody = JSON.parse(String(geminiFetcher.mock.calls[0]?.[1]?.body)) as {
        contents: Array<{
          parts: Array<{ inlineData?: { data: string; mimeType: string }; text?: string }>;
        }>;
      };
      const inlineDataPart = geminiBody.contents[0]?.parts.find((p) => p.inlineData);
      expect(inlineDataPart?.inlineData).toEqual({
        data: "abc123xyz==",
        mimeType: "image/jpeg",
      });

      // Test Gemma model handling of image attachment
      const gemmaFetcher = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: "Text response" }] } }],
            }),
            { status: 200 },
          ),
      );

      const gemmaClient = new AiClient(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemma-4-31b-it",
          style: "google-native",
        }),
        gemmaFetcher,
      );

      await gemmaClient.generate([
        {
          content: [
            { text: "Check this picture", type: "text" },
            { image_url: { url: "data:image/png;base64,xyz==" }, type: "image_url" },
          ],
          role: "user",
        },
      ]);

      const gemmaBody = JSON.parse(String(gemmaFetcher.mock.calls[0]?.[1]?.body)) as {
        contents: Array<{
          parts: Array<{ inlineData?: unknown; text?: string }>;
        }>;
      };
      // Gemma should not receive inlineData
      expect(gemmaBody.contents[0]?.parts.some((p) => p.inlineData)).toBe(false);
      expect(gemmaBody.contents[0]?.parts[0]?.text).toContain(
        "[Attached image - not supported by text-only Gemma model]",
      );
    });

    it("extracts citations from Google groundingMetadata", async () => {
      const fetcher = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: "Grounded answer about astrophysics." }],
                  },
                  groundingMetadata: {
                    groundingChunks: [
                      {
                        web: {
                          title: "NASA Astrophysics",
                          uri: "https://nasa.gov/astrophysics",
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      );

      const client = new AiClient(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          style: "google-native",
        }),
        fetcher,
      );

      const answer = await client.generate([{ content: "latest discoveries", role: "user" }]);
      expect(answer).toContain("Grounded answer about astrophysics.");
      expect(answer).toContain("**Sources & References**");
      expect(answer).toContain("[nasa.gov](<https://nasa.gov/astrophysics>)");
    });

    it("maps Google 400 invalid API key error to status 401", async () => {
      const fetcher = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              error: {
                code: 400,
                message: "API key not valid. Please pass a valid API key.",
                status: "INVALID_ARGUMENT",
              },
            }),
            {
              headers: { "x-request-id": "goog-err-1" },
              status: 400,
            },
          ),
      );

      const client = new AiClient(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemma-4-31b-it",
          style: "google-native",
        }),
        fetcher,
      );

      await expect(client.generate([{ content: "test", role: "user" }])).rejects.toMatchObject({
        name: "AiProviderError",
        requestId: "goog-err-1",
        status: 401,
      });
    });

    it("handles Google 404 model not found error", async () => {
      const fetcher = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              error: {
                code: 404,
                message: "models/unknown-model is not found for API version v1beta",
                status: "NOT_FOUND",
              },
            }),
            { status: 404 },
          ),
      );

      const client = new AiClient(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "unknown-model",
          style: "google-native",
        }),
        fetcher,
      );

      await expect(client.generate([{ content: "test", role: "user" }])).rejects.toThrow(
        /models\/unknown-model is not found/i,
      );
    });

    it("handles Google safety refusal and max tokens finish reasons", async () => {
      const refusalFetcher = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "SAFETY",
                },
              ],
            }),
            { status: 200 },
          ),
      );

      const refusalClient = new AiClient(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          style: "google-native",
        }),
        refusalFetcher,
      );

      await expect(
        refusalClient.generate([{ content: "unsafe request", role: "user" }]),
      ).rejects.toMatchObject({ name: "AiRefusalError" });

      const incompleteFetcher = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "MAX_TOKENS",
                },
              ],
            }),
            { status: 200 },
          ),
      );

      const incompleteClient = new AiClient(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          style: "google-native",
        }),
        incompleteFetcher,
      );

      await expect(
        incompleteClient.generate([{ content: "long request", role: "user" }]),
      ).rejects.toMatchObject({ name: "AiIncompleteResponseError" });
    });

    it("falls back when a model unexpectedly rejects system_instruction", async () => {
      const fetcher = vi
        .fn()
        // First attempt with systemInstruction fails with 400
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: 400,
                message: "system_instruction is not supported for this model",
                status: "INVALID_ARGUMENT",
              },
            }),
            { status: 400 },
          ),
        )
        // Second fallback attempt without systemInstruction succeeds
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: "Fallback succeeded" }],
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        );

      const client = new AiClient(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "custom-gemini-variant",
          style: "google-native",
        }),
        fetcher,
      );

      const answer = await client.generate([{ content: "hello", role: "user" }]);
      expect(answer).toBe("Fallback succeeded");
      expect(fetcher).toHaveBeenCalledTimes(2);

      // Verify the retry request omits systemInstruction
      const retryBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as {
        systemInstruction?: unknown;
      };
      expect(retryBody.systemInstruction).toBeUndefined();
    });

    it("falls back when a model unexpectedly rejects function calling", async () => {
      const searchService = new SearchService({
        maxResults: 3,
        provider: "duckduckgo",
        timeoutMs: 5000,
      });

      const fetcher = vi
        .fn()
        // First attempt with tools fails with 400
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: 400,
                message: "Function calling is not supported for this model",
                status: "INVALID_ARGUMENT",
              },
            }),
            { status: 400 },
          ),
        )
        // Second fallback attempt without tools succeeds
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: "Answer without tools" }],
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        );

      const client = new AiClient(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-lite",
          style: "google-native",
        }),
        fetcher,
        searchService,
      );

      const answer = await client.generate([{ content: "search for node", role: "user" }]);
      expect(answer).toBe("Answer without tools");
      expect(fetcher).toHaveBeenCalledTimes(2);

      // Verify the retry request omits tools
      const retryBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as {
        tools?: unknown;
      };
      expect(retryBody.tools).toBeUndefined();
    });
  });
});
