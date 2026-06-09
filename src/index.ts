import { Client, GatewayIntentBits, Events, Message, EmbedBuilder } from 'discord.js';
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
        const plans = message.content
            .split('\n')
            .filter(line => line.trim().startsWith('*'))
            .map(line => line.replace(/^\*\s*/, '').trim())
            .filter(Boolean);

        if (plans.length === 0) return;

        planMap.set(message.author.id, plans);
        await message.react('✅');

        const admin = await client.users.fetch(process.env.ADMIN_ID!);
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📋 새로운 계획 작성')
            .setAuthor({
                name: message.author.username,
                iconURL: message.author.displayAvatarURL(),
            })
            .addFields({
                name: '오늘의 계획',
                value: plans.map((p, i) => `${i + 1}. ${p}`).join('\n'),
            })
            .setTimestamp()
            .setFooter({ text: '투두봇' });

        await admin.send({ embeds: [embed] });
    }

    if (message.channelId === process.env.CERT_CHANNEL_ID) {
        const images = message.attachments.map(a => a.url);
        if (images.length === 0) return;

        certMap.set(message.author.id, images[0]); // 대표 사진만 저장
        await message.react('✅');

        const admin = await client.users.fetch(process.env.ADMIN_ID!);
        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('📸 인증 완료')
            .setAuthor({
                name: message.author.username,
                iconURL: message.author.displayAvatarURL(),
            })
            .setImage(images[0])
            .setTimestamp()
            .setFooter({ text: '투두봇' });

        await admin.send({ embeds: [embed], files: images.slice(1) }); // 나머지 사진은 파일로
    }
});

client.login(process.env.DISCORD_TOKEN);