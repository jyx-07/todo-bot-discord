import cron from 'node-cron';
import { Guild, GuildMember, Collection } from 'discord.js';
import { client } from './client';
import {
    planMap,
    certMap,
    saveStore,
    pendingPlanReport as storedPendingPlanReport,
    pendingCertReport as storedPendingCertReport,
    pendingPlanReminder as storedPendingPlanReminder,
    setPendingPlanReport,
    setPendingCertReport,
    setPendingPlanReminder,
} from './storage';

const DISCORD_MAX_LENGTH = 2000;
const DISCORD_MAX_FILES = 10;
// 리포트에 잡히지 않은 계획을 며칠까지 들고 있을지 (오래된 항목이 무한히 쌓이지 않도록)
const PLAN_RETENTION_DAYS = 7;

function getAdminIds(): string[] {
    return (process.env.ADMIN_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean);
}

/** 디스코드 2000자 제한에 맞춰 줄 단위로 자른다 */
function chunkMessage(content: string, limit = DISCORD_MAX_LENGTH): string[] {
    const chunks: string[] = [];
    let current = '';
    const flush = () => {
        if (current.length > 0) chunks.push(current);
        current = '';
    };

    for (const rawLine of content.split('\n')) {
        let line = rawLine;
        // 한 줄 자체가 제한을 넘으면 강제로 쪼갠다
        while (line.length > limit) {
            flush();
            chunks.push(line.slice(0, limit));
            line = line.slice(limit);
        }
        const candidate = current.length === 0 ? line : `${current}\n${line}`;
        if (candidate.length > limit) {
            flush();
            current = line;
        } else {
            current = candidate;
        }
    }
    flush();

    return chunks.filter(chunk => chunk.trim().length > 0);
}

function chunkArray<T>(items: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
    return batches;
}

async function sendToAdmins(content: string, files: string[] = []) {
    const chunks = chunkMessage(content);
    const fileBatches = chunkArray(files, DISCORD_MAX_FILES);
    if (chunks.length === 0 && fileBatches.length === 0) return;

    for (const id of getAdminIds()) {
        const admin = await client.users.fetch(id);

        // 마지막 텍스트 조각에 첫 파일 묶음을 붙여 기존 표시 형태를 유지한다
        for (let i = 0; i < chunks.length; i++) {
            const attach = i === chunks.length - 1 ? fileBatches[0] : undefined;
            await admin.send(attach ? { content: chunks[i], files: attach } : chunks[i]);
        }
        for (const batch of fileBatches.slice(chunks.length > 0 ? 1 : 0)) {
            await admin.send({ files: batch });
        }
    }
}

function getKSTDate() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return {
        today: `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`,
        todayPadded: `0${kst.getUTCMonth() + 1}`.slice(-2) + '/' + `0${kst.getUTCDate()}`.slice(-2),
    };
}

async function runTask(name: string, task: () => Promise<void>) {
    try {
        await task();
    } catch (err) {
        console.error(`❌ ${name} 실패:`, err);
        try {
            await sendToAdmins(`⚠️ **${name} 실패**\n${err instanceof Error ? err.message : String(err)}`);
        } catch (notifyErr) {
            console.error('❌ 관리자 알림 전송도 실패:', notifyErr);
        }
    }
}

/** 서버를 나간 멤버 때문에 리포트 전체가 실패하지 않도록 한다 */
async function resolveDisplayName(
    guild: Guild,
    members: Collection<string, GuildMember>,
    userId: string,
): Promise<string> {
    const cached = members.get(userId);
    if (cached) return cached.displayName;
    try {
        const fetched = await guild.members.fetch(userId);
        return fetched.displayName;
    } catch {
        console.warn(`⚠️ 멤버 조회 실패 (탈퇴 추정): ${userId}`);
        return `(탈퇴 멤버 ${userId})`;
    }
}

const isImageUrl = (url: string) =>
    !/^https?:\/\//i.test(url) || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url);

async function collectCertReport(guild: Guild, members: Collection<string, GuildMember>) {
    const certified: string[] = [];
    const notCertified: string[] = [];

    members.forEach(member => {
        if (member.user.bot) return;
        if (certMap.has(member.id)) {
            certified.push(`✅ ${member.displayName}`);
        } else {
            notCertified.push(`❌ ${member.displayName}`);
        }
    });

    const summary = [
        '📸 **오늘 인증 현황**',
        '─────────────',
        ...certified,
        '',
        '📭 **미인증**',
        '─────────────',
        ...notCertified,
    ].join('\n');

    const perUser: { content: string; files: string[] }[] = [];
    for (const [userId, urls] of certMap.entries()) {
        const displayName = await resolveDisplayName(guild, members, userId);
        const imageFiles = urls.filter(isImageUrl);
        const linkFiles = urls.filter(url => !isImageUrl(url));

        let content = `📎 ${displayName}`;
        if (linkFiles.length > 0) content += `\n${linkFiles.join('\n')}`;

        perUser.push({ content, files: imageFiles });
    }

    certMap.clear();
    saveStore();

    setPendingCertReport({ summary, perUser });
}

async function sendCertReport() {
    if (!storedPendingCertReport) {
        await sendToAdmins('⚠️ 인증 리포트를 보내지 못했습니다: 수집된 리포트가 없습니다 (8:20 수집 단계 확인 필요)');
        return;
    }
    const { summary, perUser } = storedPendingCertReport;

    await sendToAdmins(summary);

    for (const { content, files } of perUser) {
        await sendToAdmins(content, files);
    }

    setPendingCertReport(null);
}

