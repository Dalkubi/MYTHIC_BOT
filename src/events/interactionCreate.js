const {
    Events,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    UserSelectMenuBuilder,
    PermissionFlagsBits,
    OverwriteType,
} = require('discord.js');
const tempChannels = require('../utils/tempChannels');
const ownership = require('../utils/ownership');
const { setVoiceChannelStatus } = require('../utils/voiceStatus');
const { isFixedType, parseFixedName, looksLikeFixedName, buildChannelName } = require('../utils/channelTypes');
const { t } = require('../utils/messages');
const opsLog = require('../utils/opsLog');

// 디스코드의 채널 이름 변경 제한(10분에 2회)에 걸리면 요청이 오래 대기할 수 있어,
// 이 시간 안에 끝나지 않으면 사용자에게 먼저 지연 안내를 보냅니다.
const SLOW_REQUEST_MS = 10 * 1000;

class SlowRequestError extends Error {}

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new SlowRequestError('요청이 지연되고 있습니다.')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 본인에게만 보이는 응답 형식
function ephemeral(content) {
    return { content, flags: MessageFlags.Ephemeral };
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        // 1) 슬래시 커맨드
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return;
            try {
                await command.execute(interaction);
            } catch (err) {
                console.error(err);
                opsLog.error('명령어 처리 오류', err, {
                    guildId: interaction.guildId,
                    key: `command:${interaction.commandName}`,
                    detail: `명령어: /${interaction.commandName} ${interaction.options.getSubcommand(false) ?? ''}`.trim(),
                });
                const payload = ephemeral(t('interaction.commandError'));
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(payload).catch(() => {});
                } else {
                    await interaction.reply(payload).catch(() => {});
                }
            }
            return;
        }

        // 2) 컨트롤 패널 버튼 클릭 (이전 버전 패널 호환)
        if (interaction.isButton()) {
            const [prefix, action, channelId] = interaction.customId.split('_');
            if (prefix !== 'panel') return;

            if (!(await checkOwner(interaction, channelId))) return;

            if (action === 'rename') {
                if (await rejectIfFixed(interaction, channelId)) return;
                await showRenameModal(interaction, channelId);
            } else if (action === 'status') {
                await showStatusModal(interaction, channelId);
            } else if (action === 'limit') {
                if (await rejectIfFixed(interaction, channelId)) return;
                await showLimitModal(interaction, channelId);
            }
            return;
        }

        // 3) 패널 선택 메뉴 처리
        if (interaction.isStringSelectMenu()) {
            const [prefix, channelId] = interaction.customId.split('_');
            if (prefix !== 'panelsetting' && prefix !== 'panelpermission') return;

            if (!(await checkOwner(interaction, channelId))) return;

            const action = interaction.values[0];

            if (prefix === 'panelsetting') {
                await handleSettingSelect(interaction, channelId, action);
            } else {
                await handlePermissionSelect(interaction, channelId, action);
            }
            return;
        }

        // 4) 권한 대상 유저 선택 처리
        if (interaction.isUserSelectMenu()) {
            const [prefix, action, channelId] = interaction.customId.split('_');
            if (prefix !== 'userpermission') return;

            if (!(await checkOwner(interaction, channelId))) return;

            const userId = interaction.values[0];
            const channel = await getChannel(interaction, channelId);
            if (!channel) {
                await interaction.update({ content: t('interaction.channelNotFound'), components: [] });
                return;
            }

            try {
                await applyUserPermission(channel, userId, action);
                await interaction.update({ content: getPermissionResultMessage(userId, action), components: [] });
            } catch (err) {
                console.error('유저 권한 변경 실패:', err);
                opsLog.error('유저 권한 변경 실패', err, { guildId: interaction.guildId, key: 'user-permission' });
                await interaction.update({ content: t('interaction.permissionFailed'), components: [] }).catch(() => {});
            }
            return;
        }

        // 5) 모달 제출 (이름 변경 / 인원 제한 / 상태 설정)
        if (interaction.isModalSubmit()) {
            const [prefix, channelId] = interaction.customId.split('_');

            if (prefix === 'modalrename') {
                await handleRenameSubmit(interaction, channelId);
            } else if (prefix === 'modallimit') {
                await handleLimitSubmit(interaction, channelId);
            } else if (prefix === 'modalstatus') {
                await handleStatusSubmit(interaction, channelId);
            }
            return;
        }
    },
};

// ── 권한 확인 ───────────────────────────────────────

