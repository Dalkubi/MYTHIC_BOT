// 사용자에게 보이는 문구(서버 이름, 환영/작별/자기소개 안내, 패널, 안내 메시지)를 관리합니다.
//
// - 실제 문구는 config/messages.json 에서 수정합니다. 코드를 고칠 필요가 없습니다.
// - 파일이 없거나 일부 항목이 빠져 있어도 아래 DEFAULTS 로 대체되므로 봇이 멈추지 않습니다.
// - 문구 안의 {이름} 은 실행 중에 값으로 바뀌는 자리표시자입니다. (예: {server}, {count})
// - 문구를 여러 줄로 쓰고 싶으면 배열로 적으면 줄바꿈으로 이어집니다.
// - 수정한 내용은 봇을 재시작하면 반영됩니다.
//
// 채널 이름 형식("[ 1 ] 스쿼드 정규" 등)은 봇이 이름을 읽어 번호를 계산하는 데 쓰이므로
// 문구 파일이 아니라 channelTypes.js 에서 관리합니다.

const fs = require('fs');
const path = require('path');

// 테스트나 다른 경로 사용을 위해 환경변수 BOT_CONFIG_DIR 로 설정 폴더를 바꿀 수 있습니다.
const CONFIG_DIR = process.env.BOT_CONFIG_DIR || path.join(__dirname, '..', '..', 'config');
const MESSAGES_PATH = path.join(CONFIG_DIR, 'messages.json');

const DEFAULTS = {
    server: {
        name: 'MYTHIC',
    },

    // 서버 입장 환영 메시지
    welcome: {
        title: '👋 WELCOME TO {server}',
        description: [
            '{member} 님, {server}에 오신 것을 환영합니다! 🔺',
            '',
            '📢 공지사항과 📜 서버 규칙을 꼭 확인해주세요.',
            '{server}에서 즐거운 시간 보내세요!',
        ],
        footer: '현재 {count}명',
    },

    // 서버 퇴장 메시지
    goodbye: {
        title: '😢 GOODBYE FROM {server}',
        description: [
            '{mention} 님이 {server}을 떠났습니다.',
            '**{tag}**',
            '',
            '함께했던 시간 즐거웠습니다.',
            '다음에 또 만나요! 👋',
        ],
        footer: '현재 {count}명',
        unknownUser: '알 수 없는 유저',
    },

    // 자기소개 채널 맨 아래에 계속 유지되는 안내 메시지
    intro: {
        title: '🔺ㅣ{server} 자기소개',
        description: [
            '**닉네임** : ',
            '**나이** : ',
            '**마이크** : O / X',
            '**가입경로** : ',
            '**한마디** : ',
        ],
        footer: '위 형식에 맞춰 자유롭게 자기소개를 남겨주세요!',
    },

    // 통화방 컨트롤 패널
    panel: {
        title: '### {channel}입니다',
        subtitle: '아래 선택창을 사용해 채널을 편집하세요.',
        ownerLine: '• 소유주 : <@{owner}>',
        categoryLine: '• 카테고리 : **{label}**',
        permissionNotice: '• 선택 메뉴는 채널 생성자(방장)와 관리자만 사용할 수 있습니다.',
        settingsFree: '**채널 설정**\n이름 변경, 인원 제한, 상태 메시지를 관리합니다.',
        settingsFixed: '**채널 설정**\n이 유형은 이름과 인원수가 고정되어 있으며, 상태 메시지만 설정할 수 있습니다.',
        permissions: '**채널 권한**\n채널 잠금, 잠금 해제, 유저 입장 허용, 차단, 권한 초기화를 처리합니다.',
        footerWarning: '⚠️ 이 메시지는 채널 정보 확인용으로 사용되니 삭제하지 마세요.',
        settingPlaceholder: '채널 설정',
        permissionPlaceholder: '채널 권한',
        options: {
            rename: { label: '채널 이름 변경', description: '원하는 채널 이름을 직접 입력합니다.' },
            limit: { label: '인원 제한 설정', description: '0~99 사이의 숫자를 직접 입력합니다.' },
            status: { label: '상태 메시지 설정', description: '통화방 상태 문구를 입력하거나 비워서 삭제합니다.' },
            lock: { label: '채널 잠금', description: '새로운 유저가 입장하지 못하게 막습니다.' },
            unlock: { label: '채널 잠금 해제', description: '잠금 권한을 해제해 다시 입장 가능하게 합니다.' },
            allow: { label: '유저 입장 허용', description: '선택한 유저가 채널에 들어올 수 있게 합니다.' },
            deny: { label: '유저 입장 차단', description: '선택한 유저가 채널에 들어오지 못하게 합니다.' },
            reset: { label: '유저 권한 초기화', description: '선택한 유저의 개별 권한 설정을 지웁니다.' },
        },
    },

    // 패널 조작 시 나오는 안내 메시지 (본인에게만 보임)
    interaction: {
        commandError: '⚠️ 명령어 처리 중 오류가 발생했습니다.',
        channelNotFound: '❌ 채널을 찾을 수 없습니다.',
        ownerUnknown: '❌ 채널 소유자 정보를 확인할 수 없습니다. 새 통화방을 생성한 뒤 다시 시도해주세요.',
        notOwner: '❌ 이 채널의 생성자(방장) 또는 관리자만 설정을 변경할 수 있습니다.',
        fixedLocked: '🔒 이 채널은 이름과 인원수가 고정되어 있어 변경할 수 없습니다. 상태 메시지만 설정할 수 있습니다.',
        unknownSetting: '❌ 알 수 없는 채널 설정입니다.',

        renameDone: '✅ 채널 이름을 "{name}"(으)로 변경했습니다.',
        renameReset: '⚠️ 고정형 방 이름과 비슷한 형식이라 기본 이름 "{name}"(으)로 설정했습니다.',
        renameFailed: '❌ 채널 이름 변경에 실패했습니다. 잠시 후 다시 시도해주세요. (디스코드 제한으로 채널 이름은 10분에 2번까지만 바꿀 수 있습니다)',
        renameSlow: '⏳ 디스코드 제한으로 이름 변경이 지연되고 있습니다. 잠시 뒤 자동으로 반영될 수 있습니다.',

        limitInvalid: '❌ 인원 제한은 0부터 99까지의 정수로 입력해주세요. 0은 무제한입니다.',
        limitDone: '✅ 인원 제한을 {limit}(으)로 변경했습니다.',
        limitUnlimited: '무제한',
        limitCount: '{count}명',
        limitFailed: '❌ 인원 제한 변경에 실패했습니다. 잠시 후 다시 시도해주세요.',

        statusSet: '✅ 채널 상태를 "{status}"(으)로 설정했습니다.',
        statusCleared: '✅ 채널 상태를 초기화했습니다.',
        statusFailed: '❌ 채널 상태 변경에 실패했습니다. 봇에 "채널 관리" 권한이 있는지 확인해주세요.',

        locked: '🔒 채널을 잠갔습니다. 지금 방에 있는 사람은 끊겨도 다시 들어올 수 있고, 새 유저는 입장할 수 없습니다.',
        unlocked: '🔓 채널 잠금을 해제했습니다.',
        permissionFailed: '❌ 권한 변경에 실패했습니다. 봇에 "채널 관리" 권한이 있는지 확인해주세요.',
        userSelectPlaceholder: '권한을 적용할 유저를 선택하세요',
        promptAllow: '입장을 허용할 유저를 선택하세요.',
        promptDeny: '입장을 차단할 유저를 선택하세요.',
        promptReset: '개별 권한을 초기화할 유저를 선택하세요.',
        resultAllow: '✅ <@{user}> 님의 채널 입장을 허용했습니다.',
        resultDeny: '⛔ <@{user}> 님의 채널 입장을 차단했습니다.',
        resultReset: '♻️ <@{user}> 님의 개별 권한을 초기화했습니다.',

        modalRenameTitle: '채널 이름 변경',
        modalRenameLabel: '새 채널 이름',
        modalLimitTitle: '인원 제한 설정',
        modalLimitLabel: '인원 제한 숫자 입력 (0 = 무제한, 최대 99)',
        modalLimitPlaceholder: '예: 5',
        modalStatusTitle: '채널 상태 설정',
        modalStatusLabel: '상태 메시지 (비우면 삭제)',
    },
};