/** 리포트에 잡히지 않은 채 오래된 계획을 정리한다 */
function prunePlans(now: number) {
    const maxAge = PLAN_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const [id, entry] of planMap.entries()) {
        const savedAt = entry.savedAt ? Date.parse(entry.savedAt) : NaN;
        if (Number.isNaN(savedAt) || now - savedAt > maxAge) planMap.delete(id);
    }
}

async function collectPlanReport(guild: Guild, members: Collection<string, GuildMember>) {
    const { today, todayPadded } = getKSTDate();

    const written: string[] = [];
    const notWritten: string[] = [];
    const reminderSnapshot: Record<string, string> = {};

    members.forEach(member => {
        if (member.user.bot) return;
        const entry = planMap.get(member.id);
        if (entry && (entry.date === today || entry.date === todayPadded)) {
            const details = [entry.plans.join(', '), ...(entry.links ?? [])].filter(Boolean).join(' ');
            written.push(`✅ ${member.displayName}: ${details}`);
            reminderSnapshot[member.id] = details;
        } else {
            notWritten.push(`❌ ${member.displayName}`);
        }
    });

    const summary = [
        '📋 **오늘 계획 현황**',
        '─────────────',
        ...written,
        '',
        '📭 **미작성**',
        '─────────────',
        ...notWritten,
    ].join('\n');

    for (const [id, entry] of planMap.entries()) {
        if (entry.date === today || entry.date === todayPadded) planMap.delete(id);
    }
    prunePlans(Date.now());
    saveStore();

    setPendingPlanReport({ summary });
    setPendingPlanReminder(reminderSnapshot);
}

async function collectReports() {
    const guild = await client.guilds.fetch(process.env.GUILD_ID!);
    const members = await guild.members.fetch();

    await runTask('계획 리포트 수집', () => collectPlanReport(guild, members));
    await runTask('인증 리포트 수집', () => collectCertReport(guild, members));
}

async function sendPreDeadlineReminders() {
    const guild = await client.guilds.fetch(process.env.GUILD_ID!);
    const members = await guild.members.fetch();
    const { today, todayPadded } = getKSTDate();

    for (const member of members.values()) {
        if (member.user.bot) continue;

        const entry = planMap.get(member.id);
        const hasPlan = !!entry && (entry.date === today || entry.date === todayPadded);
        const hasCert = certMap.has(member.id);

        const missing: string[] = [];
        if (!hasPlan) missing.push('플래너');
        if (!hasCert) missing.push('과제 인증');
        if (missing.length === 0) continue;

        try {
            await member.send(`⏰ **마감 30분 전입니다!**\n아직 ${missing.join(', ')}을(를) 제출하지 않으셨어요. 서둘러주세요!`);
        } catch (err) {
            console.error(`⚠️ 마감 알림 DM 실패 (${member.displayName}):`, err);
        }
    }
}

async function sendPlanReport() {
    if (!storedPendingPlanReport) {
        await sendToAdmins('⚠️ 계획 리포트를 보내지 못했습니다: 수집된 리포트가 없습니다 (8:20 수집 단계 확인 필요)');
        return;
    }
    await sendToAdmins(storedPendingPlanReport.summary);
    setPendingPlanReport(null);
}

/** 계획 → 인증 순서가 섞이지 않도록 한 태스크에서 순차 전송한다 */
async function sendReports() {
    await runTask('계획 리포트 전송', sendPlanReport);
    await runTask('인증 리포트 전송', sendCertReport);
}

async function sendPlanReminders() {
    if (!storedPendingPlanReminder || Object.keys(storedPendingPlanReminder).length === 0) return;

    for (const [userId, details] of Object.entries(storedPendingPlanReminder)) {
        try {
            const user = await client.users.fetch(userId);
            await user.send(`🌙 **오늘 계획 리마인드**\n${details}`);
        } catch (err) {
            console.error(`⚠️ 플래너 리마인드 DM 실패 (${userId}):`, err);
        }
    }

    setPendingPlanReminder(null);
}

export function startScheduler() {
    const KST = { timezone: 'Asia/Seoul' };

    // 평일 월~금 (KST 08:20 수집, 08:30 전송)
    cron.schedule('20 8 * * 1,2,3,4,5', () => runTask('리포트 수집', collectReports), KST);
    cron.schedule('30 8 * * 1,2,3,4,5', () => sendReports(), KST);

    // 주말 토요일만 (KST 10:00 수집, 10:05 전송) - 일요일은 휴무
    cron.schedule('0 10 * * 6', () => runTask('리포트 수집', collectReports), KST);
    cron.schedule('5 10 * * 6', () => sendReports(), KST);

    // 마감 30분 전 미제출자 개인 DM 알림 (평일 07:50, 토요일 09:30 KST)
    cron.schedule('50 7 * * 1,2,3,4,5', () => runTask('마감 30분 전 알림', sendPreDeadlineReminders), KST);
    cron.schedule('30 9 * * 6', () => runTask('마감 30분 전 알림', sendPreDeadlineReminders), KST);

    // 매일 밤 21:00 KST, 그날 플래너 작성자 전원에게 본인 플래너 리마인드 DM
    cron.schedule('0 21 * * *', () => runTask('플래너 리마인드 전송', sendPlanReminders), KST);
}
