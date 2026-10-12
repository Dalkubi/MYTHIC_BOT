const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const helpers = require('./helpers');

const { dataDir } = helpers.useTempDirs();
helpers.writeJson(`${dataDir}/settings.json`, { g1: { opsLogChannelId: 'OPS' }, g2: {} });

const opsLog = require('../src/utils/opsLog');

// 보낸 임베드를 모으는 가짜 클라이언트
function makeClient({ failSend = false } = {}) {
    const sent = [];
    const channel = {
        isTextBased: () => true,
        send: async (payload) => {
            if (failSend) throw new Error('Missing Permissions');
            sent.push(payload.embeds[0].toJSON());
        },
    };
    const client = {
        channels: { cache: new Collection([['OPS', channel]]), fetch: async () => null },
        guilds: { cache: new Collection([['g1', { id: 'g1' }], ['g2', { id: 'g2' }]]) },
    };
    return { client, sent };
}

test('에러는 로그 채널로 전송되고, 같은 에러는 10분 안에 한 번만 보낸다', async () => {
    const { client, sent } = makeClient();
    opsLog.init(client);

    const err = Object.assign(new Error('boom'), { code: 50013 });
    await opsLog.error('테스트 오류', err, { guildId: 'g1', key: 'dup-test' });
    await opsLog.error('테스트 오류', err, { guildId: 'g1', key: 'dup-test' });
    await opsLog.error('테스트 오류', err, { guildId: 'g1', key: 'dup-test' });

    assert.equal(sent.length, 1);
    assert.match(sent[0].title, /테스트 오류/);
    assert.ok(sent[0].fields.some((f) => f.name === '확인할 것' && f.value.includes('권한')), '코드별 안내문');
});

test('로그 채널이 지정되지 않은 서버에는 보내지 않는다', async () => {
    const { client, sent } = makeClient();
    opsLog.init(client);

    await opsLog.error('다른 서버 오류', new Error('x'), { guildId: 'g2', key: 'no-channel' });
    assert.equal(sent.length, 0);
});

test('봇 토큰처럼 생긴 문자열은 로그에 노출되지 않는다', async () => {
    const { client, sent } = makeClient();
    opsLog.init(client);
    const fakeToken = `${'A'.repeat(24)}.${'b'.repeat(6)}.${'c'.repeat(30)}`;

    await opsLog.error('토큰 노출 테스트', new Error(`요청 실패 ${fakeToken}`), { guildId: 'g1', key: 'mask' });

    const json = JSON.stringify(sent[0]);
    assert.ok(!json.includes(fakeToken));
    assert.ok(json.includes('[TOKEN]'));
});

test('로그 전송이 실패해도 예외가 밖으로 나오지 않고 재귀 로그도 만들지 않는다', async () => {
    const { client } = makeClient({ failSend: true });
    opsLog.init(client);
    const originalError = console.error;
    const messages = [];
    console.error = (...args) => messages.push(args.join(' '));

    try {
        await assert.doesNotReject(opsLog.error('전송 실패 테스트', new Error('x'), { guildId: 'g1', key: 'fail-send' }));
    } finally {
        console.error = originalError;
    }
    assert.equal(messages.length, 1, '콘솔에만 한 번 기록');
});

test('시작 알림: 명령어 등록 결과와 정리 결과가 서버별로 들어간다', async () => {
    const { client, sent } = makeClient();
    opsLog.init(client);

    const stats = new Map([['g1', { deleted: 2, recovered: 0, transferred: 1, sorted: 0 }]]);
    await opsLog.startup(client, { ok: true, count: 3, scope: '길드 g1' }, stats);

    assert.equal(sent.length, 1, '로그 채널이 있는 g1 에만 전송');
    const fields = Object.fromEntries(sent[0].fields.map((f) => [f.name, f.value]));
    assert.match(fields['슬래시 명령어'], /3개 등록 완료/);
    assert.match(fields['시작 정리'], /빈 채널 삭제 2개/);
    assert.match(fields['시작 정리'], /방장 승계 1건/);
});

test('시작 알림: 명령어 등록에 실패하면 빨간색 실패 문구가 나온다', async () => {
    const { client, sent } = makeClient();
    opsLog.init(client);

    await opsLog.startup(client, { ok: false, error: 'Invalid Form Body' }, new Map());

    const fields = Object.fromEntries(sent[0].fields.map((f) => [f.name, f.value]));
    assert.match(fields['슬래시 명령어'], /등록 실패.*Invalid Form Body/);
    assert.equal(fields['시작 정리'], '정리할 항목이 없었습니다.');
    assert.equal(sent[0].color, 0xed4245);
});

test('정리 요약: 변화가 있을 때만 보낸다', async () => {
    const { client, sent } = makeClient();
    opsLog.init(client);

    await opsLog.sweepSummary('g1', opsLog.emptyStats());
    assert.equal(sent.length, 0);

    await opsLog.sweepSummary('g1', { deleted: 0, recovered: 0, transferred: 0, sorted: 2 });
    assert.equal(sent.length, 1);
    assert.match(sent[0].description, /정렬 보정 2회/);
});

test('종료 알림은 로그 채널이 있는 서버로 보내진다', async () => {
    const { client, sent } = makeClient();
    opsLog.init(client);

    await opsLog.shutdown('SIGTERM');

    assert.equal(sent.length, 1);
    assert.match(sent[0].title, /종료/);
    assert.match(sent[0].description, /SIGTERM/);
});