// 사용자 설정을 기본값 위에 덧씌웁니다. 형태(문자열/배열/객체)가 다른 값은 무시하고 기본값을 씁니다.
function merge(base, override, trail = '') {
    if (override === undefined || override === null) return base;

    if (Array.isArray(base)) {
        const valid = Array.isArray(override) && override.every((line) => typeof line === 'string');
        if (!valid) console.warn(`⚠️ messages.json 의 "${trail}" 항목 형식이 올바르지 않아 기본 문구를 사용합니다.`);
        return valid ? override : base;
    }

    if (typeof base === 'object') {
        if (typeof override !== 'object' || Array.isArray(override)) {
            console.warn(`⚠️ messages.json 의 "${trail}" 항목 형식이 올바르지 않아 기본 문구를 사용합니다.`);
            return base;
        }
        const result = {};
        for (const key of Object.keys(base)) {
            result[key] = merge(base[key], override[key], trail ? `${trail}.${key}` : key);
        }
        return result;
    }

    if (typeof override !== 'string') {
        console.warn(`⚠️ messages.json 의 "${trail}" 항목은 문자열이어야 해서 기본 문구를 사용합니다.`);
        return base;
    }
    return override;
}

function loadMessages() {
    if (!fs.existsSync(MESSAGES_PATH)) return DEFAULTS;

    try {
        const custom = JSON.parse(fs.readFileSync(MESSAGES_PATH, 'utf-8'));
        return merge(DEFAULTS, custom);
    } catch (err) {
        console.error(`❌ config/messages.json 을 읽을 수 없어 기본 문구를 사용합니다: ${err.message}`);
        return DEFAULTS;
    }
}

const messages = loadMessages();

// 점(.)으로 이어진 경로의 문구를 가져와 {자리표시자}를 값으로 바꿔 돌려줍니다.
// 배열로 적힌 문구는 줄바꿈으로 이어 붙입니다.
function t(keyPath, vars = {}) {
    let node = messages;
    for (const key of keyPath.split('.')) {
        node = node?.[key];
    }

    if (node === undefined) {
        console.warn(`⚠️ 알 수 없는 문구 키: ${keyPath}`);
        return keyPath;
    }

    const text = Array.isArray(node) ? node.join('\n') : String(node);
    const allVars = { server: messages.server.name, ...vars };
    return text.replace(/\{(\w+)\}/g, (whole, name) => (name in allVars ? String(allVars[name]) : whole));
}

module.exports = { t, DEFAULTS, loadMessages };
