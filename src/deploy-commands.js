require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(commandsPath, file));
    commands.push(command.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        const route = process.env.GUILD_ID
            ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
            : Routes.applicationCommands(process.env.CLIENT_ID);

        await rest.put(route, { body: commands });

        console.log(
            `✅ 슬래시 커맨드 ${commands.length}개 등록 완료 ${
                process.env.GUILD_ID ? '(테스트 서버 즉시 반영)' : '(전역 - 최대 1시간 소요)'
            }`
        );
    } catch (err) {
        console.error('커맨드 등록 실패:', err);
    }
})();
