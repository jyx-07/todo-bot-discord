import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

export type PlanEntry = { date: string; plans: string[]; links?: string[]; savedAt?: string };

export type PendingCertReport = {
    summary: string;
    perUser: { content: string; files: string[] }[];
};

export type PendingPlanReport = {
    summary: string;
};

export type PlanReminderSnapshot = Record<string, string>;

export type PendingMissReport = {
    message: string;
};

interface StoreShape {
    plans: Record<string, PlanEntry>;
    certs: Record<string, string[]>;
    pendingPlanReport: PendingPlanReport | null;
    pendingCertReport: PendingCertReport | null;
    pendingPlanReminder: PlanReminderSnapshot | null;
    pendingMissReport: PendingMissReport | null;
    missCounts: Record<string, number>;
    missLastDate: string | null;
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
            pendingMissReport: parsed.pendingMissReport ?? null,
            missCounts: parsed.missCounts ?? {},
            missLastDate: parsed.missLastDate ?? null,
        };
    } catch {
        return { plans: {}, certs: {}, pendingPlanReport: null, pendingCertReport: null, pendingPlanReminder: null, pendingMissReport: null, missCounts: {}, missLastDate: null };
    }
}

export const planMap = new Map<string, PlanEntry>();
export const certMap = new Map<string, string[]>();
export let pendingPlanReport: PendingPlanReport | null = null;
export let pendingCertReport: PendingCertReport | null = null;
export let pendingPlanReminder: PlanReminderSnapshot | null = null;
export let pendingMissReport: PendingMissReport | null = null;
export const missCounts = new Map<string, number>();
export let missLastDate: string | null = null;

export function setPendingMissReport(report: PendingMissReport | null) {
    pendingMissReport = report;
    saveStore();
}

export function setMissLastDate(date: string | null) {
    missLastDate = date;
    saveStore();
}

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
    const now = new Date().toISOString();
    for (const [id, entry] of Object.entries(store.plans))
        // savedAt이 없던 구버전 데이터는 지금 저장된 것으로 간주한다 (즉시 만료되지 않도록)
        planMap.set(id, { ...entry, savedAt: entry.savedAt ?? now });
    for (const [id, urls] of Object.entries(store.certs))
        certMap.set(id, Array.isArray(urls) ? urls : [urls as unknown as string]);
    pendingPlanReport = store.pendingPlanReport;
    pendingCertReport = store.pendingCertReport;
    pendingPlanReminder = store.pendingPlanReminder;
    pendingMissReport = store.pendingMissReport;
    missCounts.clear();
    for (const [id, n] of Object.entries(store.missCounts)) missCounts.set(id, n);
    missLastDate = store.missLastDate;
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
        pendingMissReport,
        missCounts: Object.fromEntries(missCounts),
        missLastDate,
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STORE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, STORE_PATH);
}