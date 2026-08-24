import type { Attachment, ChatInputCommandInteraction, Message } from "discord.js";

const DEFAULT_DISCORD_CHUNK_LIMIT = 1_900;


export function splitDiscordMessage(
  content: string,
  limit = DEFAULT_DISCORD_CHUNK_LIMIT,
): string[] {
  if (limit < 2) {
    throw new Error("Discord chunk limit must be at least 2.");
  }

  if (!content) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < content.length) {
    let end = Math.min(start + limit, content.length);

    if (
      end < content.length &&
      isHighSurrogate(content.charCodeAt(end - 1)) &&
      isLowSurrogate(content.charCodeAt(end))
    ) {
      end -= 1;
    }

    if (end < content.length) {
      const window = content.slice(start, end);
      const minimumBoundary = Math.floor(window.length / 2);
      const newlineBoundary = window.lastIndexOf("\n");
      const spaceBoundary = window.lastIndexOf(" ");
      const preferredBoundary = Math.max(newlineBoundary, spaceBoundary);

      if (preferredBoundary >= minimumBoundary) {
        end = start + preferredBoundary + 1;
      }
    }

    if (end <= start) {
      end = Math.min(start + limit, content.length);
    }

    chunks.push(content.slice(start, end));
    start = end;
  }

  return chunks;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function conversationKey(
  guildId: string | null,
  channelId: string,
  userId: string,
): string {
  return `${guildId ?? "dm"}:${channelId}:${userId}`;
}

const TRACKING_PARAM_PATTERN =
  /^(?:utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|msclkid|mc_eid|_ga|_gl|trk|igshid|ref|ref_src|ref_url|source)$/i;

export function cleanCitationMarkers(text: string): string {
  if (!text) {
    return "";
  }

  // Remove OpenAI Responses citation brackets like 【1†L1-L2】 or 【4:0†source】
  let cleaned = text.replace(/\s*【[^】]*】/g, "");
  // Remove generic bracketed citations like [cite: ...] or [citation: 1]
  cleaned = cleaned.replace(/\s*\[cite:\s*[^\]]+\]/gi, "");
  cleaned = cleaned.replace(/\s*\[citation:\s*\d+\]/gi, "");
  // Clean up any double spaces left before punctuation or within text
  cleaned = cleaned.replace(/[ \t]+([.,!?;:])/g, "$1");
  cleaned = cleaned.replace(/[ \t]{2,}/g, " ");

  return cleaned.trim();
}

const SUPERSCRIPT_MAP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  "a": "ᵃ", "b": "ᵇ", "c": "ᶜ", "d": "ᵈ", "e": "ᵉ",
  "f": "ᶠ", "g": "ᵍ", "h": "ʰ", "i": "ⁱ", "j": "ʲ",
  "k": "ᵏ", "l": "ˡ", "m": "ᵐ", "n": "ⁿ", "o": "ᵒ",
  "p": "ᵖ", "r": "ʳ", "s": "ˢ", "t": "ᵗ", "u": "ᵘ",
  "v": "ᵛ", "w": "ʷ", "x": "ˣ", "y": "ʸ", "z": "ᶻ",
};

const SUBSCRIPT_MAP: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  "a": "ₐ", "e": "ₑ", "h": "ₕ", "i": "ᵢ", "j": "ⱼ",
  "k": "ₖ", "l": "ₗ", "m": "ₘ", "n": "ₙ", "o": "ₒ",
  "p": "ₚ", "r": "ᵣ", "s": "ₛ", "t": "ₜ", "u": "ᵤ",
  "v": "ᵥ", "x": "ₓ",
};

