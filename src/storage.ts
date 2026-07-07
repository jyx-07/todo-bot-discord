import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

export type PlanEntry = { date: string; plans: string[]; links?: string[] };

export type PendingCertReport = {
    summary: string;
    perUser: { content: string; files: string[] }[];
};

export type PendingPlanReport = {
    summary: string;
};

export type PlanReminderSnapshot = Record<string, string>;

interface StoreShape {
    plans: Record<string, PlanEntry>;
    certs: Record<string, string[]>;
    pendingPlanReport: PendingPlanReport | null;
    pendingCertReport: PendingCertReport | null;
    pendingPlanReminder: PlanReminderSnapshot | null;
}

function readStore(): StoreShape {
    try {
        const raw = fs.readFileSync(STORE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
            plans: parsed.plans ?? {},
            certs: parsed.certs ?? {},
            pendingPlanReport: parsed.pendingPlanReport ?? null,
            pendingCertReport: parsed.pendingCertReport ?? null,
            pendingPlanReminder: parsed.pendingPlanReminder ?? null,
        };
    } catch {
        return { plans: {}, certs: {}, pendingPlanReport: null, pendingCertReport: null, pendingPlanReminder: null };
    }
}

export const planMap = new Map<string, PlanEntry>();
export const certMap = new Map<string, string[]>();
export let pendingPlanReport: PendingPlanReport | null = null;
export let pendingCertReport: PendingCertReport | null = null;
export let pendingPlanReminder: PlanReminderSnapshot | null = null;

export function setPendingPlanReport(report: PendingPlanReport | null) {
    pendingPlanReport = report;
    saveStore();
}

export function setPendingCertReport(report: PendingCertReport | null) {
    pendingCertReport = report;
    saveStore();
}

export function setPendingPlanReminder(snapshot: PlanReminderSnapshot | null) {
    pendingPlanReminder = snapshot;
    saveStore();
}

export function loadStore() {
    const store = readStore();
    planMap.clear();
    certMap.clear();
    for (const [id, entry] of Object.entries(store.plans)) planMap.set(id, entry);
    for (const [id, urls] of Object.entries(store.certs))
        certMap.set(id, Array.isArray(urls) ? urls : [urls as unknown as string]);
    pendingPlanReport = store.pendingPlanReport;
    pendingCertReport = store.pendingCertReport;
    pendingPlanReminder = store.pendingPlanReminder;
    console.log(`💾 복원 완료: 계획 ${planMap.size}건, 인증 ${certMap.size}건` +
        (pendingPlanReport || pendingCertReport || pendingPlanReminder ? ' (대기 중인 리포트 복원됨)' : ''));
}

export function saveStore() {
    const store: StoreShape = {
        plans: Object.fromEntries(planMap),
        certs: Object.fromEntries(certMap),
        pendingPlanReport,
        pendingCertReport,
        pendingPlanReminder,
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STORE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, STORE_PATH);
}