// 패널을 조작하려는 사람이 해당 임시 채널의 방장이거나 관리자인지 확인
// 관리자(채널 관리 권한 보유자)는 분쟁 방을 정리할 수 있도록 모든 방의 패널을 사용할 수 있습니다.
async function checkOwner(interaction, channelId) {
    const ownerId = tempChannels.getOwner(channelId) || getOwnerFromPanel(interaction);

    if (ownerId) {
        tempChannels.setOwner(channelId, ownerId);
    }

    const isStaff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false;
    if (isStaff) return true;

    if (!ownerId) {
        await interaction.reply(ephemeral(t('interaction.ownerUnknown'))).catch(() => {});
        return false;
    }

    if (ownerId !== interaction.user.id) {
        await interaction.reply(ephemeral(t('interaction.notOwner'))).catch(() => {});
        return false;
    }
    return true;
}

function getOwnerFromPanel(interaction) {
    const footer = interaction.message?.embeds?.[0]?.footer?.text;
    const footerOwner = footer?.match(/owner:(\d+)/)?.[1];
    if (footerOwner) return footerOwner;

    return findOwnerInComponents(interaction.message?.components ?? []);
}

function findOwnerInComponents(components) {
    for (const component of components) {
        const raw = typeof component.toJSON === 'function' ? component.toJSON() : component;
        const ownerId = raw?.content?.match(/owner:(\d+)/)?.[1];

        if (ownerId) {
            return ownerId;
        }

        const childOwnerId = findOwnerInComponents(raw?.components ?? []);
        if (childOwnerId) {
            return childOwnerId;
        }
    }

    return null;
}

async function getChannel(interaction, channelId) {
    return interaction.guild.channels.cache.get(channelId)
        || await interaction.guild.channels.fetch(channelId).catch(() => null);
}

// 이름/인원수가 고정된 유형(정규/기밀/극비/전면전/폭파전)의 채널인지 확인합니다.
// 추적 정보에 저장된 유형을 우선 사용하고, 없으면 채널 이름 형식에서 유형을 읽어냅니다.
async function isFixedChannel(interaction, channelId) {
    const info = tempChannels.getInfo(channelId);
    if (info?.type) return isFixedType(info.type);

    const channel = await getChannel(interaction, channelId);
    const parsed = channel ? parseFixedName(channel.name) : null;
    return parsed ? isFixedType(parsed.type) : false;
}

// 고정형 채널에서 이름 변경/인원 제한을 시도하면 막고 안내합니다. (막았으면 true)
// 패널에서 해당 메뉴를 숨기지만, 이전에 만들어진 패널이나 직접 보낸 요청도 서버 쪽에서 한 번 더 차단합니다.
async function rejectIfFixed(interaction, channelId) {
    if (!(await isFixedChannel(interaction, channelId))) return false;

    await interaction.reply(ephemeral(t('interaction.fixedLocked'))).catch(() => {});
    return true;
}

// 변경 후 패널의 표시(채널 이름, 인원 제한)가 옛날 값으로 남지 않도록 다시 그립니다.
async function refreshPanelSafely(channel) {
    try {
        await ownership.refreshPanel(channel);
    } catch (err) {
        console.error(`패널 갱신 실패(${channel.id}):`, err.message);
        opsLog.error('패널 갱신 실패', err, { guildId: channel.guild.id, key: 'panel-refresh' });
    }
}

// ── 채널 설정 메뉴 ──────────────────────────────────

async function handleSettingSelect(interaction, channelId, action) {
    if (action === 'rename') {
        if (await rejectIfFixed(interaction, channelId)) return;
        await showRenameModal(interaction, channelId);
        return;
    }

    if (action === 'limit') {
        if (await rejectIfFixed(interaction, channelId)) return;
        await showLimitModal(interaction, channelId);
        return;
    }

    if (action === 'status') {
        await showStatusModal(interaction, channelId);
        return;
    }

    await interaction.reply(ephemeral(t('interaction.unknownSetting')));
}

// 자유형 방의 기본 이름 ("[자유] ○○님의 채널")
function defaultRoomName(interaction, channelId) {
    const info = tempChannels.getInfo(channelId);
    const ownerId = tempChannels.getOwner(channelId) || interaction.user.id;
    const owner = interaction.guild.members.cache.get(ownerId) || interaction.member;
    const ownerName = owner?.displayName || interaction.user.username;

    const type = info?.type && !isFixedType(info.type) ? info.type : '자유';
    return buildChannelName(type, null, ownerName);
}

