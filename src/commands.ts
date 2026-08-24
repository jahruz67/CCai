import { SlashCommandBuilder } from "discord.js";

export type BuiltInCommand = "clear" | "help" | "ping";

export interface ParsedRemember {
  isServerScope: boolean;
  key: string;
  value: string;
}

export interface ParsedForget {
  isAll: boolean;
  isServerScope: boolean;
  key: string;
}

export interface ParsedMemoryList {
  scope: "all" | "personal" | "server";
}

export const slashCommands = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask CC a question")
    .addStringOption((option) =>
      option
        .setName("question")
        .setDescription("What do you want to ask?")
        .setMaxLength(4_000)
        .setRequired(true),
    )
    .addAttachmentOption((option) =>
      option
        .setName("image")
        .setDescription("Optional image to include with your question")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search the web for real-time information and sources")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("What do you want to search for?")
        .setMaxLength(1_000)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("remember")
    .setDescription("Teach CC an abbreviation, definition, or fact to remember")
    .addStringOption((option) =>
      option
        .setName("key")
        .setDescription("Abbreviation, term, or topic (e.g. BRB, tz, my favorite language)")
        .setMaxLength(100)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("value")
        .setDescription("Definition, expansion, or fact (e.g. Be Right Back, EST, TypeScript)")
        .setMaxLength(1_000)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription("Scope for this memory (Personal for only you, Server for everyone here)")
        .setRequired(false)
        .addChoices(
          { name: "Personal (Only Me)", value: "personal" },
          { name: "Server (Everyone in this server)", value: "server" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("forget")
    .setDescription("Delete a saved memory or abbreviation from CC")
    .addStringOption((option) =>
      option
        .setName("key")
        .setDescription("The abbreviation or memory key to forget, or 'all' to wipe")
        .setMaxLength(100)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription("Scope to delete from")
        .setRequired(false)
        .addChoices(
          { name: "Personal", value: "personal" },
          { name: "Server", value: "server" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("memory")
    .setDescription("View your saved memories, abbreviations, and facts")
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription("Filter by scope")
        .setRequired(false)
        .addChoices(
          { name: "All", value: "all" },
          { name: "Personal Only", value: "personal" },
          { name: "Server Only", value: "server" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("manage")
    .setDescription("Plan, confirm, or cancel AI-assisted server administration")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("request")
        .setDescription("Describe the server-management task")
        .addStringOption((option) =>
          option
            .setName("instruction")
            .setDescription("For example: create a text channel named announcements")
            .setMaxLength(2_000)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("confirm")
        .setDescription("Execute your exact pending management plan"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cancel")
        .setDescription("Cancel your pending management plan"),
    ),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Clear your recent conversation with CC in this channel"),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show how to use CC"),
  new SlashCommandBuilder().setName("ping").setDescription("Check whether CC is online"),
].map((command) => command.toJSON());

export function parseBuiltInCommand(text: string): BuiltInCommand | undefined {
  const command = text.trim().toLowerCase();
  if (command === "clear" || command === "reset") {
    return "clear";
  }
  if (command === "help") {
    return "help";
  }
  if (command === "ping") {
    return "ping";
  }
  return undefined;
}

export function parseSearchCommand(text: string): string | undefined {
  const match = text.trim().match(/^search(?:\s+(.+))?$/i);
  return match ? (match[1]?.trim() ?? "") : undefined;
}

export function parseRememberCommand(text: string): ParsedRemember | undefined {
  const trimmed = text.trim();
  // Also accept "save" as an alias for "remember"
  const match = trimmed.match(/^(?:please\s+)?(?:remember|save):?(?:\s+(.+))?$/i);
  if (!match || !match[1]) {
    return undefined;
  }

  let rest = match[1].trim();
  let isServerScope = false;

  // Check for server scope tags like "[server] ...", "server: ...", or "server ..."
  const serverScopeMatch = rest.match(/^(?:\[server\]|server:?)\s+(.+)$/i);
  if (serverScopeMatch && serverScopeMatch[1]) {
    isServerScope = true;
    rest = serverScopeMatch[1].trim();
  }

  // Strip leading "that " (e.g. "remember that my name is...")
  if (/^that\s+/i.test(rest)) {
    rest = rest.replace(/^that\s+/i, "").trim();
  }

  // Strip optional "abbreviation" or "abbrev" prefix: e.g. "abbreviation BRB = Be Right Back"
  const abbrevMatch = rest.match(/^(?:abbreviation|abbrev|abbr)\s+(.+)$/i);
  if (abbrevMatch && abbrevMatch[1]) {
    rest = abbrevMatch[1].trim();
  }

  // Look for separators: '=', ':', '->', '=>', ' stands for ', ' means ', or ' is '
  const delimiterMatch = rest.match(
    /^(.+?)\s*(?:=|=>|->|:|\s+stands\s+for\s+|\s+means\s+|\s+is\s+)\s*(.+)$/i,
  );
  if (delimiterMatch && delimiterMatch[1] && delimiterMatch[2]) {
    return {
      isServerScope,
      key: delimiterMatch[1].trim(),
      value: delimiterMatch[2].trim(),
    };
  }

  // Fallback: two or more words, e.g. "remember BRB BeRightBack"
  const spaceParts = rest.split(/\s+/);
  if (spaceParts.length >= 2) {
    const key = spaceParts[0]!;
    const value = spaceParts.slice(1).join(" ");
    return {
      isServerScope,
      key,
      value,
    };
  }

  return undefined;
}

// Tries to parse "memory <key>=<value>" typed by mistake as a remember command.
// Returns the ParsedRemember if it looks like a save operation, or undefined if it's just a list request.
export function parseMemoryAsRemember(text: string): ParsedRemember | undefined {
  const trimmed = text.trim();
  // Match: "memory <rest>" or "mem <rest>" where rest contains a key=value separator
  const match = trimmed.match(/^(?:memory|mem)\s+(.+)$/i);
  if (!match || !match[1]) {
    return undefined;
  }

  let rest = match[1].trim();
  let isServerScope = false;

  const serverScopeMatch = rest.match(/^(?:\[server\]|server:?)\s+(.+)$/i);
  if (serverScopeMatch && serverScopeMatch[1]) {
    isServerScope = true;
    rest = serverScopeMatch[1].trim();
  }

  // Only treat it as a remember if there's a clear key=value separator (not colon, to avoid "memory server:")
  const delimiterMatch = rest.match(
    /^(.+?)\s*(?:=|=>|->|\s+stands\s+for\s+|\s+means\s+|\s+is\s+)\s*(.+)$/i,
  );
  if (delimiterMatch && delimiterMatch[1] && delimiterMatch[2]) {
    return {
      isServerScope,
      key: delimiterMatch[1].trim(),
      value: delimiterMatch[2].trim(),
    };
  }

  return undefined;
}

export function parseForgetCommand(text: string): ParsedForget | undefined {
  const trimmed = text.trim();
  const match = trimmed.match(
    /^(?:please\s+)?(?:forget|delete\s+memory|remove\s+memory):?(?:\s+(.+))?$/i,
  );
  if (!match || !match[1]) {
    return undefined;
  }

  let rest = match[1].trim();
  let isServerScope = false;

  const serverScopeMatch = rest.match(/^(?:\[server\]|server:?)\s+(.+)$/i);
  if (serverScopeMatch && serverScopeMatch[1]) {
    isServerScope = true;
    rest = serverScopeMatch[1].trim();
  }

  const isAll =
    rest.toLowerCase() === "all" ||
    rest.toLowerCase() === "everything" ||
    rest.toLowerCase() === "all memories";

  return {
    isAll,
    isServerScope,
    key: isAll ? "all" : rest,
  };
}

export function parseMemoryCommand(text: string): ParsedMemoryList | undefined {
  const trimmed = text.trim().toLowerCase();
  if (
    trimmed === "memory" ||
    trimmed === "memories" ||
    trimmed === "memory list" ||
    trimmed === "list memory" ||
    trimmed === "list memories" ||
    trimmed === "my memories" ||
    trimmed === "show memories" ||
    trimmed === "saved memories"
  ) {
    return { scope: "all" };
  }

  if (
    trimmed === "memory server" ||
    trimmed === "server memory" ||
    trimmed === "server memories" ||
    trimmed === "list server memories"
  ) {
    return { scope: "server" };
  }

  if (
    trimmed === "memory personal" ||
    trimmed === "personal memory" ||
    trimmed === "personal memories" ||
    trimmed === "my memory"
  ) {
    return { scope: "personal" };
  }

  return undefined;
}

export function helpText(prefix: string): string {
  return [
    "**CC Commands**",
    `\`${prefix} your question\` — ask anything (I search the web automatically when needed; images supported!)`,
    `\`${prefix} search <query>\` — direct web search with DuckDuckGo`,
    `\`${prefix} remember <key> = <value>\` — teach me an abbreviation, definition, or fact (e.g. \`${prefix} remember BRB = Be Right Back\`)`,
    `\`${prefix} remember [server] <key> = <value>\` — save an abbreviation or fact for the whole server`,
    `\`${prefix} memory\` — list your saved memories and abbreviations`,
    `\`${prefix} forget <key>\` — delete a saved memory (or \`${prefix} forget all\`)`,
    `\`${prefix} clear\` — forget recent context in this channel`,
    `\`${prefix} ping\` — check whether I am online`,
    `\`${prefix} manage <request>\` — plan a server action (authorized roles only; changes require \`${prefix} manage confirm\`)`,
    "",
    "You can also attach images, mention me, reply to my messages, DM me, or use `/ask`, `/search`, `/remember`, `/memory`, `/forget`, and `/manage`.",
  ].join("\n");
}
