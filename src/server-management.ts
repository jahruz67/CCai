import {
  ChannelType,
  GatewayIntentBits,
  type ColorResolvable,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Role,
  type ThreadChannel,
} from "discord.js";
import { z } from "zod";

type ManageableGuildChannel = Exclude<GuildBasedChannel, ThreadChannel>;

const target = z.string().trim().min(1).max(200);
const optionalReason = z.string().trim().min(1).max(400).optional();

export const managementActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("server_info") }),
  z.object({ type: z.literal("list_channels") }),
  z.object({ type: z.literal("list_roles") }),
  z.object({
    limit: z.number().int().min(1).max(100).optional(),
    type: z.literal("list_members"),
  }),
  z.object({
    channelType: z.enum(["text", "voice", "category"]),
    name: z.string().trim().min(1).max(100),
    parent: target.optional(),
    reason: optionalReason,
    type: z.literal("create_channel"),
  }),
  z.object({ channel: target, reason: optionalReason, type: z.literal("delete_channel") }),
  z.object({
    channel: target,
    name: z.string().trim().min(1).max(100).optional(),
    nsfw: z.boolean().optional(),
    parent: target.nullable().optional(),
    slowmodeSeconds: z.number().int().min(0).max(21_600).optional(),
    topic: z.string().max(1_024).nullable().optional(),
    reason: optionalReason,
    type: z.literal("edit_channel"),
  }),
  z.object({ channel: target, reason: optionalReason, type: z.literal("lock_channel") }),
  z.object({ channel: target, reason: optionalReason, type: z.literal("unlock_channel") }),
  z.object({
    color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    hoist: z.boolean().optional(),
    mentionable: z.boolean().optional(),
    name: z.string().trim().min(1).max(100),
    reason: optionalReason,
    type: z.literal("create_role"),
  }),
  z.object({ role: target, reason: optionalReason, type: z.literal("delete_role") }),
  z.object({
    color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
    hoist: z.boolean().optional(),
    mentionable: z.boolean().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    reason: optionalReason,
    role: target,
    type: z.literal("edit_role"),
  }),
  z.object({ member: target, reason: optionalReason, role: target, type: z.literal("add_role") }),
  z.object({ member: target, reason: optionalReason, role: target, type: z.literal("remove_role") }),
  z.object({ member: target, reason: optionalReason, type: z.literal("kick_member") }),
  z.object({
    deleteMessageSeconds: z.number().int().min(0).max(604_800).optional(),
    member: target,
    reason: optionalReason,
    type: z.literal("ban_member"),
  }),
  z.object({ member: target, reason: optionalReason, type: z.literal("unban_member") }),
  z.object({
    durationMinutes: z.number().int().min(1).max(40_320),
    member: target,
    reason: optionalReason,
    type: z.literal("timeout_member"),
  }),
  z.object({ member: target, reason: optionalReason, type: z.literal("remove_timeout") }),
  z.object({
    member: target,
    nickname: z.string().max(32).nullable(),
    reason: optionalReason,
    type: z.literal("set_nickname"),
  }),
  z.object({
    channel: target.optional(),
    count: z.number().int().min(1).max(100),
    reason: optionalReason,
    type: z.literal("purge_messages"),
  }),
  z.object({
    description: z.string().max(120).nullable().optional(),
    name: z.string().trim().min(2).max(100).optional(),
    reason: optionalReason,
    type: z.literal("edit_server"),
  }),
]);

export const managementPlanSchema = z.object({
  actions: z.array(managementActionSchema).min(1).max(10),
  summary: z.string().trim().min(1).max(500),
});

export type ManagementAction = z.infer<typeof managementActionSchema>;
export type ManagementPlan = z.infer<typeof managementPlanSchema>;

export interface ManagementPlanner {
  planServerManagement(request: string, serverSnapshot: string): Promise<ManagementPlan>;
}

