import { Client, GatewayIntentBits, Events, Message } from 'discord.js';
import * as dotenv from 'dotenv';
import { startScheduler } from './scheduler';
dotenv.config();

export const planMap = new Map<string, string[]>();
export const certMap = new Map<string, string>();

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once(Events.ClientReady, (c) => {
    console.log(`✅ ${c.user.tag} 로그인 완료`);
    startScheduler();
});

client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;

    if (message.channelId === process.env.PLAN_CHANNEL_ID) {
        const plans = message.content.split(',').map(p => p.trim()).filter(Boolean);
        planMap.set(message.author.id, plans);
        await message.react('✅');
    }

    if (message.channelId === process.env.CERT_CHANNEL_ID) {
        const image = message.attachments.first();
        if (image) {
            certMap.set(message.author.id, image.url);
            await message.react('✅');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);