async function handleRenameSubmit(interaction, channelId) {
    if (!(await checkOwner(interaction, channelId))) return;
    if (await rejectIfFixed(interaction, channelId)) return;

    // 이름 변경은 디스코드 제한으로 오래 걸릴 수 있어 먼저 응답을 확보합니다.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = await getChannel(interaction, channelId);
    if (!channel) {
        await interaction.editReply(t('interaction.channelNotFound'));
        return;
    }

    let newName = interaction.fields.getTextInputValue('new_name').trim();

    // 비어 있거나 고정형 방 이름처럼 보이는 이름("[1] ...")은 기본 이름으로 바꿔 사칭을 막습니다.
    let wasReset = false;
    if (!newName || looksLikeFixedName(newName)) {
        newName = defaultRoomName(interaction, channelId);
        wasReset = true;
    }

    try {
        const updated = await withTimeout(channel.setName(newName, '방장이 패널에서 이름 변경'), SLOW_REQUEST_MS);
        await refreshPanelSafely(updated || channel);
        await interaction.editReply(t(wasReset ? 'interaction.renameReset' : 'interaction.renameDone', { name: newName }));
    } catch (err) {
        if (err instanceof SlowRequestError) {
            await interaction.editReply(t('interaction.renameSlow')).catch(() => {});
            return;
        }
        console.error('채널 이름 변경 실패:', err);
        opsLog.error('채널 이름 변경 실패', err, { guildId: interaction.guildId, key: 'channel-rename' });
        await interaction.editReply(t('interaction.renameFailed')).catch(() => {});
    }
}

async function handleLimitSubmit(interaction, channelId) {
    if (!(await checkOwner(interaction, channelId))) return;
    if (await rejectIfFixed(interaction, channelId)) return;

    const rawLimit = interaction.fields.getTextInputValue('new_limit').trim();
    const limit = Number(rawLimit);

    if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
        await interaction.reply(ephemeral(t('interaction.limitInvalid')));
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = await getChannel(interaction, channelId);
    if (!channel) {
        await interaction.editReply(t('interaction.channelNotFound'));
        return;
    }

    try {
        const updated = await withTimeout(channel.setUserLimit(limit, '방장이 패널에서 인원 제한 변경'), SLOW_REQUEST_MS);
        await refreshPanelSafely(updated || channel);

        const limitText = limit === 0 ? t('interaction.limitUnlimited') : t('interaction.limitCount', { count: limit });
        await interaction.editReply(t('interaction.limitDone', { limit: limitText }));
    } catch (err) {
        if (err instanceof SlowRequestError) {
            await interaction.editReply(t('interaction.renameSlow')).catch(() => {});
            return;
        }
        console.error('인원 제한 변경 실패:', err);
        opsLog.error('인원 제한 변경 실패', err, { guildId: interaction.guildId, key: 'channel-limit' });
        await interaction.editReply(t('interaction.limitFailed')).catch(() => {});
    }
}

async function handleStatusSubmit(interaction, channelId) {
    if (!(await checkOwner(interaction, channelId))) return;

    const channel = await getChannel(interaction, channelId);
    if (!channel) {
        await interaction.reply(ephemeral(t('interaction.channelNotFound')));
        return;
    }

    const newStatus = interaction.fields.getTextInputValue('new_status');
    try {
        await setVoiceChannelStatus(interaction.client, channelId, newStatus);
        await interaction.reply(
            ephemeral(newStatus ? t('interaction.statusSet', { status: newStatus }) : t('interaction.statusCleared'))
        );
    } catch (err) {
        console.error('채널 상태 설정 실패:', err);
        opsLog.error('채널 상태 설정 실패', err, { guildId: interaction.guildId, key: 'voice-status' });
        await interaction.reply(ephemeral(t('interaction.statusFailed'))).catch(() => {});
    }
}

// ── 채널 권한 메뉴 ──────────────────────────────────

async function handlePermissionSelect(interaction, channelId, action) {
    if (action === 'lock' || action === 'unlock') {
        const channel = await getChannel(interaction, channelId);
        if (!channel) {
            await interaction.reply(ephemeral(t('interaction.channelNotFound')));
            return;
        }

        try {
            await applyChannelLock(interaction, channel, action);
        } catch (err) {
            console.error('채널 잠금 변경 실패:', err);
            opsLog.error('채널 잠금 변경 실패', err, { guildId: interaction.guildId, key: 'channel-lock' });
            await interaction.reply(ephemeral(t('interaction.permissionFailed'))).catch(() => {});
        }
        return;
    }

    const select = new UserSelectMenuBuilder()
        .setCustomId(`userpermission_${action}_${channelId}`)
        .setPlaceholder(t('interaction.userSelectPlaceholder'))
        .setMinValues(1)
        .setMaxValues(1);

    await interaction.reply({
        content: getPermissionPrompt(action),
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral,
    });
}

