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

function parseDate(content: string): string | null {
    // 6/16, 06/16, 6.16, 06.16, 6월16일, 6월 16일
    const match = content.match(/^#?\s*(\d{1,2})[\/\.\s]?월?\s*(\d{1,2})일?/m);
    if (!match) return null;
    const month = parseInt(match[1]);
    const day = parseInt(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${month}/${day}`;
}

function parsePlans(content: string): string[] {
    return content
        .split('\n')
        .filter(line => /^[\s]*[•*\-\d]+[\.\):]?\s+.+/.test(line) || /^[\s]*[•*\-]\s+.+/.test(line))
        .map(line => line.replace(/^[\s]*[•*\-\d]+[\.\):]?\s+/, '').trim())
        .filter(Boolean);
}

client.once(Events.ClientReady, (c) => {
    console.log(`✅ ${c.user.tag} 로그인 완료`);
    loadStore();
    startScheduler();
});

client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;

    if (message.channelId === process.env.PLAN_CHANNEL_ID) {
        const date = parseDate(message.content);
        const plans = parsePlans(message.content);
        const links = message.content.match(/https?:\/\/\S+/g) ?? [];

        if (!date || (plans.length === 0 && links.length === 0)) return;

        planMap.set(message.author.id, { date, plans, links });
        saveStore();
        await message.react('✅');
    }

    if (message.channelId === process.env.CERT_CHANNEL_ID) {
        const images = message.attachments.map(a => a.url);
        // 링크도 인증으로 인식
        const links = message.content.match(/https?:\/\/\S+/g) ?? [];
        const all = [...images, ...links];

        if (all.length === 0) return;

        certMap.set(message.author.id, all);
        saveStore();
        await message.react('✅');
    }
});

client.login(process.env.DISCORD_TOKEN);