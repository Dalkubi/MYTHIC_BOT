// 봇이 켜질 때마다 슬래시 명령어를 디스코드에 자동 등록(동기화)합니다.
// - commands 폴더의 정의를 통째로 덮어쓰는 방식(PUT)이라 여러 번 실행해도 안전합니다.
// - 명령어를 추가/수정한 뒤에는 봇만 재시작하면 반영되므로 deploy-commands.js 를 따로 돌릴 필요가 없습니다.
// - GUILD_ID 가 있으면 해당 서버에 즉시 반영, 없으면 전역(최대 1시간 소요)으로 등록합니다.

const { Routes } = require('discord.js');

async function registerCommands(client) {
    const body = [...client.commands.values()].map((command) => command.data.toJSON());
    const guildId = process.env.GUILD_ID;
    const appId = client.application.id;

    // 시작 알림에서 등록 결과를 보여주기 위해 결과를 돌려줍니다.
    let result = { ok: false, count: 0, scope: '', error: '알 수 없는 오류' };

    try {
        if (guildId) {
            // 봇이 실제로 그 서버에 들어가 있는지 먼저 확인 (잘못된 GUILD_ID 조기 발견)
            if (!client.guilds.cache.has(guildId)) {
                console.warn(`⚠️ GUILD_ID(${guildId}) 서버에 봇이 없습니다. .env 값 또는 봇 초대 상태를 확인하세요.`);
            }

            await client.rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
            console.log(`✅ 슬래시 명령어 ${body.length}개 자동 등록 완료 (서버 ${guildId}, 즉시 반영)`);
            result = { ok: true, count: body.length, scope: '서버 등록, 즉시 반영' };

            // 예전에 전역으로 등록해 둔 같은 명령어가 있으면 목록에 중복으로 보이므로 알려줍니다.
            const globals = await client.rest.get(Routes.applicationCommands(appId)).catch(() => []);
            if (globals.length > 0) {
                console.warn(
                    `⚠️ 전역 명령어 ${globals.length}개가 남아 있어 명령어가 중복으로 보일 수 있습니다. ` +
                        `(${globals.map((c) => c.name).join(', ')}) 필요 없다면 전역 등록을 비워주세요.`
                );
            }
        } else {
            await client.rest.put(Routes.applicationCommands(appId), { body });
            console.log(`✅ 슬래시 명령어 ${body.length}개 자동 등록 완료 (전역, 최대 1시간 소요)`);
            result = { ok: true, count: body.length, scope: '전역 등록, 최대 1시간 소요' };
        }
    } catch (err) {
        result = { ok: false, count: 0, scope: '', error: err.message };

        // 50001: Missing Access -> 초대 시 applications.commands 스코프가 없었던 경우가 대부분
        if (err.code === 50001) {
            console.error(
                '❌ 슬래시 명령어 등록 실패(Missing Access): 봇을 초대할 때 "applications.commands" 스코프가 빠졌을 수 있습니다. ' +
                    '초대 링크에 scope=bot%20applications.commands 를 포함해 다시 초대해주세요.'
            );
        } else {
            console.error('❌ 슬래시 명령어 등록 실패:', err);
        }
    }

    return result;
}

module.exports = { registerCommands };
