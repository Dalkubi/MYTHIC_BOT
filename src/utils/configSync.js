// config/channels.json 은 "초기 기본값" 파일입니다.
//
// 봇이 켜질 때 settings.json(명령어로 바꾼 값이 저장되는 곳)에 아직 값이 없는 항목만
// 이 파일의 값으로 채웁니다. 이미 값이 있는 항목은 절대 덮어쓰지 않습니다.
// -> /설정 명령어로 바꾼 값은 봇을 재시작해도 그대로 유지됩니다.
//
// 파일 값을 다시 적용하고 싶다면 data/settings.json 에서 해당 항목을 지우고 재시작하세요.

const fs = require('fs');
const path = require('path');
const { updateGuildSettings, getGuildSettings } = require('../config');

// 테스트나 다른 경로 사용을 위해 환경변수 BOT_CONFIG_DIR 로 설정 폴더를 바꿀 수 있습니다.
const CONFIG_DIR = process.env.BOT_CONFIG_DIR || path.join(__dirname, '..', '..', 'config');
const CHANNELS_CONFIG_PATH = path.join(CONFIG_DIR, 'channels.json');

// 단일 값 설정 키 (파일 값이 비어 있지 않고, 저장된 값이 아직 없을 때만 채움)
const SIMPLE_KEYS = [
    'createCategoryId',
    'joinLogChannelId',
    'leaveLogChannelId',
    'logChannelId', // 레거시 (입장/퇴장 공용) - 새 설정 없을 때 대체용
    'introChannelId',
    'opsLogChannelId', // 봇 운영 알림(시작/에러/정리 결과) 채널
];

function hasValue(value) {
    return value !== undefined && value !== null && value !== '';
}

function syncStaticConfig() {
    if (!fs.existsSync(CHANNELS_CONFIG_PATH)) {
        console.log('ℹ️ config/channels.json 이 없어 초기값 적용을 건너뜁니다. (명령어로 설정한 값만 사용)');
        return;
    }

    let data;
    try {
        data = JSON.parse(fs.readFileSync(CHANNELS_CONFIG_PATH, 'utf-8'));
    } catch (err) {
        console.error('❌ config/channels.json 파싱 실패:', err.message);
        return;
    }

    for (const [guildId, cfg] of Object.entries(data)) {
        const current = getGuildSettings(guildId);
        const patch = {};

        // 트리거 채널 목록: 저장된 목록이 아직 없을 때만 파일 값으로 채움
        // (명령어로 모두 제거해 빈 목록이 저장된 경우에도 파일이 다시 되살리지 않음)
        if (current.createChannelIds === undefined && Array.isArray(cfg.createChannelIds)) {
            const ids = cfg.createChannelIds.filter(Boolean);
            if (ids.length > 0) patch.createChannelIds = ids;
        }

        // 트리거 채널별 유형: 저장된 유형이 없는 채널만 파일 값으로 채움 (저장된 값 우선)
        if (cfg.channelLabels && typeof cfg.channelLabels === 'object') {
            const merged = { ...cfg.channelLabels, ...(current.channelLabels || {}) };
            if (Object.keys(merged).length !== Object.keys(current.channelLabels || {}).length) {
                patch.channelLabels = merged;
            }
        }

        // 나머지 단일 값: 저장된 값이 없을 때만 채움
        for (const key of SIMPLE_KEYS) {
            if (hasValue(cfg[key]) && !hasValue(current[key])) patch[key] = cfg[key];
        }

        if (Object.keys(patch).length > 0) {
            updateGuildSettings(guildId, patch);
            console.log(
                `⚙️  config/channels.json 초기값을 서버(${guildId})에 적용했습니다: ${Object.keys(patch).join(', ')}`
            );
        }
    }
}

module.exports = { syncStaticConfig };
