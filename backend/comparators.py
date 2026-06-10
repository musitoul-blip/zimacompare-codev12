"""ZimaCompare v3.5 - Comparateurs (3 niveaux) + cache de hash persistant.

Empreinte partielle (niveau « fast ») : échantillonnage de 3 tranches de
32 Kio — début, milieu, fin du fichier — mélangées avec la taille.

Pourquoi 3 tranches et pas seulement le début (cas des fichiers audio) :
les premiers Kio d'un FLAC/MP3/M4A contiennent surtout l'en-tête, les tags
et la pochette intégrée — pas le flux audio. Une empreinte du seul début ne
« voit » donc jamais la musique : un fichier au son corrompu ou tronqué mais
de même taille passerait pour identique. Échantillonner aussi le milieu (cœur
du flux audio) et la fin (détection des troncatures) rend le contrôle « fast »
nettement plus pertinent pour une bibliothèque musicale.

Limite assumée : l'échantillonnage ne lit pas tout le fichier — une corruption
ponctuelle tombant entre deux tranches peut échapper. Pour une garantie totale,
utiliser le niveau « secure » (empreinte du fichier entier).

Cache disque (path → size, mtime, hash, méthode) : rescan ultra-rapide si
rien n'a bougé. Le champ de méthode (_HASH_METHOD) invalide automatiquement
les empreintes calculées par une version antérieure.

T6 (2026-06-05) — Timeout de lecture par fichier
-------------------------------------------------
Lire le contenu d'un fichier cible CORROMPU via FUSE (pCloud) peut FIGER la
lecture indéfiniment : pCloud ne sert ni octets ni erreur franche (cf. mémo,
constat « Willy William — Une Seule Vie »). Un scan `fast`/`secure` complet
pouvait alors rester bloqué sur un seul fichier.

Parade : chaque calcul d'empreinte qui lit le disque (`_partial_compute`,
`hash_full_xxh128`) est exécuté dans un thread démon ; au-delà d'un délai on
abandonne ce thread et on renvoie "error" — que compare_fast/compare_secure
traduisent en `target_unreadable` (B6) → kind `read_error`. Le scan CONTINUE.
Une lecture FUSE figée n'étant pas interruptible par signal dans un thread
worker, l'abandon du thread est la seule parade fiable et légère ; le thread
abandonné (borné par le nb de fichiers corrompus) reste bloqué sur read() mais,
étant démon, n'empêche pas l'arrêt du process.

Deux délais distincts pour ne pas tuer un gros fichier cloud légitimement lent :
  - READ_TIMEOUT_SECONDS       : empreinte PARTIELLE (96 Kio max) — court.
  - READ_TIMEOUT_FULL_SECONDS  : empreinte COMPLÈTE (tout le fichier) — large.
Surchargeables par variables d'env ZIMA_READ_TIMEOUT / ZIMA_READ_TIMEOUT_FULL.
Mettre un délai <= 0 désactive la garde (lecture directe, ancien comportement).
"""
import json
import os
import threading
import xxhash
from pathlib import Path
from typing import Tuple

_HASH_CACHE: dict = {}
_HASH_CACHE_LOCK = threading.Lock()

# Empreinte partielle « fast » : 3 tranches de 32 Kio (début / milieu / fin).
_SLICE_BYTES = 32 * 1024
_PARTIAL_TOTAL = _SLICE_BYTES * 3        # 96 Kio lus au maximum par fichier

# Marqueur de méthode d'empreinte. Toute entrée de cache dont le marqueur
# diffère est considérée périmée et recalculée. Incrémenter ce nom à chaque
# changement de l'algorithme de _partial_compute.
#   v1 (implicite, ancien) : 64 Kio de début uniquement
#   "p3s32"                : 3 tranches de 32 Kio (début/milieu/fin) — actuel
_HASH_METHOD = "p3s32"

# ─────────────────────────────────────────────────────────────────────────
#  T6 — Garde de timeout sur les lectures de fichier.
# ─────────────────────────────────────────────────────────────────────────
def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default

# Délai pour une empreinte PARTIELLE (96 Kio max) : un fichier sain revient en
# bien moins d'une seconde ; seul un gel FUSE atteint ce plafond.
READ_TIMEOUT_SECONDS = _env_float("ZIMA_READ_TIMEOUT", 30.0)
# Délai pour une empreinte COMPLÈTE (tout le fichier) : large, pour ne pas tuer
# un gros fichier cloud légitimement lent. Un fichier figé l'atteindra quand même.
READ_TIMEOUT_FULL_SECONDS = _env_float("ZIMA_READ_TIMEOUT_FULL", 300.0)


