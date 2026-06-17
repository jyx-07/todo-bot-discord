import cron from 'node-cron';
import { client, planMap, certMap, saveStore } from './index';

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

type PendingCertReport = {
    summary: string;
    perUser: { content: string; files: string[] }[];
};

type PendingPlanReport = {
    summary: string;
};

let pendingCertReport: PendingCertReport | null = null;
let pendingPlanReport: PendingPlanReport | null = null;

async function collectCertReport() {
    const guild = await client.guilds.fetch(process.env.GUILD_ID!);
    const members = await guild.members.fetch();

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
        const member = await guild.members.fetch(userId);
        const imageFiles = urls.filter(u => !u.startsWith('http') || u.match(/\.(jpg|jpeg|png|gif|webp)/i));
        const linkFiles = urls.filter(u => !imageFiles.includes(u));

        let content = `📎 ${member.displayName}`;
        if (linkFiles.length > 0) content += `\n${linkFiles.join('\n')}`;

        perUser.push({ content, files: imageFiles });
    }

    certMap.clear();
    saveStore();

    pendingCertReport = { summary, perUser };
}

async function sendCertReport() {
    if (!pendingCertReport) return;
    const { summary, perUser } = pendingCertReport;

    await sendToAdmins(summary);

    for (const { content, files } of perUser) {
        if (files.length > 0) {
            await sendToAdminsWithFiles(content, files);
        } else {
            await sendToAdmins(content);
        }
    }

    pendingCertReport = null;
}

async function collectPlanReport() {
    const { today, todayPadded } = getKSTDate();

    const guild = await client.guilds.fetch(process.env.GUILD_ID!);
    const members = await guild.members.fetch();

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

    pendingPlanReport = { summary };
}

async function sendPlanReport() {
    if (!pendingPlanReport) return;
    await sendToAdmins(pendingPlanReport.summary);
    pendingPlanReport = null;
}

export function startScheduler() {
    cron.schedule('30 8 * * *', collectPlanReport);
    cron.schedule('30 8 * * *', collectCertReport);
    cron.schedule('0 9 * * *', sendPlanReport);
    cron.schedule('0 9 * * *', sendCertReport);
}
