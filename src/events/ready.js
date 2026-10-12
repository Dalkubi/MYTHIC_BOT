const { Events } = require('discord.js');
const { syncStaticConfig } = require('../utils/configSync');
const { startSweeper } = require('../utils/tempSweep');
const { registerCommands } = require('../utils/registerCommands');
const opsLog = require('../utils/opsLog');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        // 운영 알림 로그가 봇 클라이언트를 사용할 수 있게 연결합니다.
        opsLog.init(client);

        // config/channels.json 이 있으면 그 값으로 설정을 덮어씁니다.
        syncStaticConfig();
        console.log(`✅ ${client.user.tag} 로그인 완료 (${client.guilds.cache.size}개 서버)`);

        // 켜질 때마다 슬래시 명령어를 자동 등록해서 수동 배포 스크립트 실행을 잊어도 항상 최신 상태를 유지하고,
        // 재시작 중에 비어버린 임시 통화방 정리/방장 승계도 함께 처리합니다. (이후 5분마다 다시 점검)
        const [registerResult, sweepStats] = await Promise.all([
            registerCommands(client),
            startSweeper(client),
        ]);

        // 두 작업 결과를 모아 운영 알림 로그 채널에 시작 알림을 한 번 보냅니다.
        await opsLog.startup(client, registerResult, sweepStats);
    },
};
