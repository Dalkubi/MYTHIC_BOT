// 자동 생성된 임시 음성채널의 정보(소유자/유형/번호)를 추적합니다.
// 봇이 재시작되어도 추적 정보가 사라지지 않도록 data/tempChannels.json 에 저장합니다.
// (메모리에만 두면 재시작 후 "봇이 만든 채널"인지 알 수 없어 빈 채널이 삭제되지 않습니다.)

const fs = require('fs');
const path = require('path');

// 테스트나 다른 경로 사용을 위해 환경변수 BOT_DATA_DIR 로 저장 폴더를 바꿀 수 있습니다.
const DATA_DIR = process.env.BOT_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'tempChannels.json');

// channelId -> { owner: userId|null, type: 유형|null, number: 번호|null }
const entries = new Map();

// 시작 시 저장된 추적 정보를 불러옵니다.
// 이전 버전 파일(channelId -> userId 문자열 형식)도 읽을 수 있도록 변환합니다.
function load() {
    try {
        if (!fs.existsSync(STORE_PATH)) return;
        const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
        for (const [channelId, value] of Object.entries(raw)) {
            if (value && typeof value === 'object') {
                entries.set(channelId, {
                    owner: value.owner || null,
                    type: value.type || null,
                    number: value.number ?? null,
                });
            } else {
                entries.set(channelId, { owner: value || null, type: null, number: null });
            }
        }
    } catch (err) {
        console.error('❌ data/tempChannels.json 불러오기 실패:', err.message);
    }
}

// 변경될 때마다 임시 파일에 쓴 뒤 교체해서 저장 중 종료돼도 파일이 깨지지 않게 합니다.
function save() {
    try {
        fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
        const tmpPath = `${STORE_PATH}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(Object.fromEntries(entries), null, 2), 'utf-8');
        fs.renameSync(tmpPath, STORE_PATH);
    } catch (err) {
        console.error('❌ data/tempChannels.json 저장 실패:', err.message);
    }
}

// 채널을 추적 대상으로 등록합니다. (생성 직후 / 재시작 후 복구 시 사용)
function track(channelId, { owner = null, type = null, number = null } = {}) {
    entries.set(channelId, { owner, type, number });
    save();
}

// 소유자만 갱신합니다. (패널 메시지에서 소유자를 복구했을 때 사용)
function setOwner(channelId, userId) {
    const current = entries.get(channelId) || { owner: null, type: null, number: null };
    if (entries.has(channelId) && current.owner === (userId || null)) return;
    entries.set(channelId, { ...current, owner: userId || null });
    save();
}

function getInfo(channelId) {
    return entries.get(channelId) || null;
}

function getOwner(channelId) {
    return entries.get(channelId)?.owner || null;
}

function isTempChannel(channelId) {
    return entries.has(channelId);
}

function removeChannel(channelId) {
    if (entries.delete(channelId)) save();
}

function allChannelIds() {
    return [...entries.keys()];
}

load();

module.exports = { track, setOwner, getInfo, getOwner, isTempChannel, removeChannel, allChannelIds };
