from unittest.mock import AsyncMock, Mock

import pytest

from waffle import audio
from waffle import bot as bot_module


def test_startup_rejects_outdated_ytdlp_before_token_validation_or_login(monkeypatch):
    monkeypatch.setattr(audio, 'YTDLP_VERSION', '2025.12.08')
    monkeypatch.setattr(bot_module, 'load_dotenv', Mock())
    monkeypatch.delenv('DISCORD_TOKEN', raising=False)
    login = Mock()
    monkeypatch.setattr(bot_module.bot, 'run', login)

    with pytest.raises(SystemExit, match='yt-dlp 2025.12.08 is outdated'):
        bot_module.main()

    login.assert_not_called()


@pytest.mark.parametrize('query,is_playlist', [
    ('https://youtube.com/playlist?list=PLabc', True),
    ('https://youtu.be/abcdefghijk?list=PLabc', True),
    ('https://youtu.be/abcdefghijk', False),
    ('lofi beats', False),
])
async def test_play_routes_playlists_and_songs(monkeypatch, query, is_playlist):
    interaction = Mock(user=Mock(id=42), response=Mock(defer=AsyncMock()))
    tracks = [audio.Track('First', 'a', 10, 42), audio.Track('Second', 'b', 20, 42)]
    lookup = AsyncMock(return_value=tracks)
    enqueue = AsyncMock()
    enqueue_many = AsyncMock()
    monkeypatch.setattr(bot_module, 'listener_channel', Mock())
    monkeypatch.setattr(bot_module.bot.youtube, 'search', lookup)
    monkeypatch.setattr(bot_module.bot, 'enqueue', enqueue)
    monkeypatch.setattr(bot_module.bot, 'enqueue_many', enqueue_many)
    monkeypatch.setenv('MAX_QUEUE', '25')
    await bot_module.play.callback(interaction, query)
    if is_playlist:
        lookup.assert_awaited_once_with(query, 42, 25, playlist=True)
        enqueue_many.assert_awaited_once_with(interaction, tracks, playlist_limit=25)
        enqueue.assert_not_awaited()
    else:
        lookup.assert_awaited_once_with(query, 42)
        enqueue.assert_awaited_once_with(interaction, tracks[0])
        enqueue_many.assert_not_awaited()


async def test_playlist_enqueue_reports_partial_batch_and_checks_voice_channel(monkeypatch):
    client = bot_module.Waffle()
    channel = Mock()
    interaction = Mock(guild=Mock(id=123), followup=Mock(send=AsyncMock()))
    player = Mock(closed=False, voice=Mock(channel=channel), add_many=Mock(return_value=1))
    client.players[123] = player
    tracks = [audio.Track('First', 'a', 10, 42), audio.Track('Second', 'b', 20, 42)]
    monkeypatch.setattr(bot_module, 'listener_channel', Mock(return_value=channel))
    await client.enqueue_many(interaction, tracks, playlist_limit=100)
    player.add_many.assert_called_once_with(tracks)
    message = interaction.followup.send.call_args.args[0]
    assert '1 songs' in message
    assert '1 additional songs did not fit' in message
    player.add_many.reset_mock()
    player.voice.channel = Mock()
    with pytest.raises(ValueError, match='Join my voice channel'):
        await client.enqueue_many(interaction, tracks, playlist_limit=100)
    player.add_many.assert_not_called()


def test_startup_uses_only_root_logging_handler(monkeypatch):
    monkeypatch.setattr(bot_module, 'load_dotenv', Mock())
    monkeypatch.setattr(bot_module, 'check_ytdlp_version', Mock())
    monkeypatch.setattr(bot_module.shutil, 'which', Mock(return_value='/bin/tool'))
    monkeypatch.setenv('DISCORD_TOKEN', 'test-token')
    monkeypatch.setenv('IDLE_TIMEOUT', '180')
    monkeypatch.setenv('MAX_QUEUE', '100')
    login = Mock()
    monkeypatch.setattr(bot_module.bot, 'run', login)
    bot_module.main()
    login.assert_called_once_with('test-token', log_handler=None)
