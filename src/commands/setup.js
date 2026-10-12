const {
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const { updateGuildSettings, getGuildSettings } = require('../config');
const { CHANNEL_TYPES, resolveChannelLabel } = require('../utils/channelTypes');

// 봇이 로그/안내 메시지를 올리려면 필요한 채널 권한 (이름은 안내 문구용)
const PERMISSION_LABELS = {
    ViewChannel: '채널 보기',
    SendMessages: '메시지 보내기',
    EmbedLinks: '링크 첨부(임베드)',
    ReadMessageHistory: '메시지 기록 보기',
};
const POST_PERMISSIONS = ['ViewChannel', 'SendMessages', 'EmbedLinks'];

// 명령어 옵션의 채널은 일부 정보만 담긴 경우가 있어, 권한 확인이 가능한 실제 채널 객체로 바꿉니다.
async function resolveGuildChannel(interaction, channel) {
    return (
        interaction.guild.channels.cache.get(channel.id) ||
        (await interaction.guild.channels.fetch(channel.id).catch(() => null))
    );
}

// 봇에게 부족한 채널 권한 이름 목록을 돌려줍니다. (권한 확인이 불가능하면 전부 부족한 것으로 봄)
function missingPermissions(guildChannel, guild, required = POST_PERMISSIONS) {
    const perms = guildChannel?.permissionsFor(guild.members.me);
    if (!perms) return required.map((flag) => PERMISSION_LABELS[flag]);
    return required.filter((flag) => !perms.has(PermissionFlagsBits[flag])).map((flag) => PERMISSION_LABELS[flag]);
}

// 권한이 부족하면 설정 완료 메시지 뒤에 붙일 경고 문구를 돌려줍니다. (설정 자체는 저장됨)
async function permissionWarning(interaction, channel, required = POST_PERMISSIONS) {
    const guildChannel = await resolveGuildChannel(interaction, channel);
    const missing = missingPermissions(guildChannel, interaction.guild, required);
    if (missing.length === 0) return '';
    return `\n⚠️ 봇에 이 채널의 권한이 부족합니다: **${missing.join(', ')}** — 권한을 주지 않으면 메시지가 올라오지 않습니다.`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('설정')
        .setDescription('봇 기능 관련 서버 설정 (관리자 전용)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) =>
            sub
                .setName('생성채널추가')
                .setDescription('음성채널 자동 생성 트리거로 쓸 채널을 추가합니다 (여러 개 등록 가능)')
                .addChannelOption((opt) =>
                    opt
                        .setName('채널')
                        .setDescription('이 채널에 입장하면 새 개인 채널이 만들어집니다')
                        .addChannelTypes(ChannelType.GuildVoice)
                        .setRequired(true)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('유형')
                        .setDescription('이 트리거로 만들어질 통화방 유형 (생략하면 기존 등록 순서 기준 라벨)')
                        .addChoices(...CHANNEL_TYPES.map((type) => ({ name: type, value: type })))
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('생성채널유형')
                .setDescription('이미 등록된 트리거 채널의 통화방 유형을 변경합니다')
                .addChannelOption((opt) =>
                    opt
                        .setName('채널')
                        .setDescription('유형을 바꿀 트리거 채널')
                        .addChannelTypes(ChannelType.GuildVoice)
                        .setRequired(true)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('유형')
                        .setDescription('적용할 통화방 유형')
                        .addChoices(...CHANNEL_TYPES.map((type) => ({ name: type, value: type })))
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('생성채널제거')
                .setDescription('등록된 트리거 채널을 목록에서 제거합니다')
                .addChannelOption((opt) =>
                    opt
                        .setName('채널')
                        .setDescription('제거할 트리거 채널')
                        .addChannelTypes(ChannelType.GuildVoice)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('카테고리')
                .setDescription('자동 생성된 채널이 위치할 카테고리를 지정합니다 (선택)')
                .addChannelOption((opt) =>
                    opt
                        .setName('카테고리')
                        .setDescription('지정하지 않으면 각 트리거 채널과 같은 카테고리에 만들어집니다')
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('입장로그채널')
                .setDescription('멤버 입장 알림을 보낼 텍스트채널을 지정합니다')
                .addChannelOption((opt) =>
                    opt
                        .setName('채널')
                        .setDescription('입장 메시지가 올라올 채널')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('퇴장로그채널')
                .setDescription('멤버 퇴장 알림을 보낼 텍스트채널을 지정합니다')
                .addChannelOption((opt) =>
                    opt
                        .setName('채널')
                        .setDescription('퇴장 메시지가 올라올 채널')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('자기소개채널')
                .setDescription('새 글이 올라올 때마다 안내 임베드를 맨 아래로 재게시할 채널을 지정합니다')
                .addChannelOption((opt) =>
                    opt
                        .setName('채널')
                        .setDescription('자기소개 채널')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('운영로그채널')
                .setDescription('봇 시작/에러/정리 작업 알림을 보낼 텍스트채널을 지정합니다 (관리자용)')
                .addChannelOption((opt) =>
                    opt
                        .setName('채널')
                        .setDescription('운영 알림이 올라올 채널')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub.setName('확인').setDescription('현재 설정값을 확인합니다')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const settings = getGuildSettings(guildId);

        if (sub === '생성채널추가') {
            const channel = interaction.options.getChannel('채널');
            const type = interaction.options.getString('유형');
            const list = new Set(settings.createChannelIds || []);
            list.add(channel.id);

            const patch = { createChannelIds: [...list] };
            if (type) {
                patch.channelLabels = { ...(settings.channelLabels || {}), [channel.id]: type };
            }
            updateGuildSettings(guildId, patch);

            await interaction.reply({
                content: `✅ ${channel} 을(를) 자동 생성 트리거 채널로 추가했습니다.${type ? ` (유형: **${type}**)` : ''} (현재 ${list.size}개 등록됨)`,
                flags: MessageFlags.Ephemeral,
            });
        } else if (sub === '생성채널유형') {
            const channel = interaction.options.getChannel('채널');
            const type = interaction.options.getString('유형', true);

            // 트리거로 등록되지 않은 채널에는 유형만 저장해도 의미가 없으므로 먼저 확인
            if (!(settings.createChannelIds || []).includes(channel.id)) {
                await interaction.reply({
                    content: `⚠️ ${channel} 은(는) 트리거 채널로 등록되어 있지 않습니다. 먼저 \`/설정 생성채널추가\` 로 등록해주세요.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            updateGuildSettings(guildId, {
                channelLabels: { ...(settings.channelLabels || {}), [channel.id]: type },
            });
            await interaction.reply({
                content: `✅ ${channel} 의 통화방 유형을 **${type}**(으)로 설정했습니다. 이후 생성되는 채널부터 적용됩니다.`,
                flags: MessageFlags.Ephemeral,
            });
        } else if (sub === '생성채널제거') {
            const channel = interaction.options.getChannel('채널');
            const list = new Set(settings.createChannelIds || []);
            const existed = list.delete(channel.id);

            // 트리거에서 빠지는 채널의 유형 지정도 함께 정리
            const labels = { ...(settings.channelLabels || {}) };
            delete labels[channel.id];
            updateGuildSettings(guildId, { createChannelIds: [...list], channelLabels: labels });
            await interaction.reply({
                content: existed
                    ? `✅ ${channel} 을(를) 트리거 목록에서 제거했습니다. (현재 ${list.size}개 등록됨)`
                    : `⚠️ ${channel} 은(는) 등록되어 있지 않습니다.`,
                flags: MessageFlags.Ephemeral,
            });
        } else if (sub === '카테고리') {
            const category = interaction.options.getChannel('카테고리');
            updateGuildSettings(guildId, { createCategoryId: category.id });
            await interaction.reply({
                content: `✅ 자동 생성 채널이 만들어질 카테고리를 ${category.name} (으)로 설정했습니다.`,
                flags: MessageFlags.Ephemeral,
            });
        } else if (sub === '입장로그채널') {
            const channel = interaction.options.getChannel('채널');
            updateGuildSettings(guildId, { joinLogChannelId: channel.id });
            const warning = await permissionWarning(interaction, channel);
            await interaction.reply({
                content: `✅ 입장 로그 채널을 ${channel} (으)로 설정했습니다.${warning}`,
                flags: MessageFlags.Ephemeral,
            });
        } else if (sub === '퇴장로그채널') {
            const channel = interaction.options.getChannel('채널');
            updateGuildSettings(guildId, { leaveLogChannelId: channel.id });
            const warning = await permissionWarning(interaction, channel);
            await interaction.reply({
                content: `✅ 퇴장 로그 채널을 ${channel} (으)로 설정했습니다.${warning}`,
                flags: MessageFlags.Ephemeral,
            });
        } else if (sub === '자기소개채널') {
            const channel = interaction.options.getChannel('채널');
            updateGuildSettings(guildId, { introChannelId: channel.id });
            // 안내 메시지를 지우고 다시 올리려면 메시지 기록 보기 권한도 필요합니다.
            const warning = await permissionWarning(interaction, channel, [...POST_PERMISSIONS, 'ReadMessageHistory']);
            await interaction.reply({
                content: `✅ 자기소개 채널을 ${channel} (으)로 설정했습니다.${warning}`,
                flags: MessageFlags.Ephemeral,
            });
        } else if (sub === '운영로그채널') {
            const channel = interaction.options.getChannel('채널');
            updateGuildSettings(guildId, { opsLogChannelId: channel.id });

            // 실제로 글이 올라가는지 테스트 메시지를 보내 바로 확인합니다.
            const warning = await permissionWarning(interaction, channel);
            let testResult = '';
            const guildChannel = await resolveGuildChannel(interaction, channel);
            try {
                await guildChannel.send({ content: '✅ 이 채널이 봇 운영 알림 로그 채널로 지정되었습니다.' });
            } catch (err) {
                testResult = `\n❌ 테스트 메시지 전송에 실패했습니다: ${err.message}`;
            }

            await interaction.reply({
                content: `✅ 운영 알림 로그 채널을 ${channel} (으)로 설정했습니다. 봇 시작, 에러, 정리 작업 결과가 이 채널에 올라옵니다.${warning}${testResult}`,
                flags: MessageFlags.Ephemeral,
            });
        } else if (sub === '확인') {
            const s = getGuildSettings(guildId);
            // 트리거 채널마다 현재 적용되는 유형을 함께 표시
            const triggerList = (s.createChannelIds || [])
                .map((id) => {
                    const ch = interaction.guild.channels.cache.get(id);
                    return ch ? `<#${id}> (${resolveChannelLabel(guildId, ch)})` : `<#${id}>`;
                })
                .join(', ');
            await interaction.reply({
                content: [
                    '**현재 설정**',
                    `생성 트리거 채널: ${triggerList || '미설정'}`,
                    `생성 카테고리: ${s.createCategoryId ? `<#${s.createCategoryId}>` : '미설정 (각 트리거 채널과 동일)'}`,
                    `입장 로그 채널: ${s.joinLogChannelId ? `<#${s.joinLogChannelId}>` : s.logChannelId ? `<#${s.logChannelId}> (레거시 로그채널)` : '미설정'}`,
                    `퇴장 로그 채널: ${s.leaveLogChannelId ? `<#${s.leaveLogChannelId}>` : s.logChannelId ? `<#${s.logChannelId}> (레거시 로그채널)` : '미설정'}`,
                    `자기소개 채널: ${s.introChannelId ? `<#${s.introChannelId}>` : '미설정'}`,
                    `운영 알림 로그 채널: ${s.opsLogChannelId ? `<#${s.opsLogChannelId}>` : '미설정 (콘솔 로그만 기록)'}`,
                ].join('\n'),
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
