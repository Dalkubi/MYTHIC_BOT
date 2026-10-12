// 임시 음성채널을 주기적으로 점검해서 정리합니다.
// - 봇이 꺼져 있는 동안 사람들이 모두 나간 빈 채널 삭제
// - 추적 파일이 도입되기 전(재시작으로 기록이 사라진) 과거 임시 채널 복구/삭제
// - 방은 사용 중인데 방장이 방에 없는 경우 방장 승계
// - 카테고리 안 정렬 상태 보정
// 을 시작 시 한 번, 이후 5분마다 수행하고 결과를 운영 알림 로그로 요약해서 보냅니다.

const { ChannelType } = require('discord.js');
const tempChannels = require('./tempChannels');
const { sortTempChannels } = require('./channelSort');
const { parseFixedName } = require('./channelTypes');
const ownership = require('./ownership');
const opsLog = require('./opsLog');

// 봇이 만든 임시 채널의 이름 형식
//  - 자유형/이전 버전: "[유형] ○○님의 채널"
//  - 고정형: "[ 1 ] 스쿼드 정규" (channelTypes.parseFixedName 으로 판별)
const FREE_NAME_PATTERN = /^\[.+\] .+님의 채널$/;

// 방금 만들어져 아직 생성자가 이동해 오기 전인 채널을 건드리지 않기 위한 유예 시간
const GRACE_MS = 60 * 1000;

// 주기 점검 간격
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function looksLikeTempChannel(channel) {
    return FREE_NAME_PATTERN.test(channel.name) || parseFixedName(channel.name) !== null;
}

// stats: { deleted, recovered, transferred, sorted } — 정리 작업 결과 집계
async function sweepGuild(guild, stats) {
    // 1) 추적 중인 채널: 비어 있으면 삭제
    for (const channelId of tempChannels.allChannelIds()) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel) continue; // 다른 서버 소속일 수 있으므로 여기서는 건드리지 않음
        if (await deleteIfEmpty(channel)) stats.deleted += 1;
    }

    // 2) 추적 기록은 없지만 이름 형식이 임시 채널과 같은 채널 (재시작으로 기록이 유실된 경우)
    for (const channel of guild.channels.cache.values()) {
        if (channel.type !== ChannelType.GuildVoice) continue;
        if (tempChannels.isTempChannel(channel.id)) continue;
        if (!looksLikeTempChannel(channel)) continue;
        // 봇이 만든 채널만 대상으로 하기 위해 봇이 보낸 패널 메시지(또는 이전 버전의 생성자 개별 권한)가 있는지 확인
        if (!(await isBotCreated(channel))) continue;

        if (channel.members.size === 0) {
            if (await deleteIfEmpty(channel)) stats.deleted += 1;
        } else {
            // 사용 중인 채널은 앞으로 추적 대상으로 등록 (소유자는 패널에서 복구됨)
            const parsed = parseFixedName(channel.name);
            tempChannels.track(channel.id, {
                owner: null,
                type: parsed?.type ?? null,
                number: parsed?.number ?? null,
            });
            stats.recovered += 1;
        }
    }

    // 3) 방장이 방에 없는 채널은 방장 승계 (봇이 꺼져 있던 동안 방장이 나간 경우 등)
    for (const channelId of tempChannels.allChannelIds()) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel || channel.type !== ChannelType.GuildVoice) continue;
        if (Date.now() - channel.createdTimestamp < GRACE_MS) continue; // 방금 만든 채널은 생성자 이동 대기

        try {
            if (await ownership.ensureOwnerPresent(channel)) stats.transferred += 1;
        } catch (err) {
            console.error(`방장 승계 점검 실패(${channel.id}):`, err.message);
            opsLog.error('방장 승계 실패', err, {
                guildId: guild.id,
                key: 'ownership-transfer',
                detail: `채널: ${channel.name}`,
            });
        }
    }

    // 4) 삭제/복구 이후 카테고리별로 정렬 상태 점검
    const parentIds = new Set(
        [...guild.channels.cache.values()]
            .filter((channel) => channel.type === ChannelType.GuildVoice && tempChannels.isTempChannel(channel.id))
            .map((channel) => channel.parentId)
    );
    for (const parentId of parentIds) {
        try {
            if (await sortTempChannels(guild, parentId)) stats.sorted += 1;
        } catch (err) {
            console.error('임시 채널 정렬 실패:', err.message);
            opsLog.error('임시 채널 정렬 실패', err, { guildId: guild.id, key: 'channel-sort' });
        }
    }
}

