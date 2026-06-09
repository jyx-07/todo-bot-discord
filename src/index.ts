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

    // 계획 채널
    if (message.channelId === process.env.PLAN_CHANNEL_ID) {
        const plans = message.content.split(',').map(p => p.trim()).filter(Boolean);
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

    // 인증 채널
    if (message.channelId === process.env.CERT_CHANNEL_ID) {
        const image = message.attachments.first();
        if (image) {
            certMap.set(message.author.id, image.url);
            await message.react('✅');

            const admin = await client.users.fetch(process.env.ADMIN_ID!);
            const embed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('📸 인증 완료')
                .setAuthor({
                    name: message.author.username,
                    iconURL: message.author.displayAvatarURL(),
                })
                .setImage(image.url)
                .setTimestamp()
                .setFooter({ text: '투두봇' });

            await admin.send({ embeds: [embed] });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);