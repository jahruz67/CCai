import { describe, expect, it, vi } from "vitest";
import {
  cleanCitationMarkers,
  conversationKey,
  extractDomainLabel,
  extractImagesFromInteraction,
  extractImagesFromMessage,
  fetchImageAsDataUrl,
  formatDiscordMath,
  formatSourceList,
  isImageAttachment,
  sanitizeUrl,
  splitDiscordMessage,
  suppressUrlEmbeds,
} from "../src/message-utils.js";


describe("splitDiscordMessage", () => {
  it("returns no chunks for empty content", () => {
    expect(splitDiscordMessage("")).toEqual([]);
  });

  it.each([1_999, 2_000, 2_001])(
    "preserves a %i-character message within Discord limits",
    (length) => {
      const input = "x".repeat(length);
      const chunks = splitDiscordMessage(input, 2_000);
      expect(chunks.join("")).toBe(input);
      expect(chunks.every((chunk) => chunk.length <= 2_000)).toBe(true);
      expect(chunks.every(Boolean)).toBe(true);
    },
  );

  it("prefers whitespace boundaries without losing content", () => {
    const input = `${"a".repeat(8)} two words`;
    const chunks = splitDiscordMessage(input, 12);
    expect(chunks).toHaveLength(2);
    expect(chunks.join("")).toBe(input);
    expect(chunks[0]?.endsWith(" ")).toBe(true);
  });

  it("does not split a surrogate pair", () => {
    const input = `${"a".repeat(9)}😀tail`;
    const chunks = splitDiscordMessage(input, 10);
    expect(chunks.join("")).toBe(input);
    expect(chunks.every((chunk) => !chunk.includes("�"))).toBe(true);
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
  });
});

describe("conversationKey", () => {
  it("isolates users, channels, guilds, and DMs", () => {
    expect(conversationKey("1", "2", "3")).toBe("1:2:3");
    expect(conversationKey(null, "2", "3")).toBe("dm:2:3");
    expect(conversationKey("1", "2", "3")).not.toBe(
      conversationKey("1", "2", "4"),
    );
  });
});

describe("cleanCitationMarkers", () => {
  it("removes OpenAI Responses citation markers cleanly", () => {
    expect(cleanCitationMarkers("Newton's second law is F = ma【1†L1-L2】.")).toBe(
      "Newton's second law is F = ma.",
    );
    expect(
      cleanCitationMarkers("According to NASA 【4:0†source】 the rover landed."),
    ).toBe("According to NASA the rover landed.");
    expect(
      cleanCitationMarkers("Gravitational acceleration is 9.81 m/s²【12†https://example.com】."),
    ).toBe("Gravitational acceleration is 9.81 m/s².");
  });

  it("removes generic bracketed citations", () => {
    expect(cleanCitationMarkers("Fact one [cite: source.com] and fact two.")).toBe(
      "Fact one and fact two.",
    );
    expect(cleanCitationMarkers("Clinical trial result [citation: 3].")).toBe(
      "Clinical trial result.",
    );
  });

  it("handles empty and plain strings", () => {
    expect(cleanCitationMarkers("")).toBe("");
    expect(cleanCitationMarkers("Plain text without markers")).toBe(
      "Plain text without markers",
    );
  });
});

describe("sanitizeUrl", () => {
  it("strips tracking query parameters while preserving legitimate ones", () => {
    const raw =
      "https://www.reuters.com/world/article?utm_source=twitter&utm_medium=social&utm_campaign=breaking&id=123&fbclid=XYZ123";
    const sanitized = sanitizeUrl(raw);
    expect(sanitized).toBe("https://www.reuters.com/world/article?id=123");
  });

  it("removes empty trailing hash", () => {
    expect(sanitizeUrl("https://example.com/page#")).toBe(
      "https://example.com/page",
    );
    expect(sanitizeUrl("https://example.com/page#section")).toBe(
      "https://example.com/page#section",
    );
  });

  it("returns malformed URLs unchanged", () => {
    expect(sanitizeUrl("not-a-valid-url")).toBe("not-a-valid-url");
  });
});

