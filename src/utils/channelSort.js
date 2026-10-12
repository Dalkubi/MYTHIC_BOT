// 카테고리 안의 임시 통화방을 정해진 순서로 자동 정렬합니다.
// 정렬 기준: 유형 순서(정규 → 기밀 → 극비 → 전면전 → 폭파전 → 자유) → 번호 → 생성 시각
//
// 트리거 채널 등 다른 채널의 위치는 건드리지 않습니다.
// 임시 채널들이 차지하고 있는 position 값들을 그대로 두고, 그 값들 사이에서 순서만 재배치합니다.
// (한 번의 API 요청으로 처리되므로 채널 수가 늘어도 레이트리밋 부담이 거의 없습니다.)

const { ChannelType } = require('discord.js');
const tempChannels = require('./tempChannels');
const { TYPE_CONFIG, parseFixedName } = require('./channelTypes');

// 채널의 유형/번호를 추적 정보 또는 이름에서 알아냅니다.
function getChannelMeta(channel) {
    const info = tempChannels.getInfo(channel.id);
    const parsed = parseFixedName(channel.name);

    const type = info?.type || parsed?.type || null;
    const number = info?.number ?? parsed?.number ?? null;
    return { type, number };
}

async function sortTempChannels(guild, parentId) {
    const targetParent = parentId || null;

    const temps = [...guild.channels.cache.values()].filter(
        (channel) =>
            channel.type === ChannelType.GuildVoice &&
            channel.parentId === targetParent &&
            tempChannels.isTempChannel(channel.id)
    );
    if (temps.length < 2) return false;

    // 정렬 기준에 맞춰 원하는 순서를 만들고
    const sorted = [...temps].sort((a, b) => {
        const metaA = getChannelMeta(a);
        const metaB = getChannelMeta(b);
        const orderA = TYPE_CONFIG[metaA.type]?.order ?? 99;
        const orderB = TYPE_CONFIG[metaB.type]?.order ?? 99;

        if (orderA !== orderB) return orderA - orderB;
        if ((metaA.number ?? 0) !== (metaB.number ?? 0)) return (metaA.number ?? 0) - (metaB.number ?? 0);
        return a.createdTimestamp - b.createdTimestamp;
    });

    // 임시 채널들이 쓰고 있던 position 슬롯을 오름차순으로 뽑아 순서대로 다시 배정합니다.
    const slots = temps.map((channel) => channel.rawPosition).sort((a, b) => a - b);
    const changes = sorted
        .map((channel, index) => ({ channel, position: slots[index] }))
        .filter(({ channel, position }) => channel.rawPosition !== position);

    // 이미 정렬된 상태라면 API 호출을 생략
    if (changes.length === 0) return false;

    await guild.channels.setPositions(changes);
    return true; // 실제로 순서를 바꿨다는 뜻 (정리 작업 요약에서 사용)
}

module.exports = { sortTempChannels };
