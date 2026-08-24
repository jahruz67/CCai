import type { BotConfig } from "./config.js";
import { cleanCitationMarkers, formatSourceList, sanitizeUrl } from "./message-utils.js";

export interface SearchResult {
  snippet: string;
  title: string;
  url: string;
}

export interface SearchProvider {
  readonly name: string;
  search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]>;
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export class DuckDuckGoSearchProvider implements SearchProvider {
  public readonly name = "duckduckgo";

  public constructor(private readonly fetcher: FetchLike = fetch) {}

  public async search(
    query: string,
    maxResults = 5,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const results = await this.searchHtml(trimmed, maxResults, signal);
      if (results.length > 0) {
        return results;
      }
    } catch {
      // Fall through to instant answer API if HTML search encounters an issue
    }

    return this.searchInstantApi(trimmed, maxResults, signal);
  }

  private async searchHtml(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await this.fetcher(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": DEFAULT_USER_AGENT,
      },
      method: "GET",
      signal,
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    return parseDuckDuckGoHtml(html, maxResults);
  }

  private async searchInstantApi(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const response = await this.fetcher(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": DEFAULT_USER_AGENT,
        },
        method: "GET",
        signal,
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        RelatedTopics?: Array<{
          FirstURL?: string;
          Text?: string;
          Topics?: Array<{ FirstURL?: string; Text?: string }>;
        }>;
      };

      const results: SearchResult[] = [];

      if (data.AbstractText && data.AbstractURL) {
        results.push({
          snippet: data.AbstractText,
          title: data.Heading || query,
          url: sanitizeUrl(data.AbstractURL),
        });
      }

      for (const topic of data.RelatedTopics ?? []) {
        if (results.length >= maxResults) {
          break;
        }

        if (topic.Topics) {
          for (const subTopic of topic.Topics) {
            if (results.length >= maxResults) {
              break;
            }
            if (subTopic.FirstURL && subTopic.Text) {
              results.push({
                snippet: subTopic.Text,
                title: subTopic.Text.slice(0, 80),
                url: sanitizeUrl(subTopic.FirstURL),
              });
            }
          }
        } else if (topic.FirstURL && topic.Text) {
          results.push({
            snippet: topic.Text,
            title: topic.Text.slice(0, 80),
            url: sanitizeUrl(topic.FirstURL),
          });
        }
      }

      return results.slice(0, maxResults);
    } catch {
      return [];
    }
  }
}

export class TavilySearchProvider implements SearchProvider {
  public readonly name = "tavily";