def _read_with_timeout(fn, timeout: float) -> str:
    """Exécute `fn` (une lecture de fichier renvoyant une str d'empreinte) dans
    un thread démon. Renvoie son résultat, ou "error" si `timeout` est dépassé —
    auquel cas le thread est ABANDONNÉ (il peut rester bloqué sur une lecture
    FUSE figée ; étant démon, il n'empêche pas l'arrêt du process).
    timeout <= 0 : exécution directe sans garde (ancien comportement)."""
    if not timeout or timeout <= 0:
        return fn()
    box = {"v": "error"}
    done = threading.Event()

    def _worker():
        try:
            box["v"] = fn()
        except Exception:
            box["v"] = "error"
        finally:
            done.set()

    threading.Thread(target=_worker, daemon=True).start()
    if not done.wait(timeout):
        return "error"      # lecture figée : on abandonne, le scan continue
    return box["v"]


def hash_cache_load():
    global _HASH_CACHE
    from config import HASH_CACHE_FILE
    if HASH_CACHE_FILE.exists():
        try:
            with open(HASH_CACHE_FILE) as f:
                _HASH_CACHE = json.load(f) or {}
        except Exception:
            _HASH_CACHE = {}
    else:
        _HASH_CACHE = {}


def hash_cache_save():
    from config import HASH_CACHE_FILE
    with _HASH_CACHE_LOCK: snap = dict(_HASH_CACHE)
    try:
        HASH_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = HASH_CACHE_FILE.with_suffix(".tmp")
        with open(tmp, "w") as f: json.dump(snap, f)
        tmp.replace(HASH_CACHE_FILE)
    except Exception: pass


def hash_cache_stats() -> dict:
    with _HASH_CACHE_LOCK: return {"entries": len(_HASH_CACHE)}


def hash_cache_clear():
    global _HASH_CACHE
    with _HASH_CACHE_LOCK: _HASH_CACHE = {}


def _partial_compute_raw(filepath: Path, size: int) -> str:
    """Empreinte partielle d'un fichier : 3 tranches de 32 Kio (début, milieu,
    fin) mélangées avec la taille.

    - Fichier <= 96 Kio : les tranches couvrent (avec recouvrement) tout le
      fichier — l'empreinte porte alors sur le contenu intégral.
    - Fichier > 96 Kio : 3 fenêtres de 32 Kio, positionnées au début, au
      centre exact et à la fin.

    NB (T6) : cette fonction fait les lectures réelles ; elle est appelée sous
    garde de timeout via _partial_compute(). Ne pas l'appeler directement sur
    une cible potentiellement figée.
    """
    if size == 0:
        return "empty"
    try:
        h = xxhash.xxh64()
        with open(filepath, "rb") as f:
            if size <= _PARTIAL_TOTAL:
                # Petit fichier : on lit tout (les 3 tranches le couvriraient
                # de toute façon en se recouvrant).
                h.update(f.read())
            else:
                # Tranche 1 — début.
                h.update(f.read(_SLICE_BYTES))
                # Tranche 2 — milieu, centrée sur le fichier.
                mid = (size - _SLICE_BYTES) // 2
                f.seek(mid)
                h.update(f.read(_SLICE_BYTES))
                # Tranche 3 — fin.
                f.seek(size - _SLICE_BYTES)
                h.update(f.read(_SLICE_BYTES))
        # La taille fait partie intégrante de l'empreinte.
        h.update(size.to_bytes(8, "little", signed=False))
        return h.hexdigest()
    except Exception:
        return "error"


def _partial_compute(filepath: Path, size: int) -> str:
    """Empreinte partielle SOUS GARDE DE TIMEOUT (T6). Délègue à
    _partial_compute_raw dans un thread démon ; renvoie "error" si la lecture
    dépasse READ_TIMEOUT_SECONDS (cible FUSE figée) au lieu de bloquer."""
    return _read_with_timeout(lambda: _partial_compute_raw(filepath, size),
                              READ_TIMEOUT_SECONDS)