export type ManageCommand =
  | { kind: "cancel" }
  | { kind: "confirm" }
  | { kind: "request"; request: string };

interface PendingPlan {
  channelId: string;
  expiresAt: number;
  guildId: string;
  plan: ManagementPlan;
  requestedBy: string;
}

const READ_ONLY_ACTIONS = new Set<ManagementAction["type"]>([
  "server_info",
  "list_channels",
  "list_roles",
  "list_members",
]);

const ACTION_LABELS: Record<ManagementAction["type"], string> = {
  add_role: "add a role to a member",
  ban_member: "ban a member",
  create_channel: "create a channel",
  create_role: "create a role",
  delete_channel: "delete a channel",
  delete_role: "delete a role",
  edit_channel: "edit a channel",
  edit_role: "edit a role",
  edit_server: "edit server settings",
  kick_member: "kick a member",
  list_channels: "list channels",
  list_members: "list members",
  list_roles: "list roles",
  lock_channel: "lock a channel",
  purge_messages: "purge messages",
  remove_role: "remove a role from a member",
  remove_timeout: "remove a member timeout",
  server_info: "show server information",
  set_nickname: "set a member nickname",
  timeout_member: "timeout a member",
  unban_member: "unban a member",
  unlock_channel: "unlock a channel",
};

export function parseManageCommand(text: string): ManageCommand | undefined {
  const match = text.trim().match(/^manage(?:\s+([\s\S]+))?$/i);
  if (!match) return undefined;
  const request = match[1]?.trim() ?? "";
  if (/^confirm$/i.test(request)) return { kind: "confirm" };
  if (/^cancel$/i.test(request)) return { kind: "cancel" };
  return { kind: "request", request };
}

export function parseManagementPlan(raw: string): ManagementPlan {
  const withoutFence = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("The AI did not return a valid management plan.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence.slice(start, end + 1));
  } catch {
    throw new Error("The AI returned malformed management JSON.");
  }
  const result = managementPlanSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`The AI returned an invalid management plan: ${result.error.issues[0]?.message ?? "unknown error"}`);
  }
  return result.data;
}

export function isAuthorizedAdministrator(
  member: GuildMember,
  adminRoleIds: ReadonlySet<string>,
  adminRoleNames: ReadonlySet<string>,
): boolean {
  if (member.id === member.guild.ownerId) return true;
  return member.roles.cache.some(
    (role) =>
      adminRoleIds.has(role.id) ||
      adminRoleNames.has(role.name.toLocaleLowerCase()),
  );
}

export function buildGuildSnapshot(guild: Guild): string {
  const channels = [...guild.channels.cache.values()]
    .filter((channel): channel is GuildBasedChannel => channel !== null)
    .map((channel) => ({ id: channel.id, name: channel.name, type: ChannelType[channel.type] }))
    .slice(0, 250);
  const roles = [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({ id: role.id, name: role.name, position: role.position }))
    .slice(0, 250);
  return JSON.stringify({
    channelCount: guild.channels.cache.size,
    channels,
    guildId: guild.id,
    memberCount: guild.memberCount,
    name: guild.name,
    ownerId: guild.ownerId,
    roles,
  });
}

export class ServerManager {
  private readonly pending = new Map<string, PendingPlan>();

  public constructor(
    private readonly planner: ManagementPlanner,
    private readonly adminRoleIds: ReadonlySet<string>,
    private readonly adminRoleNames: ReadonlySet<string>,
  ) {}

