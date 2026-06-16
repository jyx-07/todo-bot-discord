import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

export type PlanEntry = { date: string; plans: string[] };

interface StoreShape {
    plans: Record<string, PlanEntry>;
    certs: Record<string, string[]>;
}

function readStore(): StoreShape {
    try {
        const raw = fs.readFileSync(STORE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        return { plans: parsed.plans ?? {}, certs: parsed.certs ?? {} };
    } catch {
        return { plans: {}, certs: {} };
    }
}

export const planMap = new Map<string, PlanEntry>();
export const certMap = new Map<string, string[]>();

export function loadStore() {
    const store = readStore();
    planMap.clear();
    certMap.clear();
    for (const [id, entry] of Object.entries(store.plans)) planMap.set(id, entry);
    for (const [id, urls] of Object.entries(store.certs)) certMap.set(id, urls);
    console.log(`💾 복원 완료: 계획 ${planMap.size}건, 인증 ${certMap.size}건`);
}

export function saveStore() {
    const store: StoreShape = {
        plans: Object.fromEntries(planMap),
        certs: Object.fromEntries(certMap),
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STORE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, STORE_PATH);
}