// 봇이 만든 임시 채널인지 확인합니다.
//  - 현재 버전: 음성채널 채팅에 봇이 보낸 패널 메시지가 있음
//  - 이전 버전: 생성 시 봇이 부여한 생성자 개별 권한(멤버 이동)이 있음
async function isBotCreated(channel) {
    const hasOldOverwrite = channel.permissionOverwrites.cache.some(
        (ow) => ow.type === 1 && ow.allow.has('MoveMembers')
    );
    if (hasOldOverwrite) return true;

    return Boolean(await ownership.findPanelMessage(channel));
}

// 비어 있는 채널을 삭제합니다. 실제로 삭제했다면 true
async function deleteIfEmpty(channel) {
    if (channel.members.size > 0) return false;
    if (Date.now() - channel.createdTimestamp < GRACE_MS) return false;

    tempChannels.removeChannel(channel.id);
    ownership.forgetChannel(channel.id);

    try {
        await channel.delete('임시 채널 - 인원 없음으로 자동 삭제');
        return true;
    } catch (err) {
        console.error(`임시 채널 삭제 실패(${channel.id}):`, err.message);
        opsLog.error('임시 채널 삭제 실패', err, {
            guildId: channel.guild.id,
            key: 'channel-delete',
            detail: `채널: ${channel.name}`,
        });
        return false;
    }
}

// 모든 서버를 점검하고 서버별 결과(Map<guildId, stats>)를 돌려줍니다.
// silent 가 아니면 변화가 있었던 서버의 운영 로그 채널로 요약을 보냅니다.
async function sweepAll(client, { silent = false } = {}) {
    const results = new Map();
    let allFetched = true; // 모든 서버의 채널 목록을 정상적으로 가져왔는지 (추적 목록 정리 안전장치)

    for (const guild of client.guilds.cache.values()) {
        const stats = opsLog.emptyStats();
        try {
            // 캐시가 비어 있을 수 있으므로 채널 목록을 최신으로 가져옵니다.
            await guild.channels.fetch();
            await sweepGuild(guild, stats);
        } catch (err) {
            allFetched = false;
            console.error(`임시 채널 정리 실패(${guild.id}):`, err.message);
            opsLog.error('임시 채널 정리 실패', err, { guildId: guild.id, key: 'sweep' });
        }

        results.set(guild.id, stats);
        if (!silent) await opsLog.sweepSummary(guild.id, stats);
    }

    // 봇이 꺼져 있는 동안 삭제된 채널처럼, 어느 서버에도 없는 채널의 추적 정보를 정리합니다.
    // 일부 서버의 채널 목록을 가져오지 못했다면 오삭제를 막기 위해 이번에는 건너뜁니다.
    if (allFetched) pruneMissingChannels(client);

    return results;
}

// 어느 서버에도 존재하지 않는 채널의 추적 정보/입장 기록을 제거합니다.
function pruneMissingChannels(client) {
    for (const channelId of tempChannels.allChannelIds()) {
        const exists = client.guilds.cache.some((guild) => guild.channels.cache.has(channelId));
        if (exists) continue;

        tempChannels.removeChannel(channelId);
        ownership.forgetChannel(channelId);
        console.log(`🧹 존재하지 않는 채널(${channelId})의 추적 정보를 정리했습니다.`);
    }
}

// 시작 직후 1회(결과는 시작 알림에 합쳐 보내므로 반환) + 5분마다 주기 점검 시작
function startSweeper(client) {
    const firstRun = sweepAll(client, { silent: true });
    setInterval(() => sweepAll(client), SWEEP_INTERVAL_MS).unref();
    return firstRun;
}

module.exports = { startSweeper, sweepAll, pruneMissingChannels };
