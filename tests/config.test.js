const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const helpers = require('./helpers');

const { dataDir, configDir } = helpers.useTempDirs();
const settingsPath = path.join(dataDir, 'settings.json');

const { getGuildSettings, updateGuildSettings } = require('../src/config');
const { syncStaticConfig } = require('../src/utils/configSync');

test('설정을 저장하면 읽을 수 있고, 저장할 때마다 직전 정상본(.bak)이 남는다', () => {
    updateGuildSettings('g1', { opsLogChannelId: 'OPS1' });
    updateGuildSettings('g1', { introChannelId: 'INTRO1' });

    assert.deepEqual(getGuildSettings('g1'), { opsLogChannelId: 'OPS1', introChannelId: 'INTRO1' });
    assert.deepEqual(helpers.readJson(`${settingsPath}.bak`).g1, { opsLogChannelId: 'OPS1' });
    assert.equal(fs.existsSync(`${settingsPath}.tmp`), false, '임시 파일이 남지 않는다');
});

test('설정 파일이 손상되면 손상본을 보관하고 백업에서 복구한다 (빈 설정으로 덮어쓰지 않음)', () => {
    fs.writeFileSync(settingsPath, '{"g1": {"opsLogChannelId": "OPS1", ', 'utf-8'); // 저장 도중 끊긴 파일

    const restored = getGuildSettings('g1');
    assert.equal(restored.opsLogChannelId, 'OPS1', '직전 정상본으로 복구');
    assert.ok(fs.readdirSync(dataDir).some((name) => name.startsWith('settings.corrupt-')), '손상된 파일은 따로 보관');
    assert.doesNotThrow(() => helpers.readJson(settingsPath), '복구 후 settings.json 은 정상');
});

test('백업도 없이 손상되면 빈 설정으로 시작하되 손상 파일은 보관한다', () => {
    fs.rmSync(`${settingsPath}.bak`, { force: true });
    for (const name of fs.readdirSync(dataDir)) {
        if (name.startsWith('settings.corrupt-')) fs.rmSync(path.join(dataDir, name));
    }
    fs.writeFileSync(settingsPath, 'not json at all', 'utf-8');

    assert.deepEqual(getGuildSettings('g1'), {});
    const kept = fs.readdirSync(dataDir).filter((name) => name.startsWith('settings.corrupt-'));
    assert.equal(kept.length, 1);
    assert.equal(fs.readFileSync(path.join(dataDir, kept[0]), 'utf-8'), 'not json at all');
});

test('channels.json 은 초기값으로만 쓰이고, 이미 저장된 값은 덮어쓰지 않는다', () => {
    helpers.writeJson(settingsPath, {
        g2: {
            createChannelIds: ['T1', 'T2', 'NEW1'], // 명령어로 NEW1 추가
            channelLabels: { NEW1: '극비' },
            introChannelId: 'CMD_INTRO', // 명령어로 변경
            opsLogChannelId: 'CMD_OPS',
        },
    });
    helpers.writeJson(path.join(configDir, 'channels.json'), {
        g2: {
            createChannelIds: ['T1', 'T2'],
            channelLabels: { T1: '정규', NEW1: '폭파전' },
            introChannelId: 'FILE_INTRO',
            opsLogChannelId: 'FILE_OPS',
            leaveLogChannelId: 'FILE_LEAVE', // 저장된 값이 없으므로 초기값으로 채워짐
        },
    });

    for (let i = 0; i < 3; i += 1) syncStaticConfig(); // 재시작을 여러 번 반복해도 동일

    const s = getGuildSettings('g2');
    assert.deepEqual(s.createChannelIds, ['T1', 'T2', 'NEW1'], '명령어로 추가한 트리거 유지');
    assert.equal(s.channelLabels.NEW1, '극비', '저장된 유형이 파일보다 우선');
    assert.equal(s.channelLabels.T1, '정규', '저장돼 있지 않던 유형은 파일 값으로 채움');
    assert.equal(s.introChannelId, 'CMD_INTRO');
    assert.equal(s.opsLogChannelId, 'CMD_OPS');
    assert.equal(s.leaveLogChannelId, 'FILE_LEAVE');
});

test('저장소가 비어 있는 첫 설치에서는 channels.json 값이 기본값으로 들어간다', () => {
    helpers.writeJson(settingsPath, {});
    helpers.writeJson(path.join(configDir, 'channels.json'), {
        g3: { createChannelIds: ['T1'], introChannelId: 'I1', createCategoryId: '' },
    });

    syncStaticConfig();

    const s = getGuildSettings('g3');
    assert.deepEqual(s.createChannelIds, ['T1']);
    assert.equal(s.introChannelId, 'I1');
    assert.equal('createCategoryId' in s, false, '빈 값은 채우지 않는다');
});

test('명령어로 트리거를 모두 제거해 빈 목록이 저장돼도 파일이 되살리지 않는다', () => {
    helpers.writeJson(settingsPath, { g4: { createChannelIds: [] } });
    helpers.writeJson(path.join(configDir, 'channels.json'), { g4: { createChannelIds: ['T1', 'T2'] } });

    syncStaticConfig();

    assert.deepEqual(getGuildSettings('g4').createChannelIds, []);
});