const GREEK_AND_SYMBOLS: Record<string, string> = {
  "\\alpha": "α",
  "\\beta": "β",
  "\\gamma": "γ",
  "\\Gamma": "Γ",
  "\\delta": "δ",
  "\\Delta": "Δ",
  "\\epsilon": "ε",
  "\\varepsilon": "ε",
  "\\zeta": "ζ",
  "\\eta": "η",
  "\\theta": "θ",
  "\\vartheta": "θ",
  "\\Theta": "Θ",
  "\\iota": "ι",
  "\\kappa": "κ",
  "\\lambda": "λ",
  "\\Lambda": "Λ",
  "\\mu": "μ",
  "\\nu": "ν",
  "\\xi": "ξ",
  "\\Xi": "Ξ",
  "\\pi": "π",
  "\\Pi": "Π",
  "\\rho": "ρ",
  "\\varrho": "ρ",
  "\\sigma": "σ",
  "\\Sigma": "Σ",
  "\\tau": "τ",
  "\\upsilon": "υ",
  "\\phi": "φ",
  "\\varphi": "φ",
  "\\Phi": "Φ",
  "\\chi": "χ",
  "\\psi": "ψ",
  "\\Psi": "Ψ",
  "\\omega": "ω",
  "\\Omega": "Ω",
  "\\hbar": "ℏ",
  "\\ell": "ℓ",
  "\\times": "×",
  "\\cdot": "·",
  "\\div": "÷",
  "\\pm": "±",
  "\\mp": "∓",
  "\\circ": "°",
  "\\infty": "∞",
  "\\partial": "∂",
  "\\nabla": "∇",
  "\\approx": "≈",
  "\\neq": "≠",
  "\\ne": "≠",
  "\\leq": "≤",
  "\\le": "≤",
  "\\geq": "≥",
  "\\ge": "≥",
  "\\equiv": "≡",
  "\\sim": "∼",
  "\\propto": "∝",
  "\\int": "∫",
  "\\iint": "∬",
  "\\iiint": "∭",
  "\\oint": "∮",
  "\\sum": "∑",
  "\\prod": "∏",
  "\\to": "→",
  "\\rightarrow": "→",
  "\\leftarrow": "←",
  "\\leftrightarrow": "↔",
  "\\Rightarrow": "⇒",
  "\\Leftarrow": "⇐",
  "\\Leftrightarrow": "⇔",
  "\\implies": "⇒",
  "\\iff": "⇔",
  "\\in": "∈",
  "\\notin": "∉",
  "\\subset": "⊂",
  "\\subseteq": "⊆",
  "\\supset": "⊃",
  "\\supseteq": "⊇",
  "\\cup": "∪",
  "\\cap": "∩",
  "\\emptyset": "∅",
  "\\varnothing": "∅",
  "\\forall": "∀",
  "\\exists": "∃",
  "\\nexists": "∄",
  "\\therefore": "∴",
  "\\because": "∵",
  "\\rangle": "⟩",
  "\\langle": "⟨",
};

const SYMBOL_TOKEN_COMMANDS = new Set([
  "\\alpha", "\\beta", "\\gamma", "\\Gamma", "\\delta", "\\Delta",
  "\\epsilon", "\\varepsilon", "\\zeta", "\\eta", "\\theta", "\\vartheta",
  "\\Theta", "\\iota", "\\kappa", "\\lambda", "\\Lambda", "\\mu",
  "\\nu", "\\xi", "\\Xi", "\\pi", "\\Pi", "\\rho", "\\varrho",
  "\\sigma", "\\Sigma", "\\tau", "\\upsilon", "\\phi", "\\varphi",
  "\\Phi", "\\chi", "\\psi", "\\Psi", "\\omega", "\\Omega",
  "\\hbar", "\\ell", "\\infty", "\\partial", "\\nabla",
]);

export function formatDiscordMath(text: string): string {
  if (!text) {
    return "";
  }

  // Preserve multi-line code blocks
  const parts = text.split(/(```[\s\S]*?```)/g);
  const formattedParts = parts.map((part, index) => {
    if (index % 2 === 1) {
      return part;
    }
    return convertLatexInSegment(part);
  });

  return suppressUrlEmbeds(formattedParts.join(""));
}

export function suppressUrlEmbeds(text: string): string {
  if (!text) {
    return "";
  }

  // Preserve code blocks and inline code
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  const processed = parts.map((part, index) => {
    if (index % 2 === 1) {
      return part;
    }

    // 1. Wrap markdown links [text](http...) -> [text](<http...>) if not already wrapped
    let segment = part.replace(
      /\[([^\]]+)\]\(\s*<?(https?:\/\/[^\s>)]+)>?\s*\)/g,
      "[$1](<$2>)",
    );

    // 2. Wrap standalone URLs that are not already enclosed in < > or markdown brackets
    segment = segment.replace(
      /(?<![<(\[])\b(https?:\/\/[^\s<>()]+)(?![>\])])/g,
      "<$1>",
    );

    return segment;
  });

  return processed.join("");
}

function shouldWrapInParentheses(expr: string, isDenominator = false): boolean {
  const trimmed = expr.trim();
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return false;
  }
  if (/[+*×·/]|(?<=\S)\s*-\s*\S|±|∓/.test(trimmed)) {
    return true;
  }
  if (isDenominator && /^[0-9]+[a-zA-Zα-ωΑ-Ω]/.test(trimmed)) {
    return true;
  }
  return false;
}

