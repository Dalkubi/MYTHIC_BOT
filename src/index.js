require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Partials, Events } = require('discord.js');
const opsLog = require('./utils/opsLog');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates, // 음성채널 입퇴장 감지
        GatewayIntentBits.GuildMembers, // 서버 입/퇴장 감지 (Privileged Intent - 개발자 포털에서 활성화 필요)
        GatewayIntentBits.GuildMessages, // 자기소개 채널 새 글 감지 (메시지 '내용'은 읽지 않으므로 Message Content Intent는 불필요)
    ],
    partials: [Partials.GuildMember],
});

// ── 슬래시 커맨드 로드 ──────────────────────────────
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(commandsPath, file));
    client.commands.set(command.data.name, command);
}

// 이벤트 인자에서 서버(길드) ID를 찾아 운영 로그를 올바른 서버로 보냅니다.
function guildIdOf(args) {
    for (const arg of args) {
        const id = arg?.guild?.id ?? arg?.guildId ?? null;
        if (id) return id;
    }
    return null;
}

// ── 이벤트 로드 ────────────────────────────────────
// 모든 이벤트 핸들러를 try/catch 로 감쌉니다.
// 핸들러 하나가 실패해도 봇 전체가 종료되지 않고, 원인만 운영 로그로 남습니다.
const eventsPath = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'))) {
    const event = require(path.join(eventsPath, file));

    const safeExecute = async (...args) => {
        try {
            await event.execute(...args);
        } catch (err) {
            console.error(`이벤트 처리 오류(${event.name}):`, err);
            opsLog.error(`이벤트 처리 오류: ${event.name}`, err, {
                guildId: guildIdOf(args),
                key: `event:${event.name}`,
            });
        }
    };

    if (event.once) {
        client.once(event.name, safeExecute);
    } else {
        client.on(event.name, safeExecute);
    }
}

// ── 연결 상태 / 클라이언트 오류 ─────────────────────
// 리스너가 없으면 연결 오류가 예외로 올라가 봇이 종료될 수 있으므로 반드시 받아 둡니다.
client.on(Events.Error, (err) => {
    console.error('클라이언트 오류:', err);
    opsLog.error('디스코드 클라이언트 오류', err, { key: 'client-error' });
});
client.on(Events.ShardError, (err, shardId) => {
    console.error(`샤드 ${shardId} 연결 오류:`, err);
    opsLog.error(`디스코드 연결 오류 (샤드 ${shardId})`, err, { key: 'shard-error' });
});
client.on(Events.ShardDisconnect, (event, shardId) => {
    console.warn(`⚠️ 샤드 ${shardId} 연결이 끊어졌습니다. (코드 ${event?.code ?? '알 수 없음'})`);
});
client.on(Events.ShardReconnecting, (shardId) => {
    console.log(`🔄 샤드 ${shardId} 재연결 중...`);
});
client.on(Events.ShardResume, (shardId, replayedEvents) => {
    console.log(`✅ 샤드 ${shardId} 연결 복구 (재전송 이벤트 ${replayedEvents}개)`);
});
client.on(Events.Warn, (message) => {
    console.warn('디스코드 경고:', message);
});

// ── 프로세스 수준 오류 ──────────────────────────────
// 처리되지 않은 Promise 오류: 기록만 하고 봇은 계속 실행합니다. (개별 기능 하나의 실패로 전체가 멈추지 않도록)
process.on('unhandledRejection', (reason) => {
    console.error('unhandledRejection:', reason);
    opsLog.error('처리되지 않은 Promise 오류', reason instanceof Error ? reason : new Error(String(reason)), {
        key: 'unhandledRejection',
    });
});

// 처리되지 않은 예외: 프로세스 상태를 신뢰할 수 없으므로 원인을 알리고(최대 3초) 종료합니다.
// 프로세스 관리자(PM2 등)가 재시작해 주는 환경을 전제로 합니다.
process.on('uncaughtException', async (err) => {
    console.error('uncaughtException:', err);
    await opsLog.fatal('처리되지 않은 예외로 봇이 종료됩니다', err);
    process.exit(1);
});

// ── 정상 종료 ───────────────────────────────────────
// 재시작/종료 신호를 받으면 종료 사실을 운영 로그에 남기고 연결을 정리합니다.
let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`🔴 ${signal} 신호를 받아 종료합니다.`);
    await opsLog.shutdown(signal);
    client.destroy();
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

client.login(process.env.DISCORD_TOKEN);