  public async handle(
    command: ManageCommand,
    guild: Guild,
    member: GuildMember,
    channelId: string,
  ): Promise<string> {
    if (!isAuthorizedAdministrator(member, this.adminRoleIds, this.adminRoleNames)) {
      return "You are not authorized to manage this server through CC. The server owner must add one of your role IDs or exact role names to `AI_ADMIN_ROLES`.";
    }

    const key = `${guild.id}:${member.id}`;
    this.sweep();

    if (command.kind === "cancel") {
      const removed = this.pending.delete(key);
      return removed ? "Cancelled the pending server-management plan." : "You do not have a pending management plan.";
    }

    if (command.kind === "confirm") {
      const pending = this.pending.get(key);
      if (!pending || pending.expiresAt <= Date.now()) {
        this.pending.delete(key);
        return "There is no pending plan to confirm. Create one with `cc manage <request>`.";
      }
      this.pending.delete(key);
      return executePlan(guild, pending.plan, pending.channelId, pending.requestedBy);
    }

    if (!command.request) {
      return "Tell me what to manage, for example `cc manage create a text channel named announcements`. Use `cc manage confirm` after reviewing a change plan.";
    }

    const plan = await this.planner.planServerManagement(
      command.request,
      buildGuildSnapshot(guild),
    );
    const hasMutation = plan.actions.some((action) => !READ_ONLY_ACTIONS.has(action.type));
    if (!hasMutation) {
      return executePlan(guild, plan, channelId, member.id);
    }

    this.pending.set(key, {
      channelId,
      expiresAt: Date.now() + 5 * 60_000,
      guildId: guild.id,
      plan,
      requestedBy: member.id,
    });
    return `${formatPlan(plan)}\n\nNo changes have been made. Run \`cc manage confirm\` within 5 minutes to execute this exact plan, or \`cc manage cancel\`.`;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, pending] of this.pending) {
      if (pending.expiresAt <= now) this.pending.delete(key);
    }
  }
}

function formatPlan(plan: ManagementPlan): string {
  const lines = [`**Server management plan:** ${plan.summary}`];
  plan.actions.forEach((action, index) => {
    const details = Object.entries(action)
      .filter(([key]) => key !== "type")
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(", ");
    lines.push(`${index + 1}. ${ACTION_LABELS[action.type]}${details ? ` (${details})` : ""}`);
  });
  return lines.join("\n");
}

