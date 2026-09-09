from unittest.mock import Mock

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
