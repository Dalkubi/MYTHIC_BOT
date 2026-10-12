const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('./helpers');

const { dataDir } = helpers.useTempDirs();
helpers.writeJson(`${dataDir}/settings.json`, {
    g1: {
        createChannelIds: ['T1', 'T2', 'T3', 'T4'],
        channelLabels: { T4: '폭파전' },
    },
});

const types = require('../src/utils/channelTypes');
const tempChannels = require('../src/utils/tempChannels');
const { sortTempChannels } = require('../src/utils/channelSort');

test('고정형 방 이름은 "[ 번호 ] 표시이름" 형식이고 인원수는 이름에 넣지 않는다', () => {
    assert.equal(types.buildChannelName('정규', 1), '[ 1 ] 스쿼드 정규');
    assert.equal(types.buildChannelName('기밀', 2), '[ 2 ] 스쿼드 기밀');
    assert.equal(types.buildChannelName('극비', 3), '[ 3 ] 스쿼드 극비');
    assert.equal(types.buildChannelName('전면전', 1), '[ 1 ] 전면전');
    assert.equal(types.buildChannelName('폭파전', 1), '[ 1 ] 폭파전');
});

test('자유형 방 이름은 기존 정책 그대로 "[자유] ○○님의 채널"', () => {
    assert.equal(types.buildChannelName('자유', null, '용표'), '[자유] 용표님의 채널');
});

test('이름에서 유형과 번호를 읽고, 예전 "( 인원수 N인 )" 이름도 인식한다', () => {
    assert.deepEqual(types.parseFixedName('[ 3 ] 스쿼드 극비'), { type: '극비', number: 3 });
    assert.deepEqual(types.parseFixedName('[ 1 ] 스쿼드 정규 ( 인원수 3인 )'), { type: '정규', number: 1 });
    assert.equal(types.parseFixedName('[자유] 용표님의 채널'), null);
});

test('인원수와 고정 여부 설정', () => {
    assert.equal(types.getTypeConfig('정규').limit, 3);
    assert.equal(types.getTypeConfig('전면전').limit, 4);
    assert.equal(types.getTypeConfig('폭파전').limit, 5);
    assert.equal(types.isFixedType('극비'), true);
    assert.equal(types.isFixedType('자유'), false);
});

test('고정형 방 이름처럼 보이는 이름을 느슨하게 걸러낸다', () => {
    for (const name of ['[1] 스쿼드 정규', '[ 2 ] 폭파전', '  [10]아무거나', '[ 1 ]']) {
        assert.equal(types.looksLikeFixedName(name), true, name);
    }
    for (const name of ['[자유] 용표님의 채널', '즐겜방', '1번 방', '[팀] 모여라']) {
        assert.equal(types.looksLikeFixedName(name), false, name);
    }
});

test('번호는 같은 카테고리·같은 유형에서 비어 있는 가장 작은 번호를 쓴다', () => {
    const guild = helpers.makeGuild();
    helpers.makeChannel(guild, { id: 'a', name: types.buildChannelName('정규', 1), parentId: 'cat' });
    helpers.makeChannel(guild, { id: 'b', name: types.buildChannelName('정규', 3), parentId: 'cat' });

    assert.equal(types.nextNumber(guild, 'cat', '정규'), 2);
    assert.equal(types.nextNumber(guild, 'cat', '폭파전'), 1); // 유형별로 따로 계산
    assert.equal(types.nextNumber(guild, 'other', '정규'), 1); // 카테고리별로 따로 계산
});

test('트리거 채널의 유형: 직접 지정 > 등록 순서 기본값 > 채널 이름', () => {
    const guild = helpers.makeGuild();
    const trigger = (id, name) => helpers.makeChannel(guild, { id, name });

    assert.equal(types.resolveChannelLabel('g1', trigger('T1', '아무 이름')), '정규'); // 1번째
    assert.equal(types.resolveChannelLabel('g1', trigger('T2', '아무 이름')), '기밀'); // 2번째
    assert.equal(types.resolveChannelLabel('g1', trigger('T3', '아무 이름')), '전면전'); // 3번째
    assert.equal(types.resolveChannelLabel('g1', trigger('T4', '아무 이름')), '폭파전'); // 직접 지정
});

test('카테고리 안 임시 채널은 유형 순서 → 번호 순으로 정렬되고, 트리거/다른 카테고리는 그대로다', async () => {
    const guild = helpers.makeGuild();
    const add = (id, name, position, parent = 'cat') =>
        helpers.makeChannel(guild, { id, name, rawPosition: position, parentId: parent, createdTimestamp: position });

    const trigger = add('trig', '정규 채널 생성하기', 0);
    const free = add('free', '[자유] 용표님의 채널', 1);
    const bomb = add('bomb', types.buildChannelName('폭파전', 1), 2);
    const full = add('full', types.buildChannelName('전면전', 1), 3);
    const secret = add('secret', types.buildChannelName('극비', 2), 4);
    const reg2 = add('reg2', types.buildChannelName('정규', 2), 5);
    const reg1 = add('reg1', types.buildChannelName('정규', 1), 6);
    const conf = add('conf', types.buildChannelName('기밀', 1), 7);
    const otherCategory = add('other', types.buildChannelName('정규', 1), 8, 'cat2');

    tempChannels.track('free', { owner: 'u', type: '자유' });
    for (const [channel, type, number] of [
        [bomb, '폭파전', 1], [full, '전면전', 1], [secret, '극비', 2],
        [reg2, '정규', 2], [reg1, '정규', 1], [conf, '기밀', 1], [otherCategory, '정규', 1],
    ]) {
        tempChannels.track(channel.id, { owner: 'u', type, number });
    }

    assert.equal(await sortTempChannels(guild, 'cat'), true);

    const order = [...guild.channels.cache.values()]
        .filter((c) => c.parentId === 'cat' && c.id !== 'trig')
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map((c) => c.name);

    assert.deepEqual(order, [
        '[ 1 ] 스쿼드 정규',
        '[ 2 ] 스쿼드 정규',
        '[ 1 ] 스쿼드 기밀',
        '[ 2 ] 스쿼드 극비',
        '[ 1 ] 전면전',
        '[ 1 ] 폭파전',
        '[자유] 용표님의 채널',
    ]);
    assert.equal(trigger.rawPosition, 0, '트리거 채널 위치는 유지');
    assert.equal(otherCategory.rawPosition, 8, '다른 카테고리는 영향 없음');
    assert.equal(await sortTempChannels(guild, 'cat'), false, '이미 정렬돼 있으면 API 호출 없음');
});