function replaceFractions(text: string): string {
  let result = text;
  const fracRegex =
    /\\frac\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})+)\}\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})+)\}/g;

  let iterations = 0;
  while (fracRegex.test(result) && iterations < 5) {
    iterations += 1;
    result = result.replace(fracRegex, (_match, num: string, den: string) => {
      const cleanNum = convertLatexInSegment(num.trim()).trim();
      const cleanDen = convertLatexInSegment(den.trim()).trim();
      if (cleanNum === "1" && cleanDen === "2") return "½ ";
      if (cleanNum === "1" && cleanDen === "3") return "⅓ ";
      if (cleanNum === "2" && cleanDen === "3") return "⅔ ";
      if (cleanNum === "1" && cleanDen === "4") return "¼ ";
      if (cleanNum === "3" && cleanDen === "4") return "¾ ";

      const finalNum = shouldWrapInParentheses(cleanNum, false)
        ? `(${cleanNum})`
        : cleanNum;
      const finalDen = shouldWrapInParentheses(cleanDen, true)
        ? `(${cleanDen})`
        : cleanDen;
      return `${finalNum} / ${finalDen}`;
    });
  }
  return result;
}

function convertLatexInSegment(segment: string): string {
  let result = segment;

  // Replace text macros
  result = result.replace(
    /\\(?:text|mathrm|operatorname|mathit|textnormal)\{([^{}]+)\}/g,
    "$1",
  );
  result = result.replace(/\\(?:mathbf|boldsymbol)\{([^{}]+)\}/g, "**$1**");

  // Square roots (handling nested braces)
  result = result.replace(
    /\\sqrt\[([^{}]+)\]\{((?:[^{}]|\{[^{}]*\})+)\}/g,
    (_match, root: string, content: string) => {
      const supRoot = toSuperscript(root.trim());
      return `${supRoot}√(${convertLatexInSegment(content.trim())})`;
    },
  );
  result = result.replace(
    /\\sqrt\{((?:[^{}]|\{[^{}]*\})+)\}/g,
    (_match, content: string) => {
      return `√(${convertLatexInSegment(content.trim())})`;
    },
  );

  // Greek and mathematical symbols (replace commands without consuming following spacing)
  result = result.replace(/\\([a-zA-Z]+)/g, (_match, name: string) => {
    const fullCmd = `\\${name}`;
    const symbol = GREEK_AND_SYMBOLS[fullCmd];
    return symbol ?? fullCmd;
  });

  // Common physics delta notation: Δ x -> Δx, Δ p -> Δp, Δ t -> Δt
  result = result.replace(/Δ\s+([a-zA-Z])/g, "Δ$1");

  // General fractions
  result = replaceFractions(result);

  // Superscripts
  result = result.replace(/\^\{([^{}]+)\}/g, (_match, exp: string) => {
    return toSuperscript(convertLatexInSegment(exp));
  });
  result = result.replace(/\^([0-9a-zA-Z+-])/g, (_match, char: string) => {
    return SUPERSCRIPT_MAP[char] ?? `^${char}`;
  });

  // Subscripts
  result = result.replace(/_\{([^{}]+)\}/g, (_match, sub: string) => {
    return toSubscript(convertLatexInSegment(sub));
  });
  result = result.replace(/_([0-9a-zA-Z+-])/g, (_match, char: string) => {
    return SUBSCRIPT_MAP[char] ?? `_${char}`;
  });

  // Parentheses & delimiter scaling
  result = result.replace(/\\left\(/g, "(").replace(/\\right\)/g, ")");
  result = result.replace(/\\left\[/g, "[").replace(/\\right\]/g, "]");
  result = result.replace(/\\left\\\{/g, "{").replace(/\\right\\\}/g, "}");
  result = result.replace(/\\left\|/g, "|").replace(/\\right\|/g, "|");

  // LaTeX spacing
  result = result.replace(/\\[,;: ]/g, " ");
  result = result.replace(/\\(?:quad|qquad)/g, "  ");

  // Strip math delimiters ($$ ... $$, $ ... $, \[ ... \], \( ... \))
  result = result.replace(/\$\$([^\$]+)\$\$/g, "$1");
  result = result.replace(/\$([^\$]+)\$/g, "$1");
  result = result.replace(/\\\[([\s\S]+?)\\\]/g, "$1");
  result = result.replace(/\\\(([\s\S]+?)\\\)/g, "$1");

  // Clean double spaces
  result = result.replace(/[ \t]{2,}/g, " ");
  result = result.replace(/[ \t]+([.,!?;:])/g, "$1");

  return result;
}

