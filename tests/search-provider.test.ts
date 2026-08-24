import { describe, expect, it, vi } from "vitest";
import {
  BraveSearchProvider,
  DuckDuckGoSearchProvider,
  SearxngSearchProvider,
  SearchService,
  TavilySearchProvider,
  parseDuckDuckGoHtml,
} from "../src/search-provider.js";

const SAMPLE_DDG_HTML = `
<!DOCTYPE html>
<html>
<body>
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fen%2Fabout&amp;rut=123">Node.js &amp; Javascript</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fen%2Fabout">Node.js is an open-source &quot;cross-platform&quot; JavaScript runtime environment.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a class="result__a" href="https://example.com/news?utm_source=tracker">Example News &lt;Update&gt;</a>
    </h2>
    <a class="result__snippet" href="https://example.com/news">Breaking developments in technology &#39;today&#39;.</a>
  </div>
</div>
</body>
</html>
`;

describe("DuckDuckGo HTML Parser", () => {
  it("parses titles, redirects, and snippets while stripping trackers and entities", () => {
    const results = parseDuckDuckGoHtml(SAMPLE_DDG_HTML, 5);
    expect(results).toHaveLength(2);

    expect(results[0]).toEqual({
      snippet: 'Node.js is an open-source "cross-platform" JavaScript runtime environment.',
      title: "Node.js & Javascript",
      url: "https://nodejs.org/en/about",
    });

    expect(results[1]).toEqual({
      snippet: "Breaking developments in technology 'today'.",
      title: "Example News <Update>",
      url: "https://example.com/news",
    });
  });

  it("respects maxResults limit", () => {
    const results = parseDuckDuckGoHtml(SAMPLE_DDG_HTML, 1);
    expect(results).toHaveLength(1);
  });
});

describe("DuckDuckGoSearchProvider", () => {
  it("fetches results from html.duckduckgo.com", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(SAMPLE_DDG_HTML, { status: 200 }),
    );

    const provider = new DuckDuckGoSearchProvider(fetcher);
    const results = await provider.search("nodejs runtime", 5);

    expect(fetcher).toHaveBeenCalledOnce();
    const url = String(fetcher.mock.calls[0]?.[0]);
    expect(url).toContain("https://html.duckduckgo.com/html/?q=nodejs%20runtime");
    expect(results).toHaveLength(2);
  });

  it("falls back to DuckDuckGo Instant API if HTML search returns empty or fails", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("<html><body>No results</body></html>", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            AbstractText: "Node.js overview",
            AbstractURL: "https://nodejs.org",
            Heading: "Node.js",
            RelatedTopics: [
              {
                FirstURL: "https://example.com/topic",
                Text: "Related topic text",
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const provider = new DuckDuckGoSearchProvider(fetcher);
    const results = await provider.search("nodejs", 5);

    expect(results).toHaveLength(2);
    expect(results[0]?.title).toBe("Node.js");
    expect(results[0]?.url).toBe("https://nodejs.org/");
    expect(results[1]?.title).toBe("Related topic text");
  });
});

describe("TavilySearchProvider", () => {
  it("sends structured POST request to Tavily endpoint", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [
              {
                content: "Detailed AI search answer snippet",
                title: "AI Research",
                url: "https://example.org/ai?utm_source=ref",
              },
            ],
          }),
          { status: 200 },
        ),
    );

    const provider = new TavilySearchProvider("tavily_test_key", fetcher);
    const results = await provider.search("ai research", 3);

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.tavily.com/search");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      api_key: "tavily_test_key",
      max_results: 3,
      query: "ai research",
    });
    expect(results).toEqual([
      {
        snippet: "Detailed AI search answer snippet",
        title: "AI Research",
        url: "https://example.org/ai",
      },
    ]);
  });
});

describe("BraveSearchProvider", () => {
  it("sends GET request with subscription token", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  description: "Brave search snippet",
                  title: "Brave Title",
                  url: "https://brave.com",
                },
              ],
            },
          }),
          { status: 200 },
        ),
    );

    const provider = new BraveSearchProvider("brave_key", fetcher);
    const results = await provider.search("brave query", 2);

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(
      "https://api.search.brave.com/res/v1/web/search?q=brave%20query&count=2",
    );
    expect(init?.headers).toMatchObject({
      "X-Subscription-Token": "brave_key",
    });
    expect(results[0]?.title).toBe("Brave Title");
  });
});

describe("SearxngSearchProvider", () => {
  it("queries SearXNG JSON endpoint", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [
              {
                content: "Searxng snippet",
                title: "Searxng Result",
                url: "https://searx.space",
              },
            ],
          }),
          { status: 200 },
        ),
    );

    const provider = new SearxngSearchProvider(
      "https://searx.example.org",
      fetcher,
    );
    const results = await provider.search("searx query", 5);

    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://searx.example.org/search?q=searx%20query&format=json",
    );
    expect(results[0]?.title).toBe("Searxng Result");
  });
});

describe("SearchService", () => {
  it("defaults to DuckDuckGo when provider is duckduckgo or auto without keys", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(SAMPLE_DDG_HTML, { status: 200 }),
    );

    const service = new SearchService(
      {
        maxResults: 5,
        provider: "duckduckgo",
        timeoutMs: 5_000,
      },
      fetcher,
    );

    const results = await service.search("sample search");
    expect(results).toHaveLength(2);
  });

  it("formats prompt context and Discord display strings", () => {
    const service = new SearchService({
      maxResults: 2,
      provider: "duckduckgo",
      timeoutMs: 5_000,
    });

    const sampleResults = [
      {
        snippet: "First snippet",
        title: "First Title",
        url: "https://first.example.com",
      },
      {
        snippet: "Second snippet",
        title: "Second Title",
        url: "https://second.example.com",
      },
    ];

    const promptText = service.formatResultsForPrompt(sampleResults);
    expect(promptText).toContain('[1] "First Title"');
    expect(promptText).toContain("URL: https://first.example.com");

    const discordText = service.formatResultsForDiscord(
      "test query",
      sampleResults,
    );
    expect(discordText).toContain('### Search Results for "test query"');
    expect(discordText).toContain("[First Title](<https://first.example.com>)");
    expect(discordText).toContain("**Sources & References**");
  });

  it("falls back to DuckDuckGo if primary provider fails", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("Tavily network error"))
      .mockResolvedValueOnce(new Response(SAMPLE_DDG_HTML, { status: 200 }));

    const service = new SearchService(
      {
        maxResults: 5,
        provider: "tavily",
        tavilyApiKey: "bad_key",
        timeoutMs: 5_000,
      },
      fetcher,
    );

    const results = await service.search("fallback test");
    expect(results).toHaveLength(2);
    expect(results[0]?.title).toBe("Node.js & Javascript");
  });
});