async function executePlan(
  guild: Guild,
  plan: ManagementPlan,
  currentChannelId: string,
  requestedBy: string,
): Promise<string> {
  const results: string[] = [`**${plan.summary}**`];
  for (const action of plan.actions) {
    try {
      results.push(`✅ ${await executeAction(guild, action, currentChannelId, requestedBy)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Discord error";
      results.push(`❌ ${ACTION_LABELS[action.type]} failed: ${message.slice(0, 300)}`);
    }
  }
  return results.join("\n");
}

async function executeAction(
  guild: Guild,
  action: ManagementAction,
  currentChannelId: string,
  requestedBy: string,
): Promise<string> {
  const reason = `${"reason" in action ? action.reason ?? "Requested through CC" : "Requested through CC"} (requested by ${requestedBy})`;
  switch (action.type) {
    case "server_info":
      return `**${guild.name}** (${guild.id}) — ${guild.memberCount} members, ${guild.channels.cache.size} channels, ${guild.roles.cache.size - 1} roles. Owner: ${guild.ownerId}.`;
    case "list_channels":
      return `Channels:\n${[...guild.channels.cache.values()].map((channel) => `• ${channel.name} — ${channel.id} (${ChannelType[channel.type]})`).join("\n") || "None"}`;
    case "list_roles":
      return `Roles:\n${[...guild.roles.cache.values()].filter((role) => role.id !== guild.id).sort((a, b) => b.position - a.position).map((role) => `• ${role.name} — ${role.id}`).join("\n") || "None"}`;
    case "list_members": {
      if (!guild.client.options.intents.has(GatewayIntentBits.GuildMembers)) {
        throw new Error(
          "Full member listing requires Server Members Intent in the Discord Developer Portal and DISCORD_GUILD_MEMBERS_INTENT=true.",
        );
      }
      const members = await guild.members.fetch();
      const limit = action.limit ?? 50;
      return `Members (showing ${Math.min(limit, members.size)} of ${members.size}):\n${[...members.values()].slice(0, limit).map((member) => `• ${member.displayName} — ${member.id}`).join("\n") || "None"}`;
    }
    case "create_channel": {
      const parent = action.parent ? await resolveChannel(guild, action.parent) : undefined;
      const channel = await guild.channels.create({
        name: action.name,
        ...(parent ? { parent: parent.id } : {}),
        reason,
        type:
          action.channelType === "voice"
            ? ChannelType.GuildVoice
            : action.channelType === "category"
              ? ChannelType.GuildCategory
              : ChannelType.GuildText,
      });
      return `Created #${channel.name} (${channel.id}).`;
    }
    case "delete_channel": {
      const channel = await resolveChannel(guild, action.channel);
      const label = channel.name;
      await channel.delete(reason);
      return `Deleted channel ${label}.`;
    }
    case "edit_channel": {
      const channel = await resolveChannel(guild, action.channel);
      const parent = action.parent === null ? null : action.parent ? (await resolveChannel(guild, action.parent)).id : undefined;
      await channel.edit({
        ...(action.name !== undefined ? { name: action.name } : {}),
        ...(action.nsfw !== undefined ? { nsfw: action.nsfw } : {}),
        ...(action.slowmodeSeconds !== undefined ? { rateLimitPerUser: action.slowmodeSeconds } : {}),
        ...(action.topic !== undefined ? { topic: action.topic } : {}),
        ...(parent !== undefined ? { parent } : {}),
        reason,
      });
      return `Updated channel ${channel.name}.`;
    }
    case "lock_channel":
    case "unlock_channel": {
      const channel = await resolveChannel(guild, action.channel);
      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { SendMessages: action.type === "lock_channel" ? false : null },
        { reason },
      );
      return `${action.type === "lock_channel" ? "Locked" : "Unlocked"} #${channel.name}.`;
    }
    case "create_role": {
      const role = await guild.roles.create({
        ...(action.color ? { color: action.color as ColorResolvable } : {}),
        ...(action.hoist !== undefined ? { hoist: action.hoist } : {}),
        ...(action.mentionable !== undefined ? { mentionable: action.mentionable } : {}),
        name: action.name,
        reason,
      });
      return `Created role ${role.name} (${role.id}).`;
    }
    case "delete_role": {
      const role = await resolveRole(guild, action.role);
      const label = role.name;
      await role.delete(reason);
      return `Deleted role ${label}.`;
    }
    case "edit_role": {
      const role = await resolveRole(guild, action.role);
      await role.edit({
        ...(action.color !== undefined ? { color: (action.color ?? "Default") as ColorResolvable } : {}),
        ...(action.hoist !== undefined ? { hoist: action.hoist } : {}),
        ...(action.mentionable !== undefined ? { mentionable: action.mentionable } : {}),
        ...(action.name !== undefined ? { name: action.name } : {}),
        reason,
      });
      return `Updated role ${role.name}.`;
    }
    case "add_role":
    case "remove_role": {
      const member = await resolveMember(guild, action.member);
      const role = await resolveRole(guild, action.role);
      if (action.type === "add_role") await member.roles.add(role, reason);
      else await member.roles.remove(role, reason);
      return `${action.type === "add_role" ? "Added" : "Removed"} ${role.name} ${action.type === "add_role" ? "to" : "from"} ${member.displayName}.`;
    }
    case "kick_member": {
      const member = await resolveMember(guild, action.member);
      const label = member.user.tag;
      await member.kick(reason);
      return `Kicked ${label}.`;
    }
    case "ban_member": {
      const memberId = await resolveMemberId(guild, action.member);
      await guild.members.ban(memberId, { deleteMessageSeconds: action.deleteMessageSeconds, reason });
      return `Banned member ${memberId}.`;
    }
    case "unban_member": {
      const memberId = extractDiscordId(action.member);
      if (!memberId) throw new Error("Unbanning requires the user's Discord ID.");
      await guild.members.unban(memberId, reason);
      return `Unbanned member ${memberId}.`;
    }
    case "timeout_member": {
      const member = await resolveMember(guild, action.member);
      await member.timeout(action.durationMinutes * 60_000, reason);
      return `Timed out ${member.displayName} for ${action.durationMinutes} minute(s).`;
    }
    case "remove_timeout": {
      const member = await resolveMember(guild, action.member);
      await member.timeout(null, reason);
      return `Removed the timeout from ${member.displayName}.`;
    }
    case "set_nickname": {
      const member = await resolveMember(guild, action.member);
      await member.setNickname(action.nickname, reason);
      return `${action.nickname ? `Set ${member.user.tag}'s nickname to ${action.nickname}` : `Cleared ${member.user.tag}'s nickname`}.`;
    }
    case "purge_messages": {
      const channel = await resolveChannel(guild, action.channel ?? currentChannelId);
      if (!("bulkDelete" in channel) || typeof channel.bulkDelete !== "function") {
        throw new Error("That channel does not support bulk message deletion.");
      }
      const deleted = await channel.bulkDelete(action.count, true);
      return `Deleted ${deleted.size} recent message(s) from #${channel.name}. Messages older than 14 days are skipped by Discord.`;
    }
    case "edit_server":
      await guild.edit({
        ...(action.description !== undefined ? { description: action.description } : {}),
        ...(action.name !== undefined ? { name: action.name } : {}),
        reason,
      });
      return `Updated server settings for ${guild.name}.`;
  }
}

