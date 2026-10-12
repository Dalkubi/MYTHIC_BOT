const { Events, ChannelType } = require('discord.js');
const { getGuildSettings } = require('../config');
const tempChannels = require('../utils/tempChannels');
const { buildPanel } = require('../utils/panel');
const { sortTempChannels } = require('../utils/channelSort');
const ownership = require('../utils/ownership');
const opsLog = require('../utils/opsLog');
const {
    getTypeConfig,
    isFixedType,
    buildChannelName,
    nextNumber,
    resolveChannelLabel,
} = require('../utils/channelTypes');

// 같은 사람이 트리거 채널에 연달아 입장해 방을 계속 만드는 것(도배)을 막는 최소 간격
const CREATE_COOLDOWN_MS = 5 * 1000;

// 디스코드 카테고리 하나에 둘 수 있는 채널 수 한도
const CATEGORY_CHANNEL_LIMIT = 50;

// userId -> 마지막으로 방을 만든 시각
const createCooldowns = new Map();

// 같은 서버에서 여러 명이 동시에 입장해도 번호가 겹치지 않도록 생성 작업을 한 줄로 세웁니다.
const guildLocks = new Map();
function withGuildLock(guildId, task) {
    const previous = guildLocks.get(guildId) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    guildLocks.set(guildId, next);
    return next;
}

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        const guild = newState.guild;
        const settings = getGuildSettings(guild.id);
        const channelChanged = oldState.channelId !== newState.channelId;

        // 0) 방장 승계 기준이 되는 입장 시각 기록 (음소거/화면공유 같은 상태 변화는 무시)
        if (channelChanged) {
            if (oldState.channelId) ownership.recordLeave(oldState.channelId, oldState.id);
            if (newState.channelId && tempChannels.isTempChannel(newState.channelId)) {
                ownership.recordJoin(newState.channelId, newState.id);
            }
        }

        // 1) 이전에 있던 채널이 "봇이 만든 임시 채널"이라면 먼저 정리 (삭제 또는 방장 승계)
        //    새 방 생성보다 먼저 처리해야, 방을 나와 바로 다른 트리거에 들어간 사람의 방장 정보가 정리된 상태가 됩니다.
        if (channelChanged && oldState.channelId && tempChannels.isTempChannel(oldState.channelId)) {
            await handleLeave(oldState, guild);
        }

        // 2) 등록된 트리거 채널 중 하나에 새로 입장한 경우 -> 개인 채널 생성
        const triggerIds = settings.createChannelIds || [];
        if (channelChanged && triggerIds.includes(newState.channelId)) {
            await handleCreate(newState, settings);
        }
    },
};

// 임시 채널에서 누군가 나갔을 때: 비었으면 삭제, 방장이 나갔으면 즉시 승계
async function handleLeave(oldState, guild) {
    const leftChannel = oldState.channel;
    if (!leftChannel) return;

    if (leftChannel.members.size === 0) {
        tempChannels.removeChannel(leftChannel.id);
        ownership.forgetChannel(leftChannel.id);
        await leftChannel.delete('임시 채널 - 인원 없음으로 자동 삭제').catch((err) => {
            console.error(`임시 채널 삭제 실패(${leftChannel.id}):`, err.message);
            opsLog.error('임시 채널 삭제 실패', err, {
                guildId: guild.id,
                key: 'channel-delete',
                detail: `채널: ${leftChannel.name}`,
            });
        });
        return;
    }

    if (tempChannels.getOwner(leftChannel.id) === oldState.id) {
        await handleOwnerLeft(leftChannel, oldState.id);
    }
}

// 방장이 나간 방에서 가장 오래 남아 있던 사람에게 방장을 넘깁니다.
async function handleOwnerLeft(channel, previousOwnerId) {
    try {
        const successor = ownership.pickSuccessor(channel, previousOwnerId);
        if (!successor) return; // 사람이 아닌 계정만 남았다면 정리 작업이 처리

        await ownership.transferOwnership(channel, successor);
    } catch (err) {
        console.error(`방장 승계 실패(${channel.id}):`, err);
        opsLog.error('방장 승계 실패', err, {
            guildId: channel.guild.id,
            key: 'ownership-transfer',
            detail: `채널: ${channel.name}`,
        });
    }
}

// 만들어졌지만 생성자가 이동해 오지 못한 빈 채널을 바로 지웁니다.
// (생성자가 이동 전에 접속을 끊은 경우 등. 5분 점검까지 빈 방과 번호가 남아 있지 않도록)
async function discardUnusedChannel(channel) {
    if (channel.members.size > 0) return;

    tempChannels.removeChannel(channel.id);
    ownership.forgetChannel(channel.id);
    await channel.delete('임시 채널 - 생성자가 이동하지 못해 삭제').catch((err) => {
        console.error(`미사용 임시 채널 삭제 실패(${channel.id}):`, err.message);
        opsLog.error('임시 채널 삭제 실패', err, {
            guildId: channel.guild.id,
            key: 'channel-delete',
            detail: `채널: ${channel.name}`,
        });
    });
}