describe("extractDomainLabel", () => {
  it("extracts clean domain without www prefix", () => {
    expect(extractDomainLabel("https://www.nature.com/articles/s41586")).toBe(
      "nature.com",
    );
    expect(extractDomainLabel("https://cdc.gov/flu/index.html")).toBe("cdc.gov");
    expect(extractDomainLabel("https://arxiv.org/abs/2301.00001")).toBe(
      "arxiv.org",
    );
  });
});

describe("formatSourceList", () => {
  it("formats sources with domain labels, embed suppression, and deduplication", () => {
    const urls = [
      "https://www.nasa.gov/mission_pages/webb?utm_source=news",
      "https://nasa.gov/mission_pages/webb",
      "https://www.reuters.com/technology/article1",
    ];

    const result = formatSourceList(urls);
    expect(result).toBe(
      "**Sources & References**\n- [nasa.gov](<https://www.nasa.gov/mission_pages/webb>)\n- [reuters.com](<https://www.reuters.com/technology/article1>)",
    );
  });

  it("returns empty string when given no valid URLs", () => {
    expect(formatSourceList([])).toBe("");
    expect(formatSourceList(["", "invalid-url"])).toBe("");
  });

  it("respects the custom source limit", () => {
    const urls = [
      "https://site1.org/a",
      "https://site2.org/b",
      "https://site3.org/c",
    ];
    const result = formatSourceList(urls, 2);
    expect(result.split("\n")).toHaveLength(3); // header + 2 items
    expect(result).toContain("site1.org");
    expect(result).toContain("site2.org");
    expect(result).not.toContain("site3.org");
  });
});

describe("formatDiscordMath", () => {
  it("formats inline and block LaTeX formulas into clean Discord math", () => {
    expect(formatDiscordMath("$E = mc^2$")).toBe("E = mc²");
    expect(formatDiscordMath("$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$")).toBe(
      "x = (-b ± √(b² - 4ac)) / (2a)",
    );
    expect(formatDiscordMath("\\lambda = \\frac{h}{p}")).toBe("λ = h / p");
  });

  it("converts Greek letters, calculus symbols, and common fractions", () => {
    expect(formatDiscordMath("\\Delta x \\Delta p \\ge \\frac{\\hbar}{2}")).toBe(
      "Δx Δp ≥ ℏ / 2",
    );
    expect(
      formatDiscordMath("Kinetic energy: \\frac{1}{2}mv^2 + \\frac{1}{3}kx^3"),
    ).toBe("Kinetic energy: ½ mv² + ⅓ kx³");
    expect(formatDiscordMath("\\int_{0}^{\\infty} e^{-x} dx = 1")).toBe(
      "∫₀^∞ e⁻ˣ dx = 1",
    );
  });

  it("preserves fenced code blocks without converting LaTeX inside them", () => {
    const input =
      "Here is the formula:\n```latex\n\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n```\nAnd in chat: $E = mc^2$";
    const result = formatDiscordMath(input);
    expect(result).toContain("```latex\n\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n```");
    expect(result).toContain("And in chat: E = mc²");
  });

  it("handles empty or plain text without math", () => {
    expect(formatDiscordMath("")).toBe("");
    expect(formatDiscordMath("Hello world!")).toBe("Hello world!");
  });
});

describe("suppressUrlEmbeds", () => {
  it("wraps raw markdown links in angle brackets", () => {
    expect(suppressUrlEmbeds("Check [Site](https://example.com) for info")).toBe(
      "Check [Site](<https://example.com>) for info",
    );
  });

  it("does not double-wrap already wrapped links", () => {
    expect(suppressUrlEmbeds("Check [Site](<https://example.com>) for info")).toBe(
      "Check [Site](<https://example.com>) for info",
    );
  });

  it("wraps bare URLs to suppress Discord embed previews", () => {
    expect(suppressUrlEmbeds("Visit https://example.com/page today")).toBe(
      "Visit <https://example.com/page> today",
    );
    expect(suppressUrlEmbeds("Already <https://example.com/page>")).toBe(
      "Already <https://example.com/page>",
    );
  });

  it("preserves URLs inside fenced code blocks and inline code", () => {
    const text = "```\nhttps://example.com\n``` and `https://test.org` outside: https://live.com";
    expect(suppressUrlEmbeds(text)).toBe(
      "```\nhttps://example.com\n``` and `https://test.org` outside: <https://live.com>",
    );
  });
});

