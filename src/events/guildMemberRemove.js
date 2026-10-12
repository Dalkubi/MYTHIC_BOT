const { Events, EmbedBuilder } = require('discord.js');
const { getGuildSettings } = require('../config');
const { t } = require('../utils/messages');
const opsLog = require('../utils/opsLog');

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        const settings = getGuildSettings(member.guild.id);
        const channelId = settings.leaveLogChannelId || settings.logChannelId;
        if (!channelId) return;

        const logChannel =
            member.guild.channels.cache.get(channelId) ||
            (await member.guild.channels.fetch(channelId).catch(() => null));

        if (!logChannel) {
            opsLog.error('퇴장 로그 채널을 찾을 수 없음', new Error(`채널 ID ${channelId} 를 찾을 수 없습니다.`), {
                guildId: member.guild.id,
                key: 'leave-log-missing',
                detail: '/설정 퇴장로그채널 로 채널을 다시 지정해주세요.',
            });
            return;
        }

        const vars = {
            mention: `<@${member.id}>`,
            tag: member.user?.tag || member.user?.username || t('goodbye.unknownUser'),
            count: member.guild.memberCount,
        };

        const embed = new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle(t('goodbye.title'))
            .setDescription(t('goodbye.description', vars))
            .setThumbnail(member.displayAvatarURL())
            .setFooter({ text: t('goodbye.footer', vars) })
            .setTimestamp();

        // 전송에 실패해도 퇴장 처리 자체에는 영향이 없도록 하되, 원인은 운영 로그로 알립니다.
        await logChannel.send({ embeds: [embed] }).catch((err) => {
            console.error('퇴장 로그 전송 실패:', err.message);
            opsLog.error('퇴장 로그 전송 실패', err, { guildId: member.guild.id, key: 'leave-log-send' });
        });
    },
};
