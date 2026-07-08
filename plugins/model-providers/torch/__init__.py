"""Torch — branded provider profile.

base_url points at the (future) metering proxy on the brand's server. The URL
is intentionally fixed here as the source-of-truth endpoint; the runtime lock
lives in the client fork (see 二次开发实施清单.md, M2). Override for local dev
via ``TORCH_INFERENCE_BASE_URL``.
"""

import os

from providers import register_provider
from providers.base import ProviderProfile

_BASE_URL = os.getenv("TORCH_INFERENCE_BASE_URL", "https://api.torchai.cn/v1")

torch = ProviderProfile(
    name="torch",
    aliases=("yi-one", "torch-plan"),
    env_vars=("TORCH_API_KEY",),
    display_name="Torch",
    description="Torch — branded metered inference",
    signup_url="https://torchai.ai",
    fallback_models=(),
    base_url=_BASE_URL,
    auth_type="api_key",
)

register_provider(torch)
