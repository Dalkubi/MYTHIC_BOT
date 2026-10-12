// 봇 운영 알림 로그를 지정한 텍스트채널로 보냅니다.
// 채널은 /설정 운영로그채널 또는 config/channels.json 의 opsLogChannelId 로 지정합니다.
// 채널이 지정되지 않았다면 아무것도 보내지 않고 콘솔 로그만 남습니다.
//
// 보내는 알림: 봇 시작/재시작, 에러/실패, 정리 작업 결과
//
// 주의: 이 모듈의 실패는 절대 봇 동작에 영향을 주면 안 되고,
//       로그 전송 실패가 다시 로그를 만드는 무한 루프도 생기면 안 됩니다.
//       그래서 모든 전송은 try/catch 로 감싸고 실패 시 콘솔에만 기록합니다.

const { EmbedBuilder } = require('discord.js');
const { getGuildSettings } = require('../config');

let botClient = null;

// 같은 에러가 반복될 때 이 시간 안에는 한 번만 보냅니다.
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const recentErrors = new Map(); // key -> { lastSent, suppressed }

const COLORS = { start: 0x2f9bff, error: 0xed4245, sweep: 0x57f287 };

// 디스코드 에러 코드별로 원인을 짐작할 수 있는 안내문
const ERROR_HINTS = {
    50013: '봇에 필요한 권한이 없습니다. 봇 역할의 "채널 관리", "멤버 이동" 권한과 역할 순서를 확인하세요.',
    50001: '봇이 해당 채널/서버에 접근할 수 없습니다. 채널 권한 또는 초대 스코프를 확인하세요.',
    10003: '대상 채널을 찾을 수 없습니다. 이미 삭제된 채널일 수 있습니다.',
    30013: '카테고리에 만들 수 있는 채널 수 한도(50개)에 도달했습니다.',
};

function init(client) {
    botClient = client;
}

// 토큰처럼 보이는 문자열을 가려서 로그 채널에 노출되지 않게 합니다.
function mask(text) {
    let result = String(text ?? '');
    const token = process.env.DISCORD_TOKEN;
    if (token) result = result.split(token).join('[TOKEN]');
    return result.replace(/[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,}/g, '[TOKEN]');
}

