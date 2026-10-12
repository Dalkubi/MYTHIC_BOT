const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('./helpers');

helpers.useTempDirs();

const tempChannels = require('../src/utils/tempChannels');
const ownership = require('../src/utils/ownership');

// 방장 승계 테스트에서 쓰는 방을 만들고 추적 등록까지 합니다.
function setupRoom({ owner, members, type = '자유', name = '[자유] 방장님의 채널' }) {
    const guild = helpers.makeGuild();
    const channel = helpers.makeChannel(guild, { id: '5555', name, members });
    tempChannels.track(channel.id, { owner, type });
    return { guild, channel };
}

test('방장 승계: 방에 가장 오래 있던 사람이 선택되고 봇/나간 방장은 제외된다', () => {
    const a = helpers.member('1');
    const b = helpers.member('2');
    const c = helpers.member('3');
    const bot = helpers.member('9', { bot: true });
    const { channel } = setupRoom({ owner: '1', members: [b, c, bot] });

    // 입장 시각: c 가 b 보다 먼저
    const realNow = Date.now;
    let now = 1000;
    Date.now = () => now;
    ownership.recordJoin(channel.id, c.id);
    now = 2000;
    ownership.recordJoin(channel.id, b.id);
    Date.now = realNow;

    assert.equal(ownership.pickSuccessor(channel, a.id).id, '3');
    assert.equal(ownership.pickSuccessor(channel, '3').id, '2');
    ownership.forgetChannel(channel.id);
});

test('방장 승계: 후보가 없거나 봇만 남으면 null', () => {
    const { channel } = setupRoom({ owner: '1', members: [helpers.member('9', { bot: true })] });
    assert.equal(ownership.pickSuccessor(channel, '1'), null);
});

test('방장 승계: 입장 기록이 없는 사람은 기록이 있는 사람보다 먼저(오래된 것)로 취급한다', () => {
    const known = helpers.member('2');
    const unknown = helpers.member('3');
    const { channel } = setupRoom({ owner: '1', members: [known, unknown] });
    ownership.recordJoin(channel.id, known.id);

    for (let i = 0; i < 20; i += 1) {
        assert.equal(ownership.pickSuccessor(channel, '1').id, '3');
    }
    ownership.forgetChannel(channel.id);
});

test('승계 시 추적 소유자와 패널만 바뀌고, 권한 변경이나 안내 메시지는 없다', async () => {
    const newOwner = helpers.member('2', { name: '새방장' });
    const { guild, channel } = setupRoom({ owner: '1', members: [newOwner] });

    // 기존 패널(옛 방장 1번)을 방 채팅에 올려 둡니다.
    const message = await channel.send(
        require('../src/utils/panel').buildPanel(channel, '1', '자유', { fixed: false })
    );
    const sentBefore = channel.sent.length;
    const overwritesBefore = channel.permissionOverwrites.cache.size;

    assert.equal(await ownership.transferOwnership(channel, newOwner), true);

    assert.equal(tempChannels.getOwner(channel.id), '2');
    assert.equal(channel.sent.length, sentBefore, '새 메시지(방장이 바뀌었습니다 등)를 보내지 않는다');
    assert.equal(channel.permissionOverwrites.cache.size, overwritesBefore, '채널 권한은 건드리지 않는다');
    assert.equal(message.edits.length, 1, '패널은 한 번 수정된다');

    const text = helpers.panelText(message);
    assert.match(text, /<@2>/, '소유주 표시가 새 방장');
    assert.match(text, /owner:2/, '숨겨진 owner 값도 새 방장');
    assert.doesNotMatch(text, /owner:1/);
    assert.match(text, new RegExp(`source:${channel.id}`));
    void guild;
});

test('방장이 방에 없으면 점검에서 승계하고, 방장이 있으면 그대로 둔다', async () => {
    const stay = helpers.member('2');
    const { channel } = setupRoom({ owner: '1', members: [stay] });
    assert.equal(await ownership.ensureOwnerPresent(channel), true);
    assert.equal(tempChannels.getOwner(channel.id), '2');

    assert.equal(await ownership.ensureOwnerPresent(channel), false, '이미 방에 있는 방장은 유지');
});

test('재시작으로 소유자를 모르는 방은 패널에서 소유자를 읽어 복구한다', async () => {
    const owner = helpers.member('7');
    const other = helpers.member('8');
    const guild = helpers.makeGuild();
    const channel = helpers.makeChannel(guild, { id: '6666', name: '[자유] 칠번님의 채널', members: [owner, other] });
    await channel.send(require('../src/utils/panel').buildPanel(channel, '7', '자유', { fixed: false }));
    tempChannels.track(channel.id, { owner: null, type: null });

    assert.equal(await ownership.ensureOwnerPresent(channel), false, '방장(7번)이 방에 있으므로 승계 없음');
    assert.equal(tempChannels.getOwner(channel.id), '7', '패널에서 읽은 소유자로 복구');
});

test('사람이 없는 방은 승계하지 않는다', async () => {
    const { channel } = setupRoom({ owner: '1', members: [helpers.member('9', { bot: true })] });
    assert.equal(await ownership.ensureOwnerPresent(channel), false);
});

test('refreshPanel: 이름/인원 제한이 바뀌면 패널 내용이 새 값으로 다시 그려지고, 패널이 없으면 새로 보낸다', async () => {
    const guild = helpers.makeGuild();
    const channel = helpers.makeChannel(guild, { id: '7777', name: '[자유] 용표님의 채널', members: [helpers.member('1')] });
    tempChannels.track(channel.id, { owner: '1', type: '자유' });

    assert.equal(await ownership.refreshPanel(channel), true);
    assert.equal(channel.sent.length, 1, '패널이 없으면 새로 보낸다');

    await channel.setName('[자유] 새 이름');
    await channel.setUserLimit(4);
    assert.equal(await ownership.refreshPanel(channel), true);

    assert.equal(channel.sent.length, 1, '있으면 수정만 한다');
    assert.equal(channel.panelMessages[0].edits.length, 1);
});

test('refreshPanel: 소유자를 알 수 없으면 아무것도 하지 않는다', async () => {
    const guild = helpers.makeGuild();
    const channel = helpers.makeChannel(guild, { id: '8888' });
    assert.equal(await ownership.refreshPanel(channel), false);
    assert.equal(channel.sent.length, 0);
});