// 생성 도배 방지: 직전 생성 후 일정 시간이 지나지 않았다면 true
function isOnCooldown(userId) {
    const now = Date.now();

    // 쌓이지 않도록 오래된 기록은 함께 정리
    for (const [id, at] of createCooldowns) {
        if (now - at >= CREATE_COOLDOWN_MS) createCooldowns.delete(id);
    }

    if (createCooldowns.has(userId)) return true;
    createCooldowns.set(userId, now);
    return false;
}

async function handleCreate(newState, settings) {
    const guild = newState.guild;
    const member = newState.member;
    const triggerChannel = newState.channel;
    const parentId = settings.createCategoryId || triggerChannel.parentId;

    // 도배 방지: 방금 방을 만든 사람이 곧바로 다시 입장해도 새 방을 만들지 않습니다.
    if (isOnCooldown(member.id)) return;

    // 카테고리 채널 수 한도(50개)에 이미 도달했다면 생성을 시도하지 않고 운영 로그로 알립니다.
    if (parentId) {
        const siblingCount = guild.channels.cache.filter((channel) => channel.parentId === parentId).size;
        if (siblingCount >= CATEGORY_CHANNEL_LIMIT) {
            const err = Object.assign(new Error('카테고리 채널 수 한도에 도달해 통화방을 만들 수 없습니다.'), {
                code: 30013,
            });
            opsLog.error('통화방 생성 불가', err, {
                guildId: guild.id,
                key: 'category-full',
                detail: `카테고리 ID: ${parentId} / 현재 채널 ${siblingCount}개`,
            });
            return;
        }
    }

    // 트리거 채널에 지정된 유형 (정규/기밀/극비/전면전/폭파전/자유 ...)
    const type = resolveChannelLabel(guild.id, triggerChannel);
    const typeConfig = getTypeConfig(type);
    const fixed = isFixedType(type);
    const displayName = member.displayName || member.user.username;

    // 방장에게는 채널 개별 권한을 따로 주지 않습니다.
    // 이름/인원 제한/상태 메시지/입장 허용·차단은 모두 봇이 패널을 통해 대신 처리하므로
    // 방장은 패널의 "소유주" 표시와 소유자 검증값으로만 구분됩니다.

    let newChannel = null;

    try {
        await withGuildLock(guild.id, async () => {
            // 같은 카테고리 안에서 해당 유형의 비어 있는 가장 작은 번호를 부여
            const number = fixed ? nextNumber(guild, parentId, type) : null;

            newChannel = await guild.channels.create({
                name: buildChannelName(type, number, displayName),
                type: ChannelType.GuildVoice,
                parent: parentId || null,
                // 고정형은 정해진 인원수로 생성, 자유형은 무제한(기존 정책)
                ...(fixed ? { userLimit: typeConfig.limit } : {}),
            });

            tempChannels.track(newChannel.id, { owner: member.id, type, number });

            // 새 채널이 생기면 카테고리 안의 임시 채널을 유형/번호 순으로 정렬
            await sortTempChannels(guild, newChannel.parentId).catch((err) => {
                console.error('임시 채널 정렬 실패:', err.message);
                opsLog.error('임시 채널 정렬 실패', err, { guildId: guild.id, key: 'channel-sort' });
            });
        });

        // 생성자를 새 채널로 이동. 이동하지 못했다면(이미 접속을 끊은 경우 등) 빈 채널을 바로 정리
        const moved = await member.voice.setChannel(newChannel).then(
            () => true,
            () => false
        );
        if (!moved) {
            await discardUnusedChannel(newChannel);
            return;
        }

        // 음성채널 자체 채팅(내장 텍스트 채팅)에 컨트롤 패널 전송
        const panel = buildPanel(newChannel, member.id, type, { fixed });
        await newChannel.send(panel).catch((err) => {
            console.error('패널 전송 실패:', err.message);
            opsLog.error('컨트롤 패널 전송 실패', err, { guildId: guild.id, key: 'panel-send' });
        });
    } catch (err) {
        console.error('임시 채널 생성 실패:', err);
        opsLog.error('임시 채널 생성 실패', err, {
            guildId: guild.id,
            key: 'channel-create',
            detail: `유형: ${type} / 트리거: ${triggerChannel.name}`,
        });
    }
}
