import { Client, GatewayIntentBits } from 'discord.js';

// index ↔ scheduler 순환 참조를 피하려고 클라이언트만 따로 둔다
export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});
