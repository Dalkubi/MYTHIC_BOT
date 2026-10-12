// 통화방 유형 정의 파일입니다.
// - 고정형(정규/기밀/극비/전면전/폭파전): 이름 형식과 인원수가 정해져 있고 소유자가 바꿀 수 없습니다.
//     이름 예) "[ 1 ] 스쿼드 정규"  — 번호는 같은 카테고리 안에서 유형별로 자동 부여
// - 자유형(자유): 기존 방식 그대로 "[자유] ○○님의 채널", 이름/인원수를 소유자가 직접 변경 가능
//
// 유형의 표시 이름, 인원수, 정렬 순서는 아래 TYPE_CONFIG 에서만 수정하면 됩니다.
// (유형을 추가/삭제하면 슬래시 명령어 선택지가 바뀌므로 봇 재시작 시 자동 재등록됩니다.)

const { getGuildSettings } = require('../config');

const TYPE_CONFIG = {
    // order: 카테고리 안에서의 정렬 순서 (작을수록 위)
    // display: 채널 이름에 표시되는 문구, limit: 고정 인원수, fixed: 이름/인원수 변경 불가 여부
    정규: { order: 1, display: '스쿼드 정규', limit: 3, fixed: true },
    기밀: { order: 2, display: '스쿼드 기밀', limit: 3, fixed: true },
    극비: { order: 3, display: '스쿼드 극비', limit: 3, fixed: true },
    전면전: { order: 4, display: '전면전', limit: 4, fixed: true },
    폭파전: { order: 5, display: '폭파전', limit: 5, fixed: true },
    자유: { order: 6, display: '자유', limit: 0, fixed: false },
};

// 설정 가능한 전체 유형 목록 (정렬 순서대로)
const CHANNEL_TYPES = Object.keys(TYPE_CONFIG).sort((a, b) => TYPE_CONFIG[a].order - TYPE_CONFIG[b].order);

// 유형을 따로 지정하지 않은 기존 트리거 채널을 위한 호환용 기본값 (등록 순서 기준)
const LEGACY_ORDER_LABELS = ['정규', '기밀', '전면전'];

function getTypeConfig(type) {
    return TYPE_CONFIG[type] || null;
}

// 이름/인원수가 고정된 유형인지 여부 (알 수 없는 유형은 자유형처럼 취급)
function isFixedType(type) {
    return Boolean(TYPE_CONFIG[type]?.fixed);
}

// 고정형: "[ 번호 ] 표시이름" / 자유형·기타: "[유형] ○○님의 채널"
function buildChannelName(type, number, ownerDisplayName) {
    const cfg = TYPE_CONFIG[type];
    if (cfg?.fixed) {
        return `[ ${number} ] ${cfg.display}`;
    }
    return `[${type}] ${ownerDisplayName}님의 채널`;
}

// 고정형 채널 이름에서 유형과 번호를 역으로 읽어냅니다. (봇 재시작 후 복구/번호 계산용)
// 이전 버전이 만든 "( 인원수 N인 )" 꼬리말이 붙은 이름도 같은 채널로 인식합니다.
const FIXED_NAME_PATTERN = /^\[ (\d+) \] (.+?)(?: \( 인원수 \d+인 \))?$/;

function parseFixedName(name) {
    const match = FIXED_NAME_PATTERN.exec(name);
    if (!match) return null;

    const type = CHANNEL_TYPES.find((t) => TYPE_CONFIG[t].fixed && TYPE_CONFIG[t].display === match[2]);
    if (!type) return null;

    return { type, number: Number(match[1]) };
}

// 고정형 방 이름처럼 보이는 이름인지 느슨하게 판별합니다. ("[1] ...", "[ 2 ] ..." 등 번호 대괄호로 시작)
// 자유형 방의 이름 변경에서 고정형 방을 사칭하는 이름을 걸러내는 데 사용합니다.
function looksLikeFixedName(name) {
    return /^\s*\[\s*\d+\s*\]/.test(String(name ?? ''));
}

// 같은 카테고리(parentId) 안에서 아직 쓰이지 않은 가장 작은 번호를 구합니다.
// 채널 이름 자체를 기준으로 계산하므로 추적 파일이 유실돼도 번호가 꼬이지 않습니다.
function nextNumber(guild, parentId, type) {
    const used = new Set();
    for (const channel of guild.channels.cache.values()) {
        if (channel.parentId !== (parentId || null)) continue;
        const parsed = parseFixedName(channel.name);
        if (parsed?.type === type) used.add(parsed.number);
    }

    let number = 1;
    while (used.has(number)) number += 1;
    return number;
}

// 트리거 채널에 지정된 유형을 찾아 반환합니다.
// 우선순위: 1) 직접 지정한 유형  2) 기존 등록 순서 기본값  3) 채널 이름에서 추출
function resolveChannelLabel(guildId, triggerChannel) {
    const settings = getGuildSettings(guildId);
    const triggerIds = settings.createChannelIds || [];

    // 1) /설정 명령어 또는 channels.json 으로 직접 지정한 유형
    const assigned = settings.channelLabels?.[triggerChannel.id];
    if (assigned) return assigned;

    // 2) 유형 미지정 기존 채널은 예전처럼 등록 순서로 라벨 부여
    const triggerIndex = triggerIds.indexOf(triggerChannel.id);
    if (LEGACY_ORDER_LABELS[triggerIndex]) return LEGACY_ORDER_LABELS[triggerIndex];

    // 3) 그 외에는 "채널 생성하기" 같은 운영용 문구를 제거해 짧은 라벨로 정리
    return (
        triggerChannel.name
            .replace(/채널\s*생성하기/g, '')
            .replace(/생성하기/g, '')
            .replace(/채널/g, '')
            .trim() || `채널${triggerIndex + 1}`
    );
}

module.exports = {
    TYPE_CONFIG,
    CHANNEL_TYPES,
    LEGACY_ORDER_LABELS,
    getTypeConfig,
    isFixedType,
    buildChannelName,
    parseFixedName,
    looksLikeFixedName,
    nextNumber,
    resolveChannelLabel,
};