function toSuperscript(text: string): string {
  if (text === "∞") {
    return "^∞";
  }
  const converted = Array.from(text)
    .map((char) => SUPERSCRIPT_MAP[char] ?? null)
    .join("");
  if (converted.length === text.length && !converted.includes("null")) {
    return converted;
  }
  return `^(${text})`;
}

function toSubscript(text: string): string {
  const converted = Array.from(text)
    .map((char) => SUBSCRIPT_MAP[char] ?? null)
    .join("");
  if (converted.length === text.length) {
    return converted;
  }
  return `_(${text})`;
}


export function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return rawUrl;
    }

    const keysToDelete: string[] = [];
    url.searchParams.forEach((_value, key) => {
      if (TRACKING_PARAM_PATTERN.test(key)) {
        keysToDelete.push(key);
      }
    });

    for (const key of keysToDelete) {
      url.searchParams.delete(key);
    }

    let href = url.href;
    if (href.endsWith("#")) {
      href = href.slice(0, -1);
    }

    return href;
  } catch {
    return rawUrl;
  }
}

export function extractDomainLabel(urlString: string): string {
  try {
    const parsed = new URL(urlString);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("www.")) {
      host = host.slice(4);
    }
    return host || urlString;
  } catch {
    return urlString;
  }
}

export function formatSourceList(
  urls: readonly string[],
  limit = 5,
): string {
  const seen = new Set<string>();
  const sanitizedSources: Array<{ domain: string; href: string }> = [];

  for (const raw of urls) {
    if (typeof raw !== "string" || !raw.trim()) {
      continue;
    }
    const clean = sanitizeUrl(raw.trim());
    try {
      const parsed = new URL(clean);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }
      const canonicalHost = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const normalizedKey = `${parsed.protocol}//${canonicalHost}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
      if (!seen.has(normalizedKey)) {
        seen.add(normalizedKey);
        sanitizedSources.push({
          domain: extractDomainLabel(clean),
          href: clean,
        });
      }
    } catch {
      // Ignore malformed URLs
    }
  }

  if (sanitizedSources.length === 0) {
    return "";
  }

  const selected = sanitizedSources.slice(0, limit);
  const items = selected.map(
    (source) => `- [${source.domain}](<${source.href}>)`,
  );

  return `**Sources & References**\n${items.join("\n")}`;
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|tiff)$/i;

export function isImageAttachment(
  attachment: { contentType?: string | null; name?: string | null; url?: string | null },
): boolean {
  if (attachment.contentType && attachment.contentType.toLowerCase().startsWith("image/")) {
    return true;
  }
  if (attachment.name && IMAGE_EXTENSIONS.test(attachment.name)) {
    return true;
  }
  if (attachment.url) {
    try {
      const pathname = new URL(attachment.url).pathname;
      if (IMAGE_EXTENSIONS.test(pathname)) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

export async function fetchImageAsDataUrl(
  url: string,
  signal?: AbortSignal,
  maxBytes = 20 * 1024 * 1024,
): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    timeout.unref?.();

    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        return url;
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) {
        return url;
      }

      const base64 = Buffer.from(buffer).toString("base64");
      return `data:${contentType.split(";")[0]};base64,${base64}`;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  } catch {
    return url;
  }
}

export async function extractImagesFromMessage(
  message: Message,
  maxImages = 4,
): Promise<string[]> {
  const imageUrls: string[] = [];

  for (const attachment of message.attachments.values()) {
    if (isImageAttachment(attachment)) {
      imageUrls.push(attachment.url);
      if (imageUrls.length >= maxImages) break;
    }
  }

  // If no images found on this message and it is a reply, check the referenced message
  if (imageUrls.length === 0 && message.reference?.messageId) {
    try {
      const referenced = await message.fetchReference();
      for (const attachment of referenced.attachments.values()) {
        if (isImageAttachment(attachment)) {
          imageUrls.push(attachment.url);
          if (imageUrls.length >= maxImages) break;
        }
      }
    } catch {
      // Ignore reference fetch errors
    }
  }

  if (imageUrls.length === 0) {
    return [];
  }

  return Promise.all(
    imageUrls.slice(0, maxImages).map((url) => fetchImageAsDataUrl(url)),
  );
}

export async function extractImagesFromInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<string[]> {
  const attachment = interaction.options.getAttachment("image");
  if (!attachment || !isImageAttachment(attachment)) {
    return [];
  }

  const dataUrl = await fetchImageAsDataUrl(attachment.url);
  return [dataUrl];
}


