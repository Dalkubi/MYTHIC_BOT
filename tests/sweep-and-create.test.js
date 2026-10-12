const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const helpers = require('./helpers');

const { dataDir } = helpers.useTempDirs();
helpers.writeJson(`${dataDir}/settings.json`, {
    g1: { createChannelIds: ['TRIG'], channelLabels: { TRIG: '정규' }, createCategoryId: 'cat' },
});

const tempChannels = require('../src/utils/tempChannels');
const { sweepAll, pruneMissingChannels } = require('../src/utils/tempSweep');
const voiceStateUpdate = require('../src/events/voiceStateUpdate');
const opsLog = require('../src/utils/opsLog');

// 로그 전송은 하지 않도록 비워 둡니다. (init 하지 않으면 아무것도 보내지 않음)

function clientOf(...guilds) {
    return { guilds: { cache: new Collection(guilds.map((g) => [g.id, g])) } };
}

// ───────────────────────── 정리 작업(sweep) ─────────────────────────

test('정리: 추적 중인 빈 채널은 삭제하고, 사람이 있는 채널과 방금 만든 채널은 남긴다', async () => {
    const guild = helpers.makeGuild();
    const old = Date.now() - 10 * 60 * 1000;
    const empty = helpers.makeChannel(guild, { id: 'e1', name: '[ 1 ] 스쿼드 정규', createdTimestamp: old });
    const busy = helpers.makeChannel(guild, {
        id: 'b1', name: '[ 2 ] 스쿼드 정규', createdTimestamp: old, members: [helpers.member('5')],
    });
    const fresh = helpers.makeChannel(guild, { id: 'f1', name: '[ 3 ] 스쿼드 정규', createdTimestamp: Date.now() });
    for (const [c, n] of [[empty, 1], [busy, 2], [fresh, 3]]) tempChannels.track(c.id, { owner: '5', type: '정규', number: n });

    const results = await sweepAll(clientOf(guild), { silent: true });

    assert.equal(empty.deleted, true);
    assert.equal(busy.deleted, false);
    assert.equal(fresh.deleted, false, '유예 시간 안의 채널은 건드리지 않음');
    assert.equal(results.get('g1').deleted, 1);
    assert.equal(tempChannels.isTempChannel('e1'), false);
    assert.equal(tempChannels.isTempChannel('b1'), true);
});

test('정리: 추적 기록이 없어도 봇이 만든 임시 채널(패널 있음)은 복구/삭제하고, 일반 채널은 건드리지 않는다', async () => {
    const guild = helpers.makeGuild();
    const old = Date.now() - 10 * 60 * 1000;
    const panel = require('../src/utils/panel').buildPanel;

    const orphanEmpty = helpers.makeChannel(guild, { id: 'o1', name: '[ 1 ] 폭파전', createdTimestamp: old });
    await orphanEmpty.send(panel(orphanEmpty, '5', '폭파전', { fixed: true }));

    const orphanBusy = helpers.makeChannel(guild, {
        id: 'o2', name: '[ 2 ] 폭파전', createdTimestamp: old, members: [helpers.member('6')],
    });
    await orphanBusy.send(panel(orphanBusy, '6', '폭파전', { fixed: true }));

    // 이름만 비슷하지만 봇이 만들지 않은 방 (패널/권한 없음)
    const lookalike = helpers.makeChannel(guild, { id: 'o3', name: '[ 3 ] 폭파전', createdTimestamp: old });

    const results = await sweepAll(clientOf(guild), { silent: true });

    assert.equal(orphanEmpty.deleted, true);
    assert.equal(orphanBusy.deleted, false);
    assert.equal(tempChannels.isTempChannel('o2'), true, '사용 중인 채널은 추적 등록');
    assert.equal(tempChannels.getOwner('o2'), '6', '소유자는 패널에서 복구');
    assert.equal(lookalike.deleted, false);
    assert.equal(results.get('g1').recovered, 1);
});

test('정리: 방장이 없는 사용 중인 방은 승계하고 결과에 집계된다', async () => {
    const guild = helpers.makeGuild();
    const old = Date.now() - 10 * 60 * 1000;
    const room = helpers.makeChannel(guild, {
        id: 'r1', name: '[자유] 옛방장님의 채널', createdTimestamp: old, members: [helpers.member('22')],
    });
    tempChannels.track(room.id, { owner: '21', type: '자유' });

    const results = await sweepAll(clientOf(guild), { silent: true });

    assert.equal(tempChannels.getOwner('r1'), '22');
    assert.equal(results.get('g1').transferred, 1);
});

