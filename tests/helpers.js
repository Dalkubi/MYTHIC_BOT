// 테스트 공용 도구입니다. (이 파일 자체는 테스트가 아닙니다)
//
// 중요: 테스트가 실제 data/ 와 config/ 를 건드리지 않도록,
//       src 모듈을 불러오기 "전에" useTempDirs() 를 먼저 호출해야 합니다.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ChannelType, Collection, PermissionFlagsBits } = require('discord.js');

// 임시 data/config 폴더를 만들고 환경변수로 연결합니다.
function useTempDirs() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-test-'));
    const dataDir = path.join(root, 'data');
    const configDir = path.join(root, 'config');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });
    process.env.BOT_DATA_DIR = dataDir;
    process.env.BOT_CONFIG_DIR = configDir;
    return { root, dataDir, configDir };
}

function writeJson(file, data) {
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf-8');
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function member(id, { bot = false, name } = {}) {
    const displayName = name || `user${id}`;
    return { id: String(id), displayName, user: { id: String(id), bot, username: displayName } };
}

// 채널 개별 권한(permissionOverwrites)을 흉내 냅니다. true/false/null 의미는 디스코드와 같습니다.
function makeOverwrites(initial = []) {
    const cache = new Collection();

    const wrap = (id, type, allow, deny) => ({
        id,
        type,
        allow: { bitfield: allow, has: (flag) => (allow & flag) === flag },
        deny: { bitfield: deny, has: (flag) => (deny & flag) === flag },
    });

    const store = {
        cache,
        async edit(target, options) {
            const id = typeof target === 'string' ? target : target.id;
            const current = cache.get(id);
            let allow = current ? current.allow.bitfield : 0n;
            let deny = current ? current.deny.bitfield : 0n;

            for (const [name, value] of Object.entries(options)) {
                const flag = PermissionFlagsBits[name];
                allow &= ~flag;
                deny &= ~flag;
                if (value === true) allow |= flag;
                if (value === false) deny |= flag;
            }
            cache.set(id, wrap(id, current ? current.type : 1, allow, deny));
        },
        async delete(id) {
            if (!cache.delete(id)) throw new Error('Unknown Overwrite');
        },
    };

    for (const item of initial) cache.set(item.id, wrap(item.id, item.type ?? 1, item.allow ?? 0n, item.deny ?? 0n));
    return store;
}

// 서버(길드)를 흉내 냅니다. channels.create 는 만든 채널을 캐시에 넣고 돌려줍니다.
function makeGuild(id = 'g1') {
    const channelCache = new Collection();
    let nextId = 1000;

    const guild = {
        id,
        memberCount: 10,
        roles: { everyone: { id: 'everyone' } },
        members: { cache: new Collection() },
        channels: {
            cache: channelCache,
            fetch: async () => channelCache,
            setPositions: async (changes) => {
                for (const { channel, position } of changes) channelCache.get(channel.id).rawPosition = position;
            },
            create: async (options) => {
                const channel = makeChannel(guild, {
                    id: String(nextId++),
                    name: options.name,
                    parentId: options.parent || null,
                    userLimit: options.userLimit ?? 0,
                    rawPosition: channelCache.size + 100,
                    createdTimestamp: Date.now(),
                });
                guild.created.push(channel);
                return channel;
            },
        },
        created: [],
    };
    return guild;
}

// 음성채널을 흉내 냅니다. 패널(봇이 보낸 메시지) 조회/수정/전송과 삭제 기록을 지원합니다.
function makeChannel(guild, options = {}) {
    const messages = [];
    const channel = {
        id: options.id || String(Math.floor(Math.random() * 1e9)),
        name: options.name || 'channel',
        type: options.type ?? ChannelType.GuildVoice,
        parentId: options.parentId ?? null,
        rawPosition: options.rawPosition ?? 0,
        createdTimestamp: options.createdTimestamp ?? 0,
        userLimit: options.userLimit ?? 0,
        guild,
        client: { user: { id: 'BOT' } },
        members: new Collection((options.members || []).map((m) => [m.id, m])),
        permissionOverwrites: makeOverwrites(options.overwrites || []),
        deleted: false,
        sent: [],
        messages: {
            fetch: async () => ({ find: (fn) => messages.find(fn) }),
        },
        async send(payload) {
            const message = fakeBotMessage(channel, payload);
            messages.push(message);
            channel.sent.push(payload);
            return message;
        },
        async delete() {
            channel.deleted = true;
            guild.channels.cache.delete(channel.id);
        },
        async setName(name) {
            channel.name = name;
            return channel;
        },
        async setUserLimit(limit) {
            channel.userLimit = limit;
            return channel;
        },
        panelMessages: messages,
    };
    guild.channels.cache.set(channel.id, channel);
    return channel;
}

// 봇이 보낸 패널 메시지를 흉내 냅니다. components 는 실제 패널 JSON 에서 만들어집니다.
function fakeBotMessage(channel, payload) {
    const message = {
        author: { id: 'BOT' },
        components: payload.components,
        edits: [],
        async edit(next) {
            message.components = next.components;
            message.edits.push(next);
        },
    };
    return message;
}

// 패널 안의 모든 텍스트를 이어 붙입니다. (owner/source/label 값 확인용)
function panelText(message) {
    const collect = (components) =>
        (components ?? [])
            .map((component) => {
                const raw = typeof component.toJSON === 'function' ? component.toJSON() : component;
                return `${raw?.content ?? ''}\n${collect(raw?.components)}`;
            })
            .join('');
    return collect(message.components);
}

module.exports = { useTempDirs, writeJson, readJson, member, makeGuild, makeChannel, makeOverwrites, panelText, ChannelType };
