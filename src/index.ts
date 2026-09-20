import { Events, Message } from 'discord.js';
import * as dotenv from 'dotenv';
import { client } from './client';
import { startScheduler } from './scheduler';
import { planMap, certMap, loadStore, saveStore } from './storage';
dotenv.config();

const REQUIRED_ENV = ['DISCORD_TOKEN', 'GUILD_ID', 'PLAN_CHANNEL_ID', 'CERT_CHANNEL_ID', 'ADMIN_IDS'] as const;

function checkEnv() {
    const missing = REQUIRED_ENV.filter(key => !process.env[key]?.trim());
    if (missing.length > 0) {
        console.error(`❌ 필수 환경변수가 없습니다: ${missing.join(', ')}`);
        process.exit(1);
    }
    const adminIds = process.env.ADMIN_IDS!.split(',').map(id => id.trim()).filter(Boolean);
    if (adminIds.length === 0) {
        console.error('❌ ADMIN_IDS에 유효한 ID가 없습니다');
        process.exit(1);
    }
}

// 2월은 윤년 여부를 모르므로 29일까지 허용
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function parseDate(content: string): string | null {
    // 날짜는 첫 줄에서만 찾는다 (본문 중간의 "3 5 세트" 같은 줄을 날짜로 오인하지 않도록)
    const firstLine = content.split('\n').map(line => line.trim()).find(Boolean);
    if (!firstLine) return null;

    // 6/16, 06/16, 6.16, 6-16, 6월16일, 6월 16일
    const match = firstLine.match(/^#?\s*(\d{1,2})\s*(?:[\/.\-]|월)\s*(\d{1,2})\s*일?/);
    if (!match) return null;
    const month = parseInt(match[1]);
    const day = parseInt(match[2]);
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
    return `${month}/${day}`;
}

// "- 항목", "• 항목", "1. 항목", "2) 항목"
const LIST_MARKER = /^(?:[•*\-]|\d{1,2}[.):])\s+/;
// "10 km 달리기"처럼 마커 없이 숫자로 시작하는 줄 (숫자를 지우면 안 된다)
const PLAIN_NUMBER_LINE = /^\d{1,2}\s+\S/;

function parsePlans(content: string): string[] {
    return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => (LIST_MARKER.test(line) && line.replace(LIST_MARKER, '').trim().length > 0)
            || PLAIN_NUMBER_LINE.test(line))
        .map(line => line.replace(LIST_MARKER, '').trim())
        .filter(Boolean);
}

client.once(Events.ClientReady, (c) => {
    console.log(`✅ ${c.user.tag} 로그인 완료`);
    loadStore();
    startScheduler();
});

client.on(Events.MessageCreate, async (message: Message) => {
    try {
        if (message.author.bot) return;

        if (message.channelId === process.env.PLAN_CHANNEL_ID) {
            const date = parseDate(message.content);
            const plans = parsePlans(message.content);
            const links = message.content.match(/https?:\/\/\S+/g) ?? [];

            if (!date || (plans.length === 0 && links.length === 0)) return;

            // 계획은 최신 메시지로 갱신한다
            planMap.set(message.author.id, { date, plans, links, savedAt: new Date().toISOString() });
            saveStore();
            await message.react('✅');
        }

        if (message.channelId === process.env.CERT_CHANNEL_ID) {
            const images = message.attachments.map(a => a.url);
            // 링크도 인증으로 인식
            const links = message.content.match(/https?:\/\/\S+/g) ?? [];
            const all = [...images, ...links];

            if (all.length === 0) return;

            // 인증은 여러 번 나눠 올릴 수 있으므로 덮어쓰지 않고 누적한다
            const previous = certMap.get(message.author.id) ?? [];
            certMap.set(message.author.id, [...previous, ...all.filter(url => !previous.includes(url))]);
            saveStore();
            await message.react('✅');
        }
    } catch (err) {
        console.error('❌ 메시지 처리 실패:', err);
    }
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ 처리되지 않은 프로미스 거부:', reason);
});

checkEnv();
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ 디스코드 로그인 실패:', err);
    process.exit(1);
});
