"""torch_login — branded client login via Casdoor (OAuth2 auth-code + PKCE).

Registers `hermes torch <login|status|logout>`. Ships as a plugin so it adds
no footprint to Hermes core. Enable via `plugins.enabled` in config.yaml.
"""

from __future__ import annotations

import logging

from plugins.torch_login.cli import register_cli as _register_cli
from plugins.torch_login.cli import torch_command as _torch_command

logger = logging.getLogger(__name__)


def register(ctx) -> None:
    ctx.register_cli_command(
        name="torch",
        help="Branded client account (login/status/logout via Casdoor)",
        setup_fn=_register_cli,
        handler_fn=_torch_command,
        description=(
            "Sign in to the branded client through the browser (Casdoor "
            "OAuth2 + PKCE). See: hermes torch login"
        ),
    )
    logger.debug("torch_login plugin registered CLI command 'torch'")
