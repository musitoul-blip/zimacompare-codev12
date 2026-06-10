"""tagaudit/core/state_manager.py - SHIM (v9).
Adapte les appels state_manager.* du BackgroundScanner ZimaTAG vers le moteur
d'etat unique de ZimaCompare (config.update_state / app_state). Aucun etat
parallele, aucun PID-lock : le verrou reel est l'app_state, pose par
tagscan.start_tag_scan() avant le lancement.
"""
from config import AppState, get_state, update_state  # /app/config.py (ZimaCompare)

def acquire_lock() -> bool:
    return True

def release_lock() -> None:
    return None

_STATUS = {"running": AppState.SCANNING, "completed": AppState.IDLE,
           "paused": AppState.IDLE, "error": AppState.ERROR}

FMT = {"total_mp3": 0, "total_flac": 0, "total_m4a": 0,
       "done_mp3": 0, "done_flac": 0, "done_m4a": 0}


def fmt_counts() -> dict:
    return dict(FMT)


def update(**kw) -> None:
    for _k in ("total_mp3", "total_flac", "total_m4a", "done_mp3", "done_flac", "done_m4a"):
        if _k in kw:
            FMT[_k] = kw[_k]
    out = {}
    if "status" in kw:
        out["app_state"] = _STATUS.get(kw["status"], AppState.SCANNING)
        if kw["status"] == "completed":
            out.update(scan_done=True, progress=100, current_file="", fps=0, eta_seconds=0)
        elif kw["status"] == "error":
            out["error"] = kw.get("last_error", "") or "erreur scan-tag"
        elif kw["status"] == "paused":
            out["current_file"] = "Annule"
    if "total_files" in kw:
        out["total"] = kw["total_files"]
    if "processed_files" in kw:
        out["processed"] = kw["processed_files"]
    if "current_file" in kw:
        out["current_file"] = kw["current_file"]
    if "speed" in kw:
        out["fps"] = round(kw["speed"], 1)
    if "eta_seconds" in kw:
        out["eta_seconds"] = kw["eta_seconds"]
    if "progress" not in out:
        st = get_state()
        tot = out.get("total", st.get("total") or 0)
        proc = out.get("processed", st.get("processed") or 0)
        if tot:
            out["progress"] = int(proc * 100 / tot)
    if out:
        update_state(**out)
