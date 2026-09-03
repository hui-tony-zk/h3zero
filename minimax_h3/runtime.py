"""Pinned GPU runtime metadata and startup compatibility checks."""

from __future__ import annotations

from collections.abc import Iterable
from importlib.metadata import version

PYTORCH_VERSION = "2.11.0+cu130"
TORCHVISION_VERSION = "0.26.0+cu130"
TORCHAUDIO_VERSION = "2.11.0+cu130"
PYTORCH_CUDA_INDEX = "https://download.pytorch.org/whl/cu130"
EXPECTED_CUDA_VERSION = (13, 0)
EXPECTED_GPU_CAPABILITY = (12, 0)

ATTENTION_BACKEND = "comfy_kitchen"
COMFY_KITCHEN_VERSION = "0.2.31"
SPARSE_ATTENTION_IMPLEMENTATION = "h3_optimizations"
SPARSE_ATTENTION_VERSION = "0.2.41"
SPARSE_ATTENTION_VIDEO_BUDGET = 0.30
SPARSE_ATTENTION_VIDEO_BUDGETS = (0.30, 0.15, 0.10)
SPARSE_ATTENTION_DENSER_EARLY = True


def _version_pair(raw: str | None) -> tuple[int, int] | None:
    if not raw:
        return None
    try:
        major, minor, *_ = raw.split(".")
        return int(major), int(minor)
    except (TypeError, ValueError):
        return None


def cuda_compatibility_error(
    *,
    cuda_version: str | None,
    capability: tuple[int, int],
    arch_list: Iterable[str],
) -> str | None:
    """Return a user-facing incompatibility message, or ``None`` when valid."""
    parsed_cuda = _version_pair(cuda_version)
    if parsed_cuda != EXPECTED_CUDA_VERSION:
        return (
            f"PyTorch was built for CUDA {cuda_version or 'unknown'}, but this "
            "RTX PRO 6000 image requires the pinned CUDA 13.0 build. Rebuild the "
            "Modal app with `npm run deploy`."
        )
    if capability != EXPECTED_GPU_CAPABILITY:
        return (
            f"Expected an RTX PRO 6000 Blackwell GPU (sm_120), but CUDA reported "
            f"sm_{capability[0]}{capability[1]}."
        )
    supported = set(arch_list)
    if supported and not ({"sm_120", "compute_120"} & supported):
        return (
            "The installed PyTorch wheel does not contain sm_120 support. "
            f"Reported architectures: {sorted(supported)}. Rebuild the Modal app "
            "with the pinned cu130 wheel."
        )
    return None


def verify_gpu_runtime() -> dict:
    """Probe CUDA and Comfy Kitchen before the large H3 models are loaded."""
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable in the H3 GPU worker")
    capability = tuple(torch.cuda.get_device_capability())
    error = cuda_compatibility_error(
        cuda_version=torch.version.cuda,
        capability=capability,
        arch_list=torch.cuda.get_arch_list(),
    )
    if error:
        raise RuntimeError(error)

    try:
        import comfy_kitchen

        installed_version = version("comfy-kitchen")
        if installed_version != COMFY_KITCHEN_VERSION:
            raise RuntimeError(
                f"expected comfy-kitchen {COMFY_KITCHEN_VERSION}, got {installed_version}"
            )
        if not comfy_kitchen.int8_attention_is_available():
            raise RuntimeError("the INT8 attention kernel is unavailable")
        q = torch.zeros((1, 2, 128, 64), device="cuda", dtype=torch.bfloat16)
        result = comfy_kitchen.int8_attention(q, q, q)
        if result.shape != q.shape:
            raise RuntimeError(f"unexpected output shape {tuple(result.shape)}")
        torch.cuda.synchronize()
    except Exception as exc:
        raise RuntimeError(
            "The pinned Comfy Kitchen INT8 attention kernel failed its startup probe: "
            f"{exc}"
        ) from exc

    return {
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "gpu": torch.cuda.get_device_name(),
        "capability": f"sm_{capability[0]}{capability[1]}",
        "attention": f"comfy-kitchen-{COMFY_KITCHEN_VERSION}",
    }
