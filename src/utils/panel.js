const {
    ActionRowBuilder,
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
} = require('discord.js');
const { t } = require('./messages');

// 메뉴 옵션의 문구는 config/messages.json 의 panel.options 에서 가져옵니다. (이모지는 여기서 고정)
function option(key, emoji) {
    return {
        label: t(`panel.options.${key}.label`),
        description: t(`panel.options.${key}.description`),
        value: key,
        emoji,
    };
}

function divider() {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

// 채널 ID와 소유자 ID를 패널 안에 함께 남겨 봇이 재시작된 뒤에도
// 패널 메시지만 남아 있다면 소유자 검증을 복구할 수 있게 합니다.
// options.fixed 가 true 인 유형(정규/기밀/극비/전면전/폭파전)은
// 이름 변경과 인원 제한 메뉴를 보여주지 않고 상태 메시지만 편집할 수 있게 합니다.
function buildPanel(channel, ownerId, channelLabel = '정규', { fixed = false } = {}) {
    const settingOptions = [];

    if (!fixed) {
        settingOptions.push(option('rename', '✏️'), option('limit', '👥'));
    }
    settingOptions.push(option('status', '📝'));

    const settingRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`panelsetting_${channel.id}`)
            .setPlaceholder(t('panel.settingPlaceholder'))
            .addOptions(settingOptions)
    );

    const permissionRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`panelpermission_${channel.id}`)
            .setPlaceholder(t('panel.permissionPlaceholder'))
            .addOptions(
                option('lock', '🔒'),
                option('unlock', '🔓'),
                option('allow', '✅'),
                option('deny', '⛔'),
                option('reset', '♻️')
            )
    );

    const container = new ContainerBuilder()
        .setAccentColor(0x2f9bff)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [t('panel.title', { channel: channel.name }), t('panel.subtitle')].join('\n')
            )
        )
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [
                    t('panel.ownerLine', { owner: ownerId }),
                    t('panel.categoryLine', { label: channelLabel }),
                    t('panel.permissionNotice'),
                ].join('\n')
            )
        )
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(t(fixed ? 'panel.settingsFixed' : 'panel.settingsFree'))
        )
        .addActionRowComponents(settingRow)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(t('panel.permissions')))
        .addActionRowComponents(permissionRow)
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [
                    t('panel.footerWarning'),
                    // 아래 한 줄은 봇이 소유자/채널/유형을 복구하는 데 쓰는 값이라 문구 파일로 빼지 않습니다.
                    `-# owner:${ownerId}|source:${channel.id}|label:${channelLabel}|limit:${channel.userLimit ?? 0}`,
                ].join('\n')
            )
        );

    return {
        flags: MessageFlags.IsComponentsV2,
        components: [container],
    };
}

module.exports = { buildPanel };
