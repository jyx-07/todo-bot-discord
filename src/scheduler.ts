import cron from 'node-cron';
import { Guild, GuildMember, Collection } from 'discord.js';
import { client, planMap, certMap, saveStore } from './index';
import {
    pendingPlanReport as storedPendingPlanReport,
    pendingCertReport as storedPendingCertReport,
    pendingPlanReminder as storedPendingPlanReminder,
    setPendingPlanReport,
    setPendingCertReport,
    setPendingPlanReminder,
} from './storage';

async function sendToAdmins(content: string) {
    const adminIds = process.env.ADMIN_IDS!.split(',').map(id => id.trim());
    for (const id of adminIds) {
        const admin = await client.users.fetch(id);
        await admin.send(content);
    }
}

async function sendToAdminsWithFiles(content: string, files: string[]) {
    const adminIds = process.env.ADMIN_IDS!.split(',').map(id => id.trim());
    for (const id of adminIds) {
        const admin = await client.users.fetch(id);
        await admin.send({ content, files });
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
        const member = members.get(userId) ?? (await guild.members.fetch(userId));
        const imageFiles = urls.filter(u => !u.startsWith('http') || u.match(/\.(jpg|jpeg|png|gif|webp)/i));
        const linkFiles = urls.filter(u => !imageFiles.includes(u));

        let content = `📎 ${member.displayName}`;
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
        if (files.length > 0) {
            await sendToAdminsWithFiles(content, files);
        } else {
            await sendToAdmins(content);
        }
    }

    setPendingCertReport(null);
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
    // 평일 (KST 08:20 수집, 08:30 전송)
    cron.schedule('20 23 * * 0,1,2,3,4', () => runTask('리포트 수집', collectReports));
    cron.schedule('30 23 * * 0,1,2,3,4', () => runTask('계획 리포트 전송', sendPlanReport));
    cron.schedule('30 23 * * 0,1,2,3,4', () => runTask('인증 리포트 전송', sendCertReport));

    // 주말 (KST 10:00 수집, 10:05 전송)
    cron.schedule('0 1 * * 5,6', () => runTask('리포트 수집', collectReports));
    cron.schedule('5 1 * * 5,6', () => runTask('계획 리포트 전송', sendPlanReport));
    cron.schedule('5 1 * * 5,6', () => runTask('인증 리포트 전송', sendCertReport));

    // 마감 30분 전 미제출자 개인 DM 알림 (평일 07:50, 주말 09:30 KST)
    cron.schedule('50 22 * * 0,1,2,3,4', () => runTask('마감 30분 전 알림', sendPreDeadlineReminders));
    cron.schedule('30 0 * * 5,6', () => runTask('마감 30분 전 알림', sendPreDeadlineReminders));

    // 매일 밤 21:00 KST, 그날 플래너 작성자 전원에게 본인 플래너 리마인드 DM
    cron.schedule('0 12 * * *', () => runTask('플래너 리마인드 전송', sendPlanReminders));
}