test('추적 목록 정리: 어느 서버에도 없는 채널만 지운다', () => {
    const guild = helpers.makeGuild();
    helpers.makeChannel(guild, { id: 'keep1', name: '[ 1 ] 전면전' });
    tempChannels.track('keep1', { owner: '1', type: '전면전', number: 1 });
    tempChannels.track('gone1', { owner: '1', type: '전면전', number: 2 });

    pruneMissingChannels(clientOf(guild));

    assert.equal(tempChannels.isTempChannel('keep1'), true);
    assert.equal(tempChannels.isTempChannel('gone1'), false);
});

test('추적 목록 정리: 한 서버라도 채널 목록을 못 가져오면 오삭제 방지를 위해 건너뛴다', async () => {
    const good = helpers.makeGuild('gA');
    const bad = helpers.makeGuild('gB');
    bad.channels.fetch = async () => { throw new Error('Missing Access'); };
    tempChannels.track('other-server-room', { owner: '1', type: '정규', number: 1 });

    const originalError = console.error;
    console.error = () => {};
    try {
        await sweepAll(clientOf(good, bad), { silent: true });
    } finally {
        console.error = originalError;
    }

    assert.equal(tempChannels.isTempChannel('other-server-room'), true);
    tempChannels.removeChannel('other-server-room');
});

// ───────────────────────── 방 생성(voiceStateUpdate) ─────────────────────────

// 트리거 채널에 입장하는 voiceState 를 흉내 냅니다.
function joinTrigger(guild, user, { moveFails = false } = {}) {
    const trigger = guild.channels.cache.get('TRIG');
    const member = {
        ...user,
        voice: {
            moved: null,
            setChannel: async (channel) => {
                if (moveFails) throw new Error('Target user is not connected to voice.');
                member.voice.moved = channel;
                channel.members.set(user.id, member);
            },
        },
    };
    return {
        member,
        oldState: { channelId: null, id: user.id, guild },
        newState: { channelId: 'TRIG', id: user.id, guild, member, channel: trigger },
    };
}

function guildWithTrigger() {
    const guild = helpers.makeGuild();
    helpers.makeChannel(guild, { id: 'TRIG', name: '정규 채널 생성하기', parentId: 'cat' });
    return guild;
}

test('생성: 정규 트리거에 입장하면 번호가 매겨진 고정형 방이 만들어지고 이동·패널 전송까지 된다', async () => {
    const guild = guildWithTrigger();
    const { member, oldState, newState } = joinTrigger(guild, helpers.member('101', { name: '용표' }));

    await voiceStateUpdate.execute(oldState, newState);

    assert.equal(guild.created.length, 1);
    const room = guild.created[0];
    assert.equal(room.name, '[ 1 ] 스쿼드 정규');
    assert.equal(room.userLimit, 3);
    assert.equal(member.voice.moved, room);
    assert.equal(tempChannels.getOwner(room.id), '101');
    assert.equal(room.sent.length, 1, '패널 1회 전송');
    assert.equal(room.permissionOverwrites.cache.size, 0, '방장에게 개별 권한을 주지 않는다');
});

test('생성: 같은 사람이 연달아 입장해도 5초 안에는 새 방을 만들지 않는다 (도배 방지)', async () => {
    const guild = guildWithTrigger();
    const user = helpers.member('102');

    await voiceStateUpdate.execute(...Object.values(pick(joinTrigger(guild, user))));
    await voiceStateUpdate.execute(...Object.values(pick(joinTrigger(guild, user))));

    assert.equal(guild.created.length, 1);
});

function pick({ oldState, newState }) {
    return { oldState, newState };
}

test('생성: 생성자가 이동하지 못하면(이미 접속 종료) 만든 빈 방을 바로 지우고 추적도 지운다', async () => {
    const guild = guildWithTrigger();
    const { oldState, newState } = joinTrigger(guild, helpers.member('103'), { moveFails: true });
    const originalError = console.error;
    console.error = () => {};

    try {
        await voiceStateUpdate.execute(oldState, newState);
    } finally {
        console.error = originalError;
    }

    assert.equal(guild.created.length, 1);
    assert.equal(guild.created[0].deleted, true);
    assert.equal(tempChannels.isTempChannel(guild.created[0].id), false);
    assert.equal(guild.created[0].sent.length, 0, '패널도 보내지 않는다');
});

