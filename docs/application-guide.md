# Application Guide

Football Bot publishes information cards for football matches. The organizer uses the Mini App to choose an exact date/time, an active venue, and an optional price. The bot sends a static card to Telegram and can update or delete that same message.

The bot does not create polls, record players, show rosters, manage match lifecycle, or store history. Use Telegram's native poll interface when a poll is needed.

The Mini App contains **Matches** and **Venues**. Its global weather action sends the current Minsk weather to the configured Telegram topic without linking the message to a match or applying a daily limit.

For commands and local setup, see [Development](development.md). For runtime behavior, see [Architecture](architecture.md). For the authorized production migration sequence, see [Railway](railway.md).
