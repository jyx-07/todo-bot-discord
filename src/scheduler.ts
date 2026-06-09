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

    for (const [userId, url] of certMap.entries()) {
        const member = await guild.members.fetch(userId);
        await sendToAdminsWithFiles(`📎 ${member.displayName}`, [url]);
    }

    certMap.clear();
    saveStore();
}

export function startScheduler() {
    cron.schedule('0 8 * * *', async () => {
        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const today = `${month}/${day}`;
        const todayPadded = `0${month}`.slice(-2) + '/' + `0${day}`.slice(-2);

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
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('30 22 * * 0,6', sendCertReport, { timezone: 'Asia/Seoul' });
    cron.schedule('0 23 * * 1,2,3,4,5', sendCertReport, { timezone: 'Asia/Seoul' });
}