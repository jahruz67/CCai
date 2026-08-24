import "dotenv/config";
import { REST, Routes } from "discord.js";
import { slashCommands } from "./commands.js";
import { loadRegistrationConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadRegistrationConfig();
  const rest = new REST({ version: "10" }).setToken(config.token);

  if (config.guildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.applicationId, config.guildId),
      { body: slashCommands },
    );
    console.log(`Registered ${slashCommands.length} commands in guild ${config.guildId}.`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.applicationId), {
    body: slashCommands,
  });
  console.log(`Registered ${slashCommands.length} global commands.`);
}

main().catch((error: unknown) => {
  console.error("Command registration failed", {
    errorType: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message.slice(0, 240) : undefined,
  });
  process.exitCode = 1;
});
