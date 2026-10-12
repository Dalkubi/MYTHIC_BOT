const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const helpers = require('./helpers');

const { configDir } = helpers.useTempDirs();
const shippedPath = path.join(__dirname, '..', 'config', 'messages.json');

test('배포되는 config/messages.json 은 코드의 기본 문구와 항상 같다', () => {
    const { DEFAULTS } = require('../src/utils/messages');
    assert.deepEqual(JSON.parse(fs.readFileSync(shippedPath, 'utf-8')), DEFAULTS);
});

test('자리표시자가 값으로 바뀌고 서버 이름은 자동으로 들어간다', () => {
    const { t } = require('../src/utils/messages');
    assert.equal(t('welcome.title'), '👋 WELCOME TO MYTHIC');
    assert.equal(t('welcome.footer', { count: 42 }), '현재 42명');
    assert.equal(t('panel.ownerLine', { owner: '123' }), '• 소유주 : <@123>');
    assert.equal(t('interaction.renameDone', { name: '즐겜방' }), '✅ 채널 이름을 "즐겜방"(으)로 변경했습니다.');
});

test('여러 줄 문구는 줄바꿈으로 이어지고, 값이 없는 자리표시자는 그대로 남는다', () => {
    const { t } = require('../src/utils/messages');
    const text = t('goodbye.description', { mention: '<@1>', tag: 'tester' });
    assert.ok(text.includes('<@1> 님이 MYTHIC을 떠났습니다.'));
    assert.equal(text.split('\n').length, 5);
    assert.equal(t('welcome.footer'), '현재 {count}명');
});

test('모르는 키는 키 이름을 그대로 돌려준다 (봇이 멈추지 않음)', () => {
    const { t } = require('../src/utils/messages');
    assert.equal(t('없는.키'), '없는.키');
});

test('messages.json 에서 일부만 바꾸면 나머지는 기본 문구를 쓴다', () => {
    fs.writeFileSync(
        path.join(configDir, 'messages.json'),
        JSON.stringify({ server: { name: '플로라' }, welcome: { footer: '멤버 {count}명' } }),
        'utf-8'
    );
    const { loadMessages } = require('../src/utils/messages');
    const loaded = loadMessages();

    assert.equal(loaded.server.name, '플로라');
    assert.equal(loaded.welcome.footer, '멤버 {count}명');
    assert.equal(loaded.welcome.title, '👋 WELCOME TO {server}'); // 안 바꾼 항목은 기본값
});

test('형식이 잘못된 항목이나 깨진 JSON 은 기본 문구로 대체한다', () => {
    const { loadMessages, DEFAULTS } = require('../src/utils/messages');

    fs.writeFileSync(
        path.join(configDir, 'messages.json'),
        JSON.stringify({ welcome: { title: 123, description: '배열이어야 함' } }),
        'utf-8'
    );
    const partial = loadMessages();
    assert.equal(partial.welcome.title, DEFAULTS.welcome.title);
    assert.deepEqual(partial.welcome.description, DEFAULTS.welcome.description);

    fs.writeFileSync(path.join(configDir, 'messages.json'), '{ 깨진 json', 'utf-8');
    assert.deepEqual(loadMessages(), DEFAULTS);
});
