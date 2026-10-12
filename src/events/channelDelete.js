const { Events } = require('discord.js');
const tempChannels = require('../utils/tempChannels');
const ownership = require('../utils/ownership');

// 채널이 삭제되면(관리자가 직접 지운 경우 포함) 추적 정보와 입장 기록을 함께 정리합니다.
// 이 처리가 없으면 이미 없는 채널이 추적 목록에 계속 남습니다.
module.exports = {
    name: Events.ChannelDelete,
    execute(channel) {
        if (!tempChannels.isTempChannel(channel.id)) return;

        tempChannels.removeChannel(channel.id);
        ownership.forgetChannel(channel.id);
    },
};