async function resolveChannel(guild: Guild, reference: string): Promise<ManageableGuildChannel> {
  const id = extractDiscordId(reference);
  if (id) {
    const channel = await guild.channels.fetch(id);
    if (channel && !channel.isThread()) return channel;
  }
  const normalized = reference.replace(/^#/, "").trim().toLocaleLowerCase();
  const matches = [...guild.channels.cache.values()].filter(
    (channel): channel is ManageableGuildChannel =>
      !channel.isThread() && channel.name.toLocaleLowerCase() === normalized,
  );
  if (matches.length === 1 && matches[0]) return matches[0];
  if (matches.length > 1) throw new Error(`Multiple channels are named ${reference}; use a channel mention or ID.`);
  throw new Error(`Channel ${reference} was not found.`);
}

async function resolveRole(guild: Guild, reference: string): Promise<Role> {
  const id = extractDiscordId(reference);
  if (id) {
    const role = await guild.roles.fetch(id);
    if (role && role.id !== guild.id) return role;
  }
  const normalized = reference.replace(/^@/, "").trim().toLocaleLowerCase();
  const matches = [...guild.roles.cache.values()].filter(
    (role) => role.id !== guild.id && role.name.toLocaleLowerCase() === normalized,
  );
  if (matches.length === 1 && matches[0]) return matches[0];
  if (matches.length > 1) throw new Error(`Multiple roles are named ${reference}; use a role mention or ID.`);
  throw new Error(`Role ${reference} was not found.`);
}

async function resolveMember(guild: Guild, reference: string): Promise<GuildMember> {
  const id = extractDiscordId(reference);
  if (id) return guild.members.fetch(id);
  const normalized = reference.replace(/^@/, "").trim().toLocaleLowerCase();
  const matches = [...guild.members.cache.values()].filter(
    (member) =>
      member.displayName.toLocaleLowerCase() === normalized ||
      member.user.username.toLocaleLowerCase() === normalized,
  );
  if (matches.length === 1 && matches[0]) return matches[0];
  if (matches.length > 1) throw new Error(`Multiple members match ${reference}; use a user mention or ID.`);
  throw new Error(`Member ${reference} was not found; use a user mention or Discord ID.`);
}

async function resolveMemberId(guild: Guild, reference: string): Promise<string> {
  return extractDiscordId(reference) ?? (await resolveMember(guild, reference)).id;
}

function extractDiscordId(reference: string): string | undefined {
  return reference.match(/\d{17,20}/)?.[0];
}
