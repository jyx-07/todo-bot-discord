import cron from 'node-cron';
import { client, planMap, certMap } from './index';

export function startScheduler() {
    cron.schedule('0 8 * * *', async () => {
        const guild = await client.guilds.fetch(process.env.GUILD_ID!);
        const members = await guild.members.fetch();
        const admin = await client.users.fetch(process.env.ADMIN_ID!);

        const written: string[] = [];
        const notWritten: string[] = [];

        members.forEach(member => {
            if (member.user.bot) return;
            if (planMap.has(member.id)) {
                written.push(`✅ ${member.displayName}: ${planMap.get(member.id)!.join(', ')}`);
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

        await admin.send(msg);
        planMap.clear();
    }, { timezone: 'Asia/Seoul' });

    cron.schedule('0 22 * * *', async () => {
        const guild = await client.guilds.fetch(process.env.GUILD_ID!);
        const members = await guild.members.fetch();
        const admin = await client.users.fetch(process.env.ADMIN_ID!);

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

        await admin.send(msg);

        for (const [userId, url] of certMap.entries()) {
            const member = await guild.members.fetch(userId);
            await admin.send({ content: `📎 ${member.displayName}`, files: [url] });
        }

        certMap.clear();
    }, { timezone: 'Asia/Seoul' });
}
