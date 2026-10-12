// 디스코드의 "음성채널 상태(Voice Channel Status)" 기능은 아직 공식 문서화되지 않은
// 엔드포인트라(discord.js에 channel.setStatus() 같은 내장 메서드가 없음) REST를 직접 호출합니다.
// PUT /channels/{channel.id}/voice-status
// 필요 권한: 음성채널에 접속 중이 아니라면 "채널 관리(Manage Channels)" 권한으로 충분합니다.

async function setVoiceChannelStatus(client, channelId, status) {
    return client.rest.put(`/channels/${channelId}/voice-status`, {
        body: { status: status || null },
    });
}

module.exports = { setVoiceChannelStatus };