def _partial_cached(filepath: Path, size: int, mtime: float) -> str:
    """Empreinte partielle avec cache. Une entrée de cache n'est réutilisée
    que si la taille, la date ET le marqueur de méthode correspondent — ce
    qui invalide proprement les empreintes d'une version antérieure."""
    key = str(filepath)
    with _HASH_CACHE_LOCK:
        c = _HASH_CACHE.get(key)
    if (c and c.get("size") == size
            and abs(c.get("mtime", 0) - mtime) < 1.0
            and c.get("m") == _HASH_METHOD):
        return c["hash"]
    h = _partial_compute(filepath, size)
    if h not in ("error", "empty"):
        with _HASH_CACHE_LOCK:
            _HASH_CACHE[key] = {"size": size, "mtime": mtime,
                                "hash": h, "m": _HASH_METHOD}
    return h


def _hash_full_xxh128_raw(filepath: Path, chunk_mb: int = 4) -> str:
    """Lecture réelle pour l'empreinte complète xxh128. Appelée sous garde de
    timeout via hash_full_xxh128() (T6)."""
    chunk = max(1, min(chunk_mb, 4)) * 1024 * 1024
    try:
        h = xxhash.xxh128()
        with open(filepath, "rb") as f:
            while data := f.read(chunk):
                h.update(data)
        return h.hexdigest()
    except Exception: return "error"


def hash_full_xxh128(filepath: Path, chunk_mb: int = 4) -> str:
    """Empreinte complète xxh128 SOUS GARDE DE TIMEOUT (T6). Délai plus large
    que la partielle (READ_TIMEOUT_FULL_SECONDS) car on lit tout le fichier ;
    un fichier cible figé via FUSE bascule en "error" au lieu de bloquer."""
    return _read_with_timeout(lambda: _hash_full_xxh128_raw(filepath, chunk_mb),
                              READ_TIMEOUT_FULL_SECONDS)


def hash_full_xxh128_retry(filepath: Path, chunk_mb: int = 4,
                            attempts: int = 3) -> tuple:
    """Empreinte complète xxh128 avec tentatives multiples.

    Une lecture à travers un montage réseau/cloud (pCloud) peut échouer
    ponctuellement. On réessaie jusqu'à `attempts` fois avant de conclure
    à un échec définitif.

    Retourne (hash, n_tentatives_utilisées). hash == 'error' si tous les
    essais ont échoué.

    NB (T6) : chaque tentative passe désormais par hash_full_xxh128() (sous
    garde de timeout) — une lecture figée ne bloque plus indéfiniment. Sur un
    fichier durablement figé, le coût cumulé reste attempts × délai ; le
    chemin de scan (compare_secure) n'utilise PAS cette fonction.
    """
    import time as _t
    attempts = max(1, attempts)
    last = "error"
    for i in range(1, attempts + 1):
        h = hash_full_xxh128(filepath, chunk_mb)
        if h != "error":
            return h, i
        last = h
        if i < attempts:
            _t.sleep(0.5 * i)   # petite pause croissante avant de réessayer
    return last, attempts


def compare_ultra_fast(src_size: int, tgt_size: int) -> Tuple[str, str, str, str]:
    if src_size != tgt_size:
        return "different", "size_mismatch", "", ""
    return "identical", "", "", ""


def compare_fast(src: Path, tgt: Path,
                 src_size: int, tgt_size: int,
                 src_mtime: float, tgt_mtime: float) -> Tuple[str, str, str, str]:
    if src_size != tgt_size:
        return "different", "size_mismatch", "", ""
    sh = _partial_cached(src, src_size, src_mtime)
    th = _partial_cached(tgt, tgt_size, tgt_mtime)
    if sh == th: return "identical", "", sh, th
    if sh == "error" or th == "error":
        reason = "source_unreadable" if sh == "error" else "target_unreadable"
        return "different", reason, sh, th
    return "different", "hash_mismatch", sh, th


def compare_secure(src: Path, tgt: Path,
                   src_size: int, tgt_size: int,
                   chunk_mb: int = 4) -> Tuple[str, str, str, str]:
    if src_size != tgt_size:
        return "different", "size_mismatch", "", ""
    sh = hash_full_xxh128(src, chunk_mb)
    th = hash_full_xxh128(tgt, chunk_mb)
    if sh == th: return "identical", "", sh, th
    if sh == "error" or th == "error":
        reason = "source_unreadable" if sh == "error" else "target_unreadable"
        return "different", reason, sh, th
    return "different", "hash_mismatch", sh, th


