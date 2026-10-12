const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const helpers = require('./helpers');

helpers.useTempDirs();

const { __test } = require('../src/events/interactionCreate');

const { Connect, ViewChannel } = PermissionFlagsBits;

function setup(members, overwrites = []) {
    const guild = helpers.makeGuild();
    const channel = helpers.makeChannel(guild, { id: 'L1', members, overwrites });
    const replies = [];
    const interaction = {
        guild,
        reply: async (payload) => { replies.push(payload); },
    };
    return { guild, channel, interaction, replies };
}

test('잠금: 현재 방에 있는 사람(봇 제외)에게 입장 허용을 주고 @everyone 입장을 막는다', async () => {
    const a = helpers.member('1');
    const b = helpers.member('2');
    const bot = helpers.member('9', { bot: true });
    const { channel, interaction, replies } = setup([a, b, bot]);

    await __test.applyChannelLock(interaction, channel, 'lock');

    const cache = channel.permissionOverwrites.cache;
    assert.equal(cache.get('1').allow.has(Connect), true);
    assert.equal(cache.get('2').allow.has(Connect), true);
    assert.equal(cache.has('9'), false, '봇에게는 주지 않는다');
    assert.equal(cache.get('everyone').deny.has(Connect), true);
    assert.equal(replies.length, 1);
});

test('잠금: 이미 차단된 사람이나 이미 허용된 사람의 권한은 바꾸지 않는다', async () => {
    const blocked = helpers.member('1');
    const allowed = helpers.member('2');
    const { channel, interaction } = setup(
        [blocked, allowed],
        [
            { id: '1', allow: 0n, deny: Connect },
            { id: '2', allow: Connect | ViewChannel, deny: 0n },
        ]
    );

    await __test.applyChannelLock(interaction, channel, 'lock');

    const cache = channel.permissionOverwrites.cache;
    assert.equal(cache.get('1').deny.has(Connect), true, '차단 유지');
    assert.equal(cache.get('1').allow.has(Connect), false);
    assert.equal(cache.get('2').allow.bitfield, Connect | ViewChannel, '다른 허용 권한까지 그대로');
});

test('잠금 해제: 잠금 때 자동으로 준 허용만 걷어내고, 방장이 직접 준 허용/차단은 유지한다', async () => {
    const a = helpers.member('1');
    const { channel, interaction } = setup(
        [a],
        [
            { id: '3', allow: Connect | ViewChannel, deny: 0n }, // 방장이 직접 준 허용 (다른 권한 포함)
            { id: '4', allow: 0n, deny: Connect }, // 차단
        ]
    );

    await __test.applyChannelLock(interaction, channel, 'lock'); // 1번 자동 허용 생성
    assert.equal(channel.permissionOverwrites.cache.has('1'), true);

    await __test.applyChannelLock(interaction, channel, 'unlock');

    const cache = channel.permissionOverwrites.cache;
    assert.equal(cache.has('1'), false, '자동 허용은 제거');
    assert.equal(cache.get('3').allow.has(Connect), true, '직접 준 허용은 유지');
    assert.equal(cache.get('4').deny.has(Connect), true, '차단은 유지');
    assert.equal(cache.get('everyone')?.deny.has(Connect) ?? false, false, '@everyone 차단 해제');
});
