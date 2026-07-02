import cron from 'node-cron';
import { Guild, GuildMember, Collection } from 'discord.js';
import { client, planMap, certMap, saveStore } from './index';
import {
    pendingPlanReport as storedPendingPlanReport,
    pendingCertReport as storedPendingCertReport,
    setPendingPlanReport,
    setPendingCertReport,
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

    members.forEach(member => {
        if (member.user.bot) return;
        const entry = planMap.get(member.id);
        if (entry && (entry.date === today || entry.date === todayPadded)) {
            const details = [entry.plans.join(', '), ...(entry.links ?? [])].filter(Boolean).join(' ');
            written.push(`✅ ${member.displayName}: ${details}`);
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
}

async function collectReports() {
    const guild = await client.guilds.fetch(process.env.GUILD_ID!);
    const members = await guild.members.fetch();

    await runTask('계획 리포트 수집', () => collectPlanReport(guild, members));
    await runTask('인증 리포트 수집', () => collectCertReport(guild, members));
}

async function sendPlanReport() {
    if (!storedPendingPlanReport) {
        await sendToAdmins('⚠️ 계획 리포트를 보내지 못했습니다: 수집된 리포트가 없습니다 (8:20 수집 단계 확인 필요)');
        return;
    }
    await sendToAdmins(storedPendingPlanReport.summary);
    setPendingPlanReport(null);
}

export function startScheduler() {
    const tz = { timezone: 'Asia/Seoul' };
    cron.schedule('20 8 * * *', () => runTask('리포트 수집', collectReports), tz);
    cron.schedule('30 8 * * *', () => runTask('계획 리포트 전송', sendPlanReport), tz);
    cron.schedule('30 8 * * *', () => runTask('인증 리포트 전송', sendCertReport), tz);
}
