// data/settings.json 을 이용해 서버(길드)별 설정을 영구 저장합니다.
// 구조: { "길드ID": { createChannelIds, channelLabels, opsLogChannelId, ... } }
//
// 안전장치
//  - 저장은 임시 파일에 먼저 쓴 뒤 교체(rename)하므로, 저장 도중 프로세스가 종료돼도 파일이 반쯤만 써지지 않습니다.
//  - 교체 직전에 직전 정상본을 settings.json.bak 로 남겨 둡니다.
//  - 읽기에 실패하면(파일 손상) 손상된 파일을 settings.corrupt-<시각>.json 으로 따로 보관하고
//    .bak 에서 복구를 시도합니다. 빈 설정으로 조용히 덮어써서 설정이 전부 사라지는 일이 없도록 합니다.
//
// 테스트나 다른 경로 사용을 위해 환경변수 BOT_DATA_DIR 로 저장 폴더를 바꿀 수 있습니다.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.BOT_DATA_DIR || path.join(__dirname, '..', 'data');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const BACKUP_PATH = `${SETTINGS_PATH}.bak`;

// 최초 실행 시 파일이 없으면 빈 객체로 생성
function ensureFile() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(SETTINGS_PATH)) {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify({}, null, 2), 'utf-8');
    }
}

// 손상된 설정 파일을 지우지 않고 옆으로 치워 둡니다. (원인 분석/수동 복구용)
function quarantineCorruptFile() {
    try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const target = path.join(DATA_DIR, `settings.corrupt-${stamp}.json`);
        fs.renameSync(SETTINGS_PATH, target);
        return target;
    } catch (err) {
        console.error('❌ 손상된 settings.json 보관 실패:', err.message);
        return null;
    }
}

// 직전 정상본(.bak)을 읽어 봅니다. 없거나 이것도 손상됐으면 null
function readBackup() {
    try {
        if (!fs.existsSync(BACKUP_PATH)) return null;
        return JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf-8'));
    } catch {
        return null;
    }
}

function loadAll() {
    ensureFile();

    try {
        return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    } catch (err) {
        console.error(`❌ data/settings.json 을 읽을 수 없습니다(손상 추정): ${err.message}`);
        const movedTo = quarantineCorruptFile();
        if (movedTo) console.error(`   손상된 파일은 ${path.basename(movedTo)} 로 보관했습니다.`);

        const restored = readBackup();
        if (restored) {
            console.error('   직전 정상본(settings.json.bak)으로 복구했습니다.');
            saveAll(restored);
            return restored;
        }

        console.error('   복구할 백업이 없어 빈 설정으로 시작합니다. 보관된 손상 파일에서 값을 확인하세요.');
        return {};
    }
}

function saveAll(data) {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const tmpPath = `${SETTINGS_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');

    // 교체 직전 정상본을 백업해 두고, 임시 파일을 원자적으로 교체
    try {
        if (fs.existsSync(SETTINGS_PATH)) fs.copyFileSync(SETTINGS_PATH, BACKUP_PATH);
    } catch (err) {
        console.error('⚠️ settings.json 백업 실패:', err.message);
    }
    fs.renameSync(tmpPath, SETTINGS_PATH);
}

function getGuildSettings(guildId) {
    const all = loadAll();
    return all[guildId] || {};
}

function updateGuildSettings(guildId, partial) {
    const all = loadAll();
    all[guildId] = { ...(all[guildId] || {}), ...partial };
    saveAll(all);
    return all[guildId];
}

module.exports = { getGuildSettings, updateGuildSettings };
