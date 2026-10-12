const { Events, EmbedBuilder } = require('discord.js');
const { getGuildSettings } = require('../config');
const { t } = require('../utils/messages');
const opsLog = require('../utils/opsLog');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        const settings = getGuildSettings(member.guild.id);
        const channelId = settings.joinLogChannelId || settings.logChannelId;
        if (!channelId) return;

        const logChannel =
            member.guild.channels.cache.get(channelId) ||
            (await member.guild.channels.fetch(channelId).catch(() => null));

        if (!logChannel) {
            opsLog.error('입장 로그 채널을 찾을 수 없음', new Error(`채널 ID ${channelId} 를 찾을 수 없습니다.`), {
                guildId: member.guild.id,
                key: 'join-log-missing',
                detail: '/설정 입장로그채널 로 채널을 다시 지정해주세요.',
            });
            return;
        }

        const vars = { member: `${member}`, count: member.guild.memberCount };
        const embed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle(t('welcome.title'))
            .setDescription(t('welcome.description', vars))
            .setThumbnail(member.displayAvatarURL())
            .setFooter({ text: t('welcome.footer', vars) })
            .setTimestamp();

        // 전송에 실패해도 입장 처리 자체에는 영향이 없도록 하되, 원인은 운영 로그로 알립니다.
        await logChannel.send({ embeds: [embed] }).catch((err) => {
            console.error('입장 로그 전송 실패:', err.message);
            opsLog.error('입장 로그 전송 실패', err, { guildId: member.guild.id, key: 'join-log-send' });
        });
    },
};
