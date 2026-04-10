from __future__ import annotations

import subprocess

import psutil


def _collect_cuda_metrics() -> dict[str, object] | None:
    result: dict[str, object] = {
        "gpu_backend": "cuda",
        "gpu_device": "cuda:0",
        "gpu_name": None,
        "gpu_used_bytes": 0,
        "gpu_total_bytes": 0,
        "gpu_reserved_bytes": 0,
        "gpu_peak_bytes": 0,
        "gpu_utilization_percent": None,
        "gpu_temperature_c": None,
    }

    try:
        import torch

        if not torch.cuda.is_available():
            return None

        device_index = torch.cuda.current_device()
        props = torch.cuda.get_device_properties(device_index)
        result["gpu_device"] = f"cuda:{device_index}"
        result["gpu_name"] = props.name
        result["gpu_used_bytes"] = int(torch.cuda.memory_allocated(device_index))
        result["gpu_reserved_bytes"] = int(torch.cuda.memory_reserved(device_index))
        result["gpu_peak_bytes"] = int(torch.cuda.max_memory_allocated(device_index))
        result["gpu_total_bytes"] = int(props.total_memory)
    except Exception:
        return None

    try:
        nvidia_smi = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        first_line = nvidia_smi.stdout.strip().splitlines()[0]
        name, memory_used, memory_total, utilization, temperature = [
            part.strip() for part in first_line.split(",")
        ]
        result["gpu_name"] = name or result["gpu_name"]
        result["gpu_used_bytes"] = int(float(memory_used) * 1024 * 1024)
        result["gpu_total_bytes"] = int(float(memory_total) * 1024 * 1024)
        result["gpu_utilization_percent"] = float(utilization)
        result["gpu_temperature_c"] = float(temperature)
    except Exception:
        pass

    return result


def _collect_mlx_metrics() -> dict[str, object] | None:
    try:
        import mlx.core as mx

        active = int(mx.metal.get_active_memory())
        peak = int(mx.metal.get_peak_memory())
        cache = int(mx.metal.get_cache_memory())
    except Exception:
        return None

    return {
        "gpu_backend": "mlx",
        "gpu_device": "mlx",
        "gpu_name": "Apple Silicon GPU",
        "gpu_used_bytes": active,
        "gpu_total_bytes": 0,
        "gpu_reserved_bytes": cache,
        "gpu_peak_bytes": peak,
        "gpu_utilization_percent": None,
        "gpu_temperature_c": None,
        "mlx_gpu_active_bytes": active,
        "mlx_gpu_peak_bytes": peak,
        "mlx_gpu_cache_bytes": cache,
    }


def collect_metrics() -> dict:
    cpu_percent = psutil.cpu_percent(interval=None)
    vm = psutil.virtual_memory()

    base = {
        "cpu_percent": cpu_percent,
        "ram_used_bytes": vm.used,
        "ram_total_bytes": vm.total,
        "ram_percent": vm.percent,
        "gpu_backend": "none",
        "gpu_device": None,
        "gpu_name": None,
        "gpu_used_bytes": 0,
        "gpu_total_bytes": 0,
        "gpu_reserved_bytes": 0,
        "gpu_peak_bytes": 0,
        "gpu_utilization_percent": None,
        "gpu_temperature_c": None,
        "mlx_gpu_active_bytes": 0,
        "mlx_gpu_peak_bytes": 0,
        "mlx_gpu_cache_bytes": 0,
    }

    cuda_metrics = _collect_cuda_metrics()
    if cuda_metrics is not None:
        base.update(cuda_metrics)
        return base

    mlx_metrics = _collect_mlx_metrics()
    if mlx_metrics is not None:
        base.update(mlx_metrics)
        return base

    return base