function clip(text, max) {
    const value = mask(text);
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function nowStamp() {
    return `<t:${Math.floor(Date.now() / 1000)}:F>`;
}

// 로그를 받을 채널을 찾습니다. 지정이 없거나 찾을 수 없으면 null
async function resolveLogChannel(guildId) {
    if (!botClient) return null;
    const channelId = getGuildSettings(guildId).opsLogChannelId;
    if (!channelId) return null;

    const channel =
        botClient.channels.cache.get(channelId) ||
        (await botClient.channels.fetch(channelId).catch(() => null));
    return channel?.isTextBased?.() ? channel : null;
}

// guildId 가 있으면 그 서버만, 없으면 로그 채널이 설정된 모든 서버에 보냅니다.
async function deliver(guildId, embed) {
    if (!botClient) return;

    const guildIds = guildId ? [guildId] : [...botClient.guilds.cache.keys()];
    for (const id of guildIds) {
        try {
            const channel = await resolveLogChannel(id);
            if (channel) await channel.send({ embeds: [embed] });
        } catch (err) {
            // 로그 전송 실패는 콘솔에만 남기고 다시 로그를 만들지 않습니다.
            console.error(`운영 로그 전송 실패(${id}):`, err.message);
        }
    }
}

// 에러/실패 알림. key 가 같은 에러는 10분 안에 한 번만 보냅니다.
async function error(title, err, { guildId = null, key = null, detail = null } = {}) {
    try {
        const dedupeKey = key || `${title}:${err?.code ?? ''}:${err?.message ?? ''}`;
        const now = Date.now();
        const record = recentErrors.get(dedupeKey);

        if (record && now - record.lastSent < DUPLICATE_WINDOW_MS) {
            record.suppressed += 1;
            return;
        }

        const suppressed = record?.suppressed ?? 0;
        recentErrors.set(dedupeKey, { lastSent: now, suppressed: 0 });

        const embed = new EmbedBuilder()
            .setColor(COLORS.error)
            .setTitle(`❌ ${title}`)
            .setDescription(`발생 시각: ${nowStamp()}`)
            .addFields({
                name: '오류 내용',
                value: `\`\`\`${clip(err?.message ?? err, 900)}\`\`\``,
            });

        if (err?.code) embed.addFields({ name: '오류 코드', value: String(err.code), inline: true });
        if (detail) embed.addFields({ name: '상세', value: clip(detail, 1000) });
        if (ERROR_HINTS[err?.code]) embed.addFields({ name: '확인할 것', value: ERROR_HINTS[err.code] });
        if (suppressed > 0) {
            embed.addFields({ name: '반복', value: `직전 10분 동안 같은 오류가 ${suppressed}회 더 발생했습니다.` });
        }

        await deliver(guildId, embed);
    } catch (innerErr) {
        console.error('운영 로그(에러) 생성 실패:', innerErr.message);
    }
}

// 봇 시작/재시작 알림. 서버마다 그 서버의 정리 결과를 함께 보여줍니다.
async function startup(client, registerResult, sweepStatsByGuild) {
    try {
        for (const guild of client.guilds.cache.values()) {
            const stats = sweepStatsByGuild.get(guild.id) || emptyStats();
            const failed = !registerResult.ok;

            const embed = new EmbedBuilder()
                .setColor(failed ? COLORS.error : COLORS.start)
                .setTitle('🟢 봇이 시작되었습니다')
                .setDescription(`시작 시각: ${nowStamp()}`)
                .addFields(
                    {
                        name: '슬래시 명령어',
                        value: failed
                            ? `❌ 등록 실패 — ${clip(registerResult.error, 300)}`
                            : `✅ ${registerResult.count}개 등록 완료 (${registerResult.scope})`,
                    },
                    { name: '시작 정리', value: formatStats(stats) }
                );

            await deliver(guild.id, embed);
        }
    } catch (err) {
        console.error('운영 로그(시작) 생성 실패:', err.message);
    }
}

// 5분 점검에서 삭제/복구/승계/정렬이 있었을 때만 요약을 보냅니다.
async function sweepSummary(guildId, stats) {
    try {
        if (!hasChanges(stats)) return;

        const embed = new EmbedBuilder()
            .setColor(COLORS.sweep)
            .setTitle('🧹 정리 작업 결과')
            .setDescription(`${nowStamp()}\n${formatStats(stats)}`);

        await deliver(guildId, embed);
    } catch (err) {
        console.error('운영 로그(정리) 생성 실패:', err.message);
    }
}

function emptyStats() {
    return { deleted: 0, recovered: 0, transferred: 0, sorted: 0 };
}

function hasChanges(stats) {
    return stats.deleted > 0 || stats.recovered > 0 || stats.transferred > 0 || stats.sorted > 0;
}

function formatStats(stats) {
    if (!hasChanges(stats)) return '정리할 항목이 없었습니다.';

    const lines = [];
    if (stats.deleted > 0) lines.push(`• 빈 채널 삭제 ${stats.deleted}개`);
    if (stats.recovered > 0) lines.push(`• 추적 복구 ${stats.recovered}개`);
    if (stats.transferred > 0) lines.push(`• 방장 승계 ${stats.transferred}건`);
    if (stats.sorted > 0) lines.push(`• 정렬 보정 ${stats.sorted}회`);
    return lines.join('\n');
}

// 프로세스가 비정상 종료되기 직전의 치명적 오류 알림 (최대 3초만 기다립니다)
async function fatal(label, err) {
    const task = error(label, err, { key: `fatal:${label}` });
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
    await Promise.race([task, timeout]);
}

// 정상 종료(SIGTERM/SIGINT) 알림. 의도한 재시작과 비정상 종료를 로그에서 구분할 수 있게 합니다. (최대 3초 대기)
async function shutdown(signal) {
    const task = (async () => {
        try {
            const embed = new EmbedBuilder()
                .setColor(COLORS.sweep)
                .setTitle('🔴 봇이 종료됩니다')
                .setDescription(`종료 시각: ${nowStamp()}\n종료 신호: ${signal}`);
            await deliver(null, embed);
        } catch (err) {
            console.error('운영 로그(종료) 생성 실패:', err.message);
        }
    })();
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
    await Promise.race([task, timeout]);
}

module.exports = { init, error, startup, sweepSummary, fatal, shutdown, emptyStats };