describe("isImageAttachment", () => {
  it("recognizes image MIME types", () => {
    expect(isImageAttachment({ contentType: "image/png" })).toBe(true);
    expect(isImageAttachment({ contentType: "image/jpeg" })).toBe(true);
    expect(isImageAttachment({ contentType: "image/webp" })).toBe(true);
    expect(isImageAttachment({ contentType: "image/gif" })).toBe(true);
    expect(isImageAttachment({ contentType: "application/pdf" })).toBe(false);
  });

  it("recognizes image file extensions", () => {
    expect(isImageAttachment({ name: "photo.jpg" })).toBe(true);
    expect(isImageAttachment({ name: "diagram.PNG" })).toBe(true);
    expect(isImageAttachment({ name: "doc.txt" })).toBe(false);
  });

  it("recognizes image extensions in URL pathname", () => {
    expect(isImageAttachment({ url: "https://cdn.discordapp.com/attachments/1/2/test.webp" })).toBe(true);
    expect(isImageAttachment({ url: "https://example.com/data.json" })).toBe(false);
  });
});

describe("fetchImageAsDataUrl", () => {
  it("converts fetched image to base64 data url", async () => {
    const fakeBuffer = new TextEncoder().encode("fake-image-bytes").buffer;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(fakeBuffer, {
        headers: { "content-type": "image/png" },
        status: 200,
      }),
    );

    const result = await fetchImageAsDataUrl("https://example.com/test.png");
    expect(result).toMatch(/^data:image\/png;base64,/);
    fetchSpy.mockRestore();
  });

  it("falls back to raw URL on fetch error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));
    const result = await fetchImageAsDataUrl("https://example.com/test.png");
    expect(result).toBe("https://example.com/test.png");
    fetchSpy.mockRestore();
  });
});

describe("extractImagesFromMessage", () => {
  it("extracts images from direct message attachments", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new TextEncoder().encode("img").buffer, {
        headers: { "content-type": "image/jpeg" },
        status: 200,
      }),
    );

    const mockMessage = {
      attachments: new Map([
        ["1", { contentType: "image/jpeg", url: "https://example.com/img1.jpg" }],
        ["2", { contentType: "text/plain", url: "https://example.com/doc.txt" }],
      ]),
    } as unknown as import("discord.js").Message;

    const urls = await extractImagesFromMessage(mockMessage);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^data:image\/jpeg;base64,/);
    fetchSpy.mockRestore();
  });

  it("extracts images from referenced message when reply has no attachments", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new TextEncoder().encode("img").buffer, {
        headers: { "content-type": "image/png" },
        status: 200,
      }),
    );

    const mockMessage = {
      attachments: new Map(),
      fetchReference: async () => ({
        attachments: new Map([
          ["1", { contentType: "image/png", url: "https://example.com/ref.png" }],
        ]),
      }),
      reference: { messageId: "123" },
    } as unknown as import("discord.js").Message;

    const urls = await extractImagesFromMessage(mockMessage);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^data:image\/png;base64,/);
    fetchSpy.mockRestore();
  });
});

describe("extractImagesFromInteraction", () => {
  it("extracts image from slash command option", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new TextEncoder().encode("img").buffer, {
        headers: { "content-type": "image/webp" },
        status: 200,
      }),
    );

    const mockInteraction = {
      options: {
        getAttachment: (name: string) =>
          name === "image"
            ? { contentType: "image/webp", url: "https://example.com/img.webp" }
            : null,
      },
    } as unknown as import("discord.js").ChatInputCommandInteraction;

    const urls = await extractImagesFromInteraction(mockInteraction);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^data:image\/webp;base64,/);
    fetchSpy.mockRestore();
  });

  it("returns empty array if no image attachment", async () => {
    const mockInteraction = {
      options: {
        getAttachment: () => null,
      },
    } as unknown as import("discord.js").ChatInputCommandInteraction;

    const urls = await extractImagesFromInteraction(mockInteraction);
    expect(urls).toEqual([]);
  });
});



