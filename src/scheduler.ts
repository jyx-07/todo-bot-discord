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

async function sendCertReport() {
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

    const msg = [
        '📸 **오늘 인증 현황**',
        '─────────────',
        ...certified,
        '',
        '📭 **미인증**',
        '─────────────',
        ...notCertified,
    ].join('\n');

    await sendToAdmins(msg);

    for (const [userId, urls] of certMap.entries()) {
        const member = await guild.members.fetch(userId);
        const imageFiles = urls.filter(u => !u.startsWith('http') || u.match(/\.(jpg|jpeg|png|gif|webp)/i));
        const linkFiles = urls.filter(u => !imageFiles.includes(u));

        let content = `📎 ${member.displayName}`;
        if (linkFiles.length > 0) content += `\n${linkFiles.join('\n')}`;

        if (imageFiles.length > 0) {
            await sendToAdminsWithFiles(content, imageFiles);
        } else {
            await sendToAdmins(content);
        }
    }

    certMap.clear();
    saveStore();
}

async function sendPlanReport() {
    const { today, todayPadded } = getKSTDate();

    const guild = await client.guilds.fetch(process.env.GUILD_ID!);
    const members = await guild.members.fetch();

    const written: string[] = [];
    const notWritten: string[] = [];

    members.forEach(member => {
        if (member.user.bot) return;
        const entry = planMap.get(member.id);
        if (entry && (entry.date === today || entry.date === todayPadded)) {
            written.push(`✅ ${member.displayName}: ${entry.plans.join(', ')}`);
        } else {
            notWritten.push(`❌ ${member.displayName}`);
        }
    });

    const msg = [
        '📋 **오늘 계획 현황**',
        '─────────────',
        ...written,
        '',
        '📭 **미작성**',
        '─────────────',
        ...notWritten,
    ].join('\n');

    await sendToAdmins(msg);

    for (const [id, entry] of planMap.entries()) {
        if (entry.date === today || entry.date === todayPadded) planMap.delete(id);
    }
    saveStore();
}

export function startScheduler() {
    cron.schedule('0 23 * * *', sendPlanReport);
    cron.schedule('30 13 * * 0,6', sendCertReport);
    cron.schedule('0 14 * * 1,2,3,4,5', sendCertReport);
}