test('생성: 카테고리가 가득 차면(50개) 만들지 않고 운영 로그에 알린다', async () => {
    const guild = guildWithTrigger();
    for (let i = 0; i < 49; i += 1) helpers.makeChannel(guild, { id: `fill${i}`, name: `채널${i}`, parentId: 'cat' });
    // 트리거(1) + 49 = 50개

    const logged = [];
    const originalOps = opsLog.error;
    opsLog.error = async (title, err, options) => { logged.push({ title, code: err.code, key: options.key }); };

    try {
        const { oldState, newState } = joinTrigger(guild, helpers.member('104'));
        await voiceStateUpdate.execute(oldState, newState);
    } finally {
        opsLog.error = originalOps;
    }

    assert.equal(guild.created.length, 0);
    assert.deepEqual(logged, [{ title: '통화방 생성 불가', code: 30013, key: 'category-full' }]);
});

test('생성: 동시에 여러 명이 입장해도 번호가 겹치지 않는다', async () => {
    const guild = guildWithTrigger();
    const users = ['111', '112', '113'].map((id) => helpers.member(id));
    const joins = users.map((user) => joinTrigger(guild, user));

    await Promise.all(joins.map(({ oldState, newState }) => voiceStateUpdate.execute(oldState, newState)));

    const names = guild.created.map((c) => c.name).sort();
    assert.deepEqual(names, ['[ 1 ] 스쿼드 정규', '[ 2 ] 스쿼드 정규', '[ 3 ] 스쿼드 정규']);
});

// ───────────────────────── 퇴장 처리 ─────────────────────────

function leaveEvent(guild, channel, user) {
    return {
        oldState: { channelId: channel.id, id: user.id, guild, channel },
        newState: { channelId: null, id: user.id, guild, channel: null },
    };
}

test('퇴장: 마지막 사람이 나가면 방과 추적 정보가 삭제된다', async () => {
    const guild = guildWithTrigger();
    const room = helpers.makeChannel(guild, { id: 'x1', name: '[ 1 ] 스쿼드 기밀' }); // 이미 비어 있음(방금 나감)
    tempChannels.track(room.id, { owner: '201', type: '기밀', number: 1 });

    const { oldState, newState } = leaveEvent(guild, room, helpers.member('201'));
    await voiceStateUpdate.execute(oldState, newState);

    assert.equal(room.deleted, true);
    assert.equal(tempChannels.isTempChannel('x1'), false);
});

test('퇴장: 방장이 나가면 남은 사람 중 가장 오래된 사람이 즉시 방장이 되고 안내 메시지는 없다', async () => {
    const guild = guildWithTrigger();
    const stay = helpers.member('302');
    const room = helpers.makeChannel(guild, { id: 'x2', name: '[자유] 방장님의 채널', members: [stay] });
    await room.send(require('../src/utils/panel').buildPanel(room, '301', '자유', { fixed: false }));
    tempChannels.track(room.id, { owner: '301', type: '자유' });
    const sentBefore = room.sent.length;

    const { oldState, newState } = leaveEvent(guild, room, helpers.member('301'));
    await voiceStateUpdate.execute(oldState, newState);

    assert.equal(room.deleted, false);
    assert.equal(tempChannels.getOwner('x2'), '302');
    assert.equal(room.sent.length, sentBefore);
    assert.match(helpers.panelText(room.panelMessages[0]), /owner:302/);
});

test('퇴장: 방장이 아닌 사람이 나가도 방장은 그대로다', async () => {
    const guild = guildWithTrigger();
    const owner = helpers.member('401');
    const room = helpers.makeChannel(guild, { id: 'x3', name: '[자유] 사백일님의 채널', members: [owner] });
    tempChannels.track(room.id, { owner: '401', type: '자유' });

    const { oldState, newState } = leaveEvent(guild, room, helpers.member('402'));
    await voiceStateUpdate.execute(oldState, newState);

    assert.equal(tempChannels.getOwner('x3'), '401');
});