  public constructor(
    private readonly apiKey: string,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  public async search(
    query: string,
    maxResults = 5,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed || !this.apiKey) {
      return [];
    }

    const response = await this.fetcher("https://api.tavily.com/search", {
      body: JSON.stringify({
        api_key: this.apiKey,
        include_answer: false,
        max_results: maxResults,
        query: trimmed,
        search_depth: "basic",
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    });

    if (!response.ok) {
      throw new Error(`Tavily search failed with HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      results?: Array<{
        content?: string;
        title?: string;
        url?: string;
      }>;
    };

    return (data.results ?? []).slice(0, maxResults).map((item) => ({
      snippet: item.content?.trim() ?? "",
      title: item.title?.trim() ?? "",
      url: sanitizeUrl(item.url?.trim() ?? ""),
    }));
  }
}

export class BraveSearchProvider implements SearchProvider {
  public readonly name = "brave";

  public constructor(
    private readonly apiKey: string,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  public async search(
    query: string,
    maxResults = 5,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed || !this.apiKey) {
      return [];
    }

    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(trimmed)}&count=${maxResults}`;
    const response = await this.fetcher(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.apiKey,
      },
      method: "GET",
      signal,
    });

    if (!response.ok) {
      throw new Error(`Brave search failed with HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      web?: {
        results?: Array<{
          description?: string;
          title?: string;
          url?: string;
        }>;
      };
    };

    return (data.web?.results ?? []).slice(0, maxResults).map((item) => ({
      snippet: item.description?.trim() ?? "",
      title: item.title?.trim() ?? "",
      url: sanitizeUrl(item.url?.trim() ?? ""),
    }));
  }
}

export class SearxngSearchProvider implements SearchProvider {
  public readonly name = "searxng";

  public constructor(
    private readonly baseUrl: string,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  public async search(
    query: string,
    maxResults = 5,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed || !this.baseUrl) {
      return [];
    }

    const base = this.baseUrl.replace(/\/+$/, "");
    const url = `${base}/search?q=${encodeURIComponent(trimmed)}&format=json`;
    const response = await this.fetcher(url, {
      headers: {
        Accept: "application/json",
      },
      method: "GET",
      signal,
    });

    if (!response.ok) {
      throw new Error(`SearXNG search failed with HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      results?: Array<{
        content?: string;
        title?: string;
        url?: string;
      }>;
    };

    return (data.results ?? []).slice(0, maxResults).map((item) => ({
      snippet: item.content?.trim() ?? "",
      title: item.title?.trim() ?? "",
      url: sanitizeUrl(item.url?.trim() ?? ""),
    }));
  }
}

export class SearchService {
  private readonly primaryProvider: SearchProvider;
  private readonly fallbackProvider: SearchProvider;
  private readonly maxResults: number;
  private readonly timeoutMs: number;

  public constructor(
    config: BotConfig["search"],
    fetcher: FetchLike = fetch,
  ) {
    this.maxResults = config.maxResults;
    this.timeoutMs = config.timeoutMs;
    this.fallbackProvider = new DuckDuckGoSearchProvider(fetcher);

    if (config.provider === "tavily" && config.tavilyApiKey) {
      this.primaryProvider = new TavilySearchProvider(config.tavilyApiKey, fetcher);
    } else if (config.provider === "brave" && config.braveApiKey) {
      this.primaryProvider = new BraveSearchProvider(config.braveApiKey, fetcher);
    } else if (config.provider === "searxng" && config.searxngBaseUrl) {
      this.primaryProvider = new SearxngSearchProvider(config.searxngBaseUrl, fetcher);
    } else if (config.provider === "auto") {
      if (config.tavilyApiKey) {
        this.primaryProvider = new TavilySearchProvider(config.tavilyApiKey, fetcher);
      } else if (config.braveApiKey) {
        this.primaryProvider = new BraveSearchProvider(config.braveApiKey, fetcher);
      } else if (config.searxngBaseUrl) {
        this.primaryProvider = new SearxngSearchProvider(config.searxngBaseUrl, fetcher);
      } else {
        this.primaryProvider = this.fallbackProvider;
      }
    } else {
      this.primaryProvider = this.fallbackProvider;
    }
  }

  public async search(
    query: string,
    limit = this.maxResults,
    externalSignal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();

    const abortFromCaller = () => controller.abort();
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      let results: SearchResult[] = [];
      try {
        results = await this.primaryProvider.search(
          trimmed,
          limit,
          controller.signal,
        );
      } catch {
        if (this.primaryProvider !== this.fallbackProvider) {
          results = await this.fallbackProvider.search(
            trimmed,
            limit,
            controller.signal,
          );
        }
      }

      if (results.length === 0 && this.primaryProvider !== this.fallbackProvider) {
        results = await this.fallbackProvider.search(
          trimmed,
          limit,
          controller.signal,
        );
      }

      return results.filter((item) => item.title && item.url);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  public formatResultsForPrompt(results: readonly SearchResult[]): string {
    if (results.length === 0) {
      return "No web search results found for this query.";
    }

    return results
      .map((item, index) => {
        const title = item.title.trim();
        const url = item.url.trim();
        const snippet = item.snippet.trim();
        return `[${index + 1}] "${title}"\nURL: ${url}\nSummary: ${snippet}`;
      })
      .join("\n\n");
  }

  public formatResultsForDiscord(
    query: string,
    results: readonly SearchResult[],
  ): string {
    if (results.length === 0) {
      return `No web search results found for **${query}**.`;
    }

    const formattedList = results
      .slice(0, this.maxResults)
      .map((item, index) => {
        const title = cleanCitationMarkers(item.title.trim());
        const snippet = cleanCitationMarkers(item.snippet.trim());
        return `**${index + 1}. [${title}](<${item.url}>)**\n${snippet}`;
      })
      .join("\n\n");

    const urls = results.map((r) => r.url);
    const sourceSection = formatSourceList(urls);

    return `### Search Results for "${query}"\n\n${formattedList}\n\n${sourceSection}`;
  }
}

export function parseDuckDuckGoHtml(
  html: string,
  maxResults = 5,
): SearchResult[] {
  const results: SearchResult[] = [];
  const linkBlocks = html.split(
    /<div[^>]+class="[^"]*result\s+results_links[^"]*"[^>]*>/i,
  );

  for (let i = 1; i < linkBlocks.length && results.length < maxResults; i++) {
    const block = linkBlocks[i]!;
    const titleMatch = block.match(
      /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    const snippetMatch = block.match(
      /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i,
    );

    if (titleMatch) {
      let rawHref = titleMatch[1]!;
      try {
        const parsedUrl = new URL(rawHref, "https://html.duckduckgo.com");
        const uddg = parsedUrl.searchParams.get("uddg");
        if (uddg) {
          rawHref = decodeURIComponent(uddg);
        }
      } catch {
        // Leave rawHref as-is
      }

      const cleanTitle = decodeHtmlEntities(
        titleMatch[2]!.replace(/<[^>]+>/g, ""),
      ).trim();
      const cleanSnippet = snippetMatch
        ? decodeHtmlEntities(snippetMatch[1]!.replace(/<[^>]+>/g, "")).trim()
        : "";

      const sanitized = sanitizeUrl(rawHref);
      if (sanitized && (sanitized.startsWith("http://") || sanitized.startsWith("https://"))) {
        results.push({
          snippet: cleanSnippet,
          title: cleanTitle,
          url: sanitized,
        });
      }
    }
  }

  return results;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(Number(dec)));
}
