// 임시 통화방의 방장(소유자) 자동 승계를 담당합니다.
//
// 규칙
//  - 방장이 방을 나가거나 다른 방으로 이동하면 즉시 승계합니다.
//  - 승계 대상은 "방에 가장 오래 남아 있던 사람"입니다. (봇 계정은 제외)
//  - 입장 시각은 메모리에만 기록합니다. 봇이 재시작되면 기록이 없는 사람끼리는 무작위로 정합니다.
//    (기록이 없는 사람은 봇이 켜지기 전부터 방에 있던 사람이므로 기록이 있는 사람보다 먼저로 취급)
//  - 승계 시 추적 정보와 패널(소유주 표시 및 소유자 검증값)만 새 방장 기준으로 바꿉니다.
//    방장에게는 별도의 채널 권한이 없고(모든 설정은 봇이 패널로 처리), 방 채팅 안내 메시지도 보내지 않습니다.

const tempChannels = require('./tempChannels');
const { isFixedType, parseFixedName } = require('./channelTypes');
const { buildPanel } = require('./panel');
const opsLog = require('./opsLog');

// channelId -> Map(userId -> 입장 시각)
const joinTimes = new Map();

// 같은 채널에서 승계가 동시에 두 번 돌지 않도록 막는 표시
const inFlight = new Set();

function recordJoin(channelId, userId) {
    if (!joinTimes.has(channelId)) joinTimes.set(channelId, new Map());
    joinTimes.get(channelId).set(userId, Date.now());
}

function recordLeave(channelId, userId) {
    joinTimes.get(channelId)?.delete(userId);
}

// 채널이 삭제되면 입장 기록도 같이 정리합니다.
function forgetChannel(channelId) {
    joinTimes.delete(channelId);
}

// 방에 남은 사람 중 가장 오래 있던 사람을 고릅니다. 후보가 없으면 null
function pickSuccessor(channel, excludeUserId) {
    const candidates = [...channel.members.values()].filter(
        (member) => !member.user.bot && member.id !== excludeUserId
    );
    if (candidates.length === 0) return null;

    // 입장 기록이 같은(또는 둘 다 없는) 사람끼리는 무작위가 되도록 먼저 섞은 뒤 안정 정렬
    for (let i = candidates.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const times = joinTimes.get(channel.id);
    candidates.sort((a, b) => (times?.get(a.id) ?? 0) - (times?.get(b.id) ?? 0));
    return candidates[0];
}

// 컴포넌트 트리에서 텍스트를 모두 이어 붙입니다. (패널 안의 owner/source/label 값을 읽기 위함)
function collectText(components) {
    let text = '';
    for (const component of components ?? []) {
        const raw = typeof component.toJSON === 'function' ? component.toJSON() : component;
        if (raw?.content) text += `${raw.content}\n`;
        text += collectText(raw?.components);
    }
    return text;
}

// 음성채널 자체 채팅에서 봇이 보낸 패널 메시지를 찾습니다.
async function findPanelMessage(channel) {
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!messages) return null;

    return (
        messages.find(
            (message) =>
                message.author.id === channel.client.user.id &&
                collectText(message.components).includes(`source:${channel.id}`)
        ) || null
    );
}

// 소유자를 모르는 채널(재시작 후 복구된 채널)은 패널 메시지에서 소유자를 읽어옵니다.
async function recoverOwnerFromPanel(channel) {
    const panel = await findPanelMessage(channel);
    if (!panel) return null;
    return collectText(panel.components).match(/owner:(\d+)/)?.[1] ?? null;
}

// 패널 메시지를 현재 상태(채널 이름, 인원 제한, 소유주)로 다시 그립니다.
// 방장 승계, 이름 변경, 인원 제한 변경 뒤에 호출해 패널의 표시가 옛날 값으로 남지 않게 합니다.
// 패널이 없으면 새로 보냅니다. 소유자를 알 수 없으면 아무것도 하지 않고 false
async function refreshPanel(channel, ownerIdOverride = null) {
    const info = tempChannels.getInfo(channel.id);
    const ownerId = ownerIdOverride || info?.owner || null;
    if (!ownerId) return false;

    const type = info?.type || parseFixedName(channel.name)?.type || null;
    const fixed = isFixedType(type);

    const oldPanel = await findPanelMessage(channel);
    const label =
        (oldPanel && collectText(oldPanel.components).match(/label:([^|\n]+)/)?.[1]) || type || '자유';
    const panelPayload = buildPanel(channel, ownerId, label, { fixed });

    if (oldPanel) await oldPanel.edit(panelPayload);
    else await channel.send(panelPayload);
    return true;
}

// 방장을 newMember 에게 넘깁니다. 성공하면 true
async function transferOwnership(channel, newMember) {
    if (inFlight.has(channel.id)) return false;
    inFlight.add(channel.id);

    try {
        // 1) 추적 정보 갱신 (이후 패널 조작 시 소유자 검증은 이 값을 기준으로 함)
        tempChannels.setOwner(channel.id, newMember.id);

        // 2) 패널 갱신: 소유주 표시와 숨겨진 owner 값을 새 방장으로 교체
        try {
            await refreshPanel(channel, newMember.id);
        } catch (err) {
            console.error(`방장 패널 갱신 실패(${channel.id}):`, err.message);
            opsLog.error('방장 패널 갱신 실패', err, { guildId: channel.guild.id, key: 'ownership-panel' });
        }

        return true;
    } finally {
        inFlight.delete(channel.id);
    }
}

// 방은 사용 중인데 방장이 방에 없는 경우를 바로잡습니다. (봇이 꺼져 있던 동안 방장이 나간 경우 등)
// 승계했다면 true
async function ensureOwnerPresent(channel) {
    const humans = [...channel.members.values()].filter((member) => !member.user.bot);
    if (humans.length === 0) return false;

    let owner = tempChannels.getOwner(channel.id);
    if (!owner) {
        owner = await recoverOwnerFromPanel(channel);
        if (owner) tempChannels.setOwner(channel.id, owner);
    }

    if (owner && channel.members.has(owner)) return false;

    const successor = pickSuccessor(channel, owner);
    if (!successor) return false;

    return transferOwnership(channel, successor);
}

module.exports = {
    findPanelMessage,
    refreshPanel,
    recordJoin,
    recordLeave,
    forgetChannel,
    pickSuccessor,
    transferOwnership,
    ensureOwnerPresent,
};