def compare_files(src: Path, tgt: Path,
                  src_size: int, tgt_size: int,
                  src_mtime: float, tgt_mtime: float,
                  method: str, chunk_mb: int = 4) -> Tuple[str, str, str, str]:
    if method == "ultra_fast":
        return compare_ultra_fast(src_size, tgt_size)
    elif method == "fast":
        return compare_fast(src, tgt, src_size, tgt_size, src_mtime, tgt_mtime)
    else:
        return compare_secure(src, tgt, src_size, tgt_size, chunk_mb)


def verify_copy(src: Path, tgt: Path) -> bool:
    try:
        if not tgt.exists(): return False
        ss = src.stat().st_size
        ts = tgt.stat().st_size
        if ss != ts: return False
        return _partial_compute(src, ss) == _partial_compute(tgt, ts)
    except Exception: return False


def get_file_info(p: Path) -> Tuple[int, float]:
    try:
        s = p.stat()
        return s.st_size, s.st_mtime
    except Exception:
        return 0, 0.0


# ─────────────────────────────────────────────────────────────────────────
#  T5 — Empreinte SHA1 complète (source locale) + cache dédié.
#  Sert à comparer la source locale aux empreintes SHA1 servies par pCloud
#  (operations/list showHash) — donc SANS lire le contenu cible.
#  NB : ces lectures portent sur la SOURCE LOCALE → pas de risque de gel FUSE,
#  donc pas de garde T6 ici (la cible n'est jamais lue dans ce mode).
# ─────────────────────────────────────────────────────────────────────────
_SHA1_CACHE: dict = {}
_SHA1_CACHE_LOCK = threading.Lock()


def _sha1_cache_file():
    from config import HASH_CACHE_FILE
    return HASH_CACHE_FILE.with_name("hash_cache_sha1.json")


def sha1_cache_load():
    global _SHA1_CACHE
    f = _sha1_cache_file()
    if f.exists():
        try:
            with open(f) as fh:
                _SHA1_CACHE = json.load(fh) or {}
        except Exception:
            _SHA1_CACHE = {}
    else:
        _SHA1_CACHE = {}


def sha1_cache_save():
    f = _sha1_cache_file()
    with _SHA1_CACHE_LOCK:
        snap = dict(_SHA1_CACHE)
    try:
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".tmp")
        with open(tmp, "w") as fh:
            json.dump(snap, fh)
        tmp.replace(f)
    except Exception:
        pass


def sha1_cache_stats() -> dict:
    with _SHA1_CACHE_LOCK:
        return {"entries": len(_SHA1_CACHE)}


def hash_full_sha1(filepath: Path, chunk_mb: int = 4) -> str:
    """SHA1 complète d'un fichier local, en streaming."""
    import hashlib
    chunk = max(1, min(chunk_mb, 8)) * 1024 * 1024
    try:
        h = hashlib.sha1()
        with open(filepath, "rb") as f:
            while data := f.read(chunk):
                h.update(data)
        return h.hexdigest()
    except Exception:
        return "error"


def sha1_cached(filepath: Path, size: int, mtime: float,
                chunk_mb: int = 4) -> str:
    """SHA1 complète avec cache (clé=chemin, validée par taille+mtime)."""
    key = str(filepath)
    with _SHA1_CACHE_LOCK:
        c = _SHA1_CACHE.get(key)
    if c and c.get("size") == size and abs(c.get("mtime", 0) - mtime) < 1.0:
        return c["hash"]
    h = hash_full_sha1(filepath, chunk_mb)
    if h != "error":
        with _SHA1_CACHE_LOCK:
            _SHA1_CACHE[key] = {"size": size, "mtime": mtime, "hash": h}
    return h


def compare_cloud(src: Path, rel: str, src_size: int, tgt_size: int,
                  src_mtime: float, target_hashes: dict,
                  chunk_mb: int = 4) -> Tuple[str, str, str, str]:
    """T5 — Comparaison via empreinte serveur pCloud : SHA1 de la SOURCE
    (locale, en cache) contre le SHA1 fourni par pCloud (sans téléchargement).
    `target_hashes` : dict {rel: sha1} pré-rempli par fetch_remote_hashes."""
    if src_size != tgt_size:
        return "different", "size_mismatch", "", ""
    th = (target_hashes.get(rel) or "").strip()
    sh = sha1_cached(src, src_size, src_mtime, chunk_mb)
    if not th or th == "error":
        return "different", "target_missing_hash", sh, "error"
    if sh == "error":
        return "different", "source_unreadable", "error", th
    if sh == th:
        return "identical", "", sh, th
    return "different", "hash_mismatch", sh, th
