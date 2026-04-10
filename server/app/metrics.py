from __future__ import annotations

import psutil


def collect_metrics() -> dict:
    cpu_percent = psutil.cpu_percent(interval=None)
    vm = psutil.virtual_memory()

    mlx_active = 0
    mlx_peak = 0
    mlx_cache = 0
    try:
        import mlx.core as mx

        mlx_active = mx.metal.get_active_memory()
        mlx_peak = mx.metal.get_peak_memory()
        mlx_cache = mx.metal.get_cache_memory()
    except Exception:
        pass

    return {
        "cpu_percent": cpu_percent,
        "ram_used_bytes": vm.used,
        "ram_total_bytes": vm.total,
        "ram_percent": vm.percent,
        "mlx_gpu_active_bytes": mlx_active,
        "mlx_gpu_peak_bytes": mlx_peak,
        "mlx_gpu_cache_bytes": mlx_cache,
    }
