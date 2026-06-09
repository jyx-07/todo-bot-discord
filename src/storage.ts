import * as fs from 'fs';
import * as path from 'path';

// 볼륨 마운트 경로(fly에서는 /data), 로컬 개발 시 ./data 로 폴백
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

type PlanEntry = { date: string; plans: string[] };

interface StoreShape {
    plans: Record<string, PlanEntry>;
    certs: Record<string, string>;
}

function readStore(): StoreShape {
    try {
        const raw = fs.readFileSync(STORE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
            plans: parsed.plans ?? {},
            certs: parsed.certs ?? {},
        };
    } catch {
        // 파일이 없거나 손상된 경우 빈 상태로 시작
        return { plans: {}, certs: {} };
    }
}

export const planMap = new Map<string, PlanEntry>();
export const certMap = new Map<string, string>();

// 시작 시 디스크에서 복원 (재시작에도 데이터 유지)
export function loadStore() {
    const store = readStore();
    planMap.clear();
    certMap.clear();
    for (const [id, entry] of Object.entries(store.plans)) planMap.set(id, entry);
    for (const [id, url] of Object.entries(store.certs)) certMap.set(id, url);
    console.log(`💾 복원 완료: 계획 ${planMap.size}건, 인증 ${certMap.size}건`);
}

// 변경이 있을 때마다 디스크에 저장
export function saveStore() {
    const store: StoreShape = {
        plans: Object.fromEntries(planMap),
        certs: Object.fromEntries(certMap),
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // 원자적 쓰기: 임시 파일에 쓴 뒤 교체해 부분 쓰기 방지
    const tmp = `${STORE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, STORE_PATH);
}