// 잠금: @everyone 입장을 막되, 지금 방에 있는 사람들은 연결이 끊겨도 다시 들어올 수 있도록 입장을 허용해 둡니다.
// 잠금 해제: 잠금 때 자동으로 준 허용 권한을 함께 걷어냅니다. (방장이 직접 "입장 허용"한 유저는 그대로 유지)
async function applyChannelLock(interaction, channel, action) {
    const everyoneId = interaction.guild.roles.everyone.id;

    if (action === 'lock') {
        // 먼저 허용을 주고 나서 잠가야, 잠그는 순간에도 방에 있는 사람이 막히지 않습니다.
        await grantCurrentMembers(channel);
        await channel.permissionOverwrites.edit(everyoneId, { Connect: false });
        await interaction.reply(ephemeral(t('interaction.locked')));
        return;
    }

    await channel.permissionOverwrites.edit(everyoneId, { Connect: null });
    await revokeLockGrants(channel);
    await interaction.reply(ephemeral(t('interaction.unlocked')));
}

// 현재 방에 있는 사람(봇 제외)에게 "입장 허용"만 부여합니다. 이미 차단된 사람은 건드리지 않습니다.
async function grantCurrentMembers(channel) {
    for (const member of channel.members.values()) {
        if (member.user.bot) continue;

        const existing = channel.permissionOverwrites.cache.get(member.id);
        if (existing?.deny.has(PermissionFlagsBits.Connect)) continue; // 차단된 유저는 그대로
        if (existing?.allow.has(PermissionFlagsBits.Connect)) continue; // 이미 허용된 유저는 그대로

        await channel.permissionOverwrites.edit(member, { Connect: true }, { reason: '채널 잠금 - 현재 인원 입장 허용' });
    }
}

// 잠금 때 자동으로 준 허용 권한("입장 허용"만 있는 개별 권한)을 제거합니다.
async function revokeLockGrants(channel) {
    for (const overwrite of [...channel.permissionOverwrites.cache.values()]) {
        const isLockGrant =
            overwrite.type === OverwriteType.Member &&
            overwrite.allow.bitfield === PermissionFlagsBits.Connect &&
            overwrite.deny.bitfield === 0n;

        if (isLockGrant) {
            await channel.permissionOverwrites.delete(overwrite.id, '채널 잠금 해제').catch(() => {});
        }
    }
}

function getPermissionPrompt(action) {
    if (action === 'allow') return t('interaction.promptAllow');
    if (action === 'deny') return t('interaction.promptDeny');
    return t('interaction.promptReset');
}

async function applyUserPermission(channel, userId, action) {
    if (action === 'allow') {
        await channel.permissionOverwrites.edit(userId, {
            ViewChannel: true,
            Connect: true,
        });
        return;
    }

    if (action === 'deny') {
        await channel.permissionOverwrites.edit(userId, {
            ViewChannel: false,
            Connect: false,
        });
        return;
    }

    await channel.permissionOverwrites.delete(userId).catch(async () => {
        await channel.permissionOverwrites.edit(userId, {
            ViewChannel: null,
            Connect: null,
        });
    });
}

function getPermissionResultMessage(userId, action) {
    if (action === 'allow') return t('interaction.resultAllow', { user: userId });
    if (action === 'deny') return t('interaction.resultDeny', { user: userId });
    return t('interaction.resultReset', { user: userId });
}

// ── 모달 ────────────────────────────────────────────

async function showRenameModal(interaction, channelId) {
    const modal = new ModalBuilder()
        .setCustomId(`modalrename_${channelId}`)
        .setTitle(t('interaction.modalRenameTitle'));
    const input = new TextInputBuilder()
        .setCustomId('new_name')
        .setLabel(t('interaction.modalRenameLabel'))
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
}

async function showLimitModal(interaction, channelId) {
    const modal = new ModalBuilder()
        .setCustomId(`modallimit_${channelId}`)
        .setTitle(t('interaction.modalLimitTitle'));
    const input = new TextInputBuilder()
        .setCustomId('new_limit')
        .setLabel(t('interaction.modalLimitLabel'))
        .setPlaceholder(t('interaction.modalLimitPlaceholder'))
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(3)
        .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
}

async function showStatusModal(interaction, channelId) {
    const modal = new ModalBuilder()
        .setCustomId(`modalstatus_${channelId}`)
        .setTitle(t('interaction.modalStatusTitle'));
    const input = new TextInputBuilder()
        .setCustomId('new_status')
        .setLabel(t('interaction.modalStatusLabel'))
        .setStyle(TextInputStyle.Short)
        .setMaxLength(500)
        .setRequired(false);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
}

// 테스트에서 직접 검증할 수 있도록 내부 도우미를 노출합니다. (봇 동작에는 영향 없음)
module.exports.__test = { grantCurrentMembers, revokeLockGrants, applyChannelLock };
