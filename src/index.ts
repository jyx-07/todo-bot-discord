import { Client, GatewayIntentBits, Events, Message } from 'discord.js';
import * as dotenv from 'dotenv';
import { startScheduler } from './scheduler';
import { planMap, certMap, loadStore, saveStore } from './storage';
dotenv.config();

export { planMap, certMap, saveStore };

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
    loadStore();
    startScheduler();
});

client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;

    if (message.channelId === process.env.PLAN_CHANNEL_ID) {
        const dateMatch = message.content.match(/^#?\s*(\d{1,2}[\/\.]\d{1,2})/m);
        const plans = message.content
            .split('\n')
            .filter(line => line.trim().startsWith('•') || line.trim().startsWith('*') || line.trim().startsWith('-'))
            .map(line => line.replace(/^[•*-]\s*/, '').trim())
            .filter(Boolean);

        if (!dateMatch || plans.length === 0) return;

        const date = dateMatch[1];
        planMap.set(message.author.id, { date, plans });
        saveStore();
        await message.react('✅');
    }

    if (message.channelId === process.env.CERT_CHANNEL_ID) {
        const images = message.attachments.map(a => a.url);
        if (images.length === 0) return;

        certMap.set(message.author.id, images[0]);
        saveStore();
        await message.react('✅');
    }
});

client.login(process.env.DISCORD_TOKEN);