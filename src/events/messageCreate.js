const { Events, EmbedBuilder } = require('discord.js');
const { getGuildSettings, updateGuildSettings } = require('../config');
const { t } = require('../utils/messages');
const opsLog = require('../utils/opsLog');

const EMBED_COLOR = 0xffd700;

// 서버별 자기소개 안내 갱신 상태
//  running: 지금 갱신 작업이 돌고 있는지 / queued: 작업 중 새 글이 더 올라와 한 번 더 갱신이 필요한지
const stickyState = new Map();

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        // 봇 자신이 올린 메시지(안내 임베드 포함)는 무시 - 안 그러면 무한 반복됩니다
        if (message.author.bot) return;
        if (!message.guild) return;

        const settings = getGuildSettings(message.guild.id);
        if (!settings.introChannelId || message.channel.id !== settings.introChannelId) return;

        scheduleStickyRefresh(message.guild.id, message.channel);
    },
};

// 안내 메시지 갱신을 서버마다 한 번에 하나씩만 실행합니다.
// 자기소개가 거의 동시에 여러 개 올라와도
//  - 안내 메시지가 중복으로 생기거나
//  - 지워지지 않은 안내 메시지가 남는 일이 없도록,
// 작업 중에 들어온 글은 "한 번 더 갱신"으로 묶어서 처리합니다.
function scheduleStickyRefresh(guildId, channel) {
    const state = stickyState.get(guildId) || { running: false, queued: false };
    stickyState.set(guildId, state);

    if (state.running) {
        state.queued = true;
        return;
    }

    state.running = true;
    (async () => {
        try {
            do {
                state.queued = false;
                await refreshSticky(guildId, channel);
            } while (state.queued);
        } catch (err) {
            console.error('자기소개 안내 메시지 갱신 실패:', err);
            opsLog.error('자기소개 안내 메시지 갱신 실패', err, { guildId, key: 'intro-sticky' });
        } finally {
            state.running = false;
        }
    })();
}

async function refreshSticky(guildId, channel) {
    // 작업 시점의 최신 설정을 읽습니다. (직전 갱신에서 저장한 메시지 ID를 이어서 사용)
    const settings = getGuildSettings(guildId);

    // 이전에 올려둔 안내 임베드가 있으면 삭제합니다.
    // 봇이 재시작돼도 찾을 수 있도록 메시지 ID를 settings.json에 저장해뒀습니다.
    // (유저가 올린 자기소개 글은 여기서 절대 건드리지 않습니다 - 삭제 대상은 오직 봇이 보낸 안내 메시지뿐)
    if (settings.introStickyMessageId) {
        const oldMessage = await channel.messages.fetch(settings.introStickyMessageId).catch(() => null);
        if (oldMessage) {
            await oldMessage.delete().catch(() => {});
        }
    }

    const sent = await channel.send({ embeds: [buildIntroGuideEmbed()] });
    updateGuildSettings(guildId, { introStickyMessageId: sent.id });
}

function buildIntroGuideEmbed() {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(t('intro.title'))
        .setDescription(t('intro.description'))
        .setFooter({ text: t('intro.footer') });
}
