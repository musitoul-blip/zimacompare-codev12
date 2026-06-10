"""ZimaCompare v3 — mountcheck.py

Surveillance du montage de la cible pendant la synchronisation.

PROBLÈME RÉSOLU
---------------
La cible peut être un montage fragile : rclone/FUSE (pCloud) ou CIFS/NFS.
Si ce montage décroche EN COURS DE SYNC, le point de montage continue
d'exister comme dossier LOCAL vide. shutil/copy écrit alors silencieusement
sur le disque local de la ZimaBoard au lieu de la vraie destination —
et verify_copy() relit le fichier au même endroit local, donc la
vérification passe (faux positif). Aucune erreur n'est signalée.

run_preflight() ne vérifie qu'AU DÉMARRAGE. Ce module ajoute une
vérification CONTINUE, à appeler avant chaque fichier.

PRINCIPE
--------
1. arm() capture l'état de référence de la cible :
   - device id (st_dev)  → identifie le filesystem sous le chemin
   - type de FS via /proc/mounts
   - dépose une sentinelle (fichier témoin) sur la cible
2. check() — quasi gratuit, à appeler avant chaque fichier :
   - relit le device id (servi par le cache du kernel, ~microsecondes)
   - si le device id a changé → le montage est tombé → lève MountLost
   - tous les N appels, vérifie aussi la présence physique de la sentinelle
3. disarm() retire la sentinelle.

INTÉGRATION (voir syncer.py patché) :
    guard = MountGuard(target)
    guard.arm()                      # après run_preflight, avant la boucle
    try:
        for action in actions:
            guard.check()            # avant chaque _exec_action d'écriture
            ...
    finally:
        guard.disarm()
"""
import logging
import os
import time
import uuid
from typing import Optional

logger = logging.getLogger("zimacompare")

# FS considérés comme "le montage a disparu" (dossier local conteneur)
VIRTUAL_FS = ("overlay", "overlay2", "tmpfs", "aufs", "devtmpfs", "ramfs")

SENTINEL_PREFIX = ".zima_mount_sentinel_"


class MountLost(RuntimeError):
    """Levée quand la cible n'est plus correctement montée."""
    pass


def _fs_type(path: str) -> str:
    """Type de filesystem d'un chemin, lu depuis /proc/mounts. '' si inconnu."""
    try:
        real = os.path.realpath(path)
        best_mp = ""
        best_fs = ""
        with open("/proc/mounts", "r") as f:
            for line in f:
                parts = line.split()
                if len(parts) < 3:
                    continue
                mp, fstype = parts[1], parts[2]
                # mountpoint le plus long qui préfixe le chemin réel
                if real == mp or real.startswith(mp.rstrip("/") + "/"):
                    if len(mp) >= len(best_mp):
                        best_mp, best_fs = mp, fstype
        return best_fs
    except Exception:
        return ""


def precheck_target(target: str, *, expect_network: bool = False) -> Optional[str]:
    """
    Contrôle statique de la cible AVANT d'armer le guard.
    Retourne None si OK, sinon un message d'erreur.

    À utiliser en complément de run_preflight().
    """
    if not os.path.isdir(target):
        return f"Cible introuvable ou pas un dossier : {target}"

    fs = _fs_type(target)
    if fs in VIRTUAL_FS:
        return (f"Cible sur filesystem '{fs}' (dossier local du conteneur) — "
                f"le volume/montage cible n'est PAS monté : {target}")

    if expect_network and fs and fs in ("ext4", "ext3", "xfs", "btrfs", "vfat"):
        # Pas bloquant, juste un avertissement loggué
        logger.warning(f"[GUARD] Cible attendue réseau mais FS local '{fs}' : {target}")

    return None


class MountGuard:
    """Surveille qu'une cible reste montée pendant toute la sync."""

    def __init__(
        self,
        target: str,
        *,
        sentinel_check_every: int = 50,
    ):
        self.target = os.path.abspath(target)
        self.sentinel_check_every = max(1, sentinel_check_every)

        self._sentinel_name = f"{SENTINEL_PREFIX}{uuid.uuid4().hex[:12]}"
        self._sentinel_path = os.path.join(self.target, self._sentinel_name)

        self._armed = False
        self._ref_dev: Optional[int] = None
        self._ref_fs: str = ""
        self._n_checks = 0

    # ── armement ────────────────────────────────────────────────────────
    def arm(self):
        """Capture l'état de référence et dépose la sentinelle.
        Lève MountLost si la cible est déjà dans un état invalide."""
        if not os.path.isdir(self.target):
            raise MountLost(f"Cible introuvable : {self.target}")

        try:
            self._ref_dev = os.stat(self.target).st_dev
        except OSError as e:
            raise MountLost(f"stat() impossible sur la cible : {e}")

        self._ref_fs = _fs_type(self.target)
        if self._ref_fs in VIRTUAL_FS:
            raise MountLost(
                f"Cible sur FS '{self._ref_fs}' (local conteneur) — "
                f"le montage n'est pas actif : {self.target}"
            )

        try:
            with open(self._sentinel_path, "w", encoding="utf-8") as f:
                f.write(f"zimacompare sentinel pid={os.getpid()} "
                        f"ts={time.time()} dev={self._ref_dev}\n")
                f.flush()
                os.fsync(f.fileno())
        except OSError as e:
            raise MountLost(
                f"Impossible de déposer la sentinelle (cible non inscriptible ?) : {e}"
            )

        self._armed = True
        logger.info(
            f"[GUARD] Armé — cible={self.target} dev={self._ref_dev} "
            f"fs={self._ref_fs or '?'} — vérification avant chaque fichier."
        )

    # ── vérification ────────────────────────────────────────────────────
    def check(self):
        """À appeler AVANT chaque écriture. Lève MountLost si le montage
        a disparu. Coût : un os.stat() servi par le cache kernel."""
        if not self._armed:
            return
        self._n_checks += 1

        # 1. device id — quasi gratuit, change dès que le montage tombe
        try:
            dev = os.stat(self.target).st_dev
        except OSError as e:
            raise MountLost(f"La cible n'est plus accessible (stat: {e})")

        if dev != self._ref_dev:
            raise MountLost(
                f"Le filesystem de la cible a changé "
                f"(device {self._ref_dev} → {dev}) — le montage a décroché ; "
                f"le dossier visible est maintenant le disque LOCAL"
            )

        # 2. sentinelle physique — périodique (ceinture + bretelles)
        if self._n_checks % self.sentinel_check_every == 1:
            if not os.path.exists(self._sentinel_path):
                raise MountLost(
                    "La sentinelle a disparu de la cible — "
                    "le montage n'est plus actif"
                )

    # ── désarmement ─────────────────────────────────────────────────────
    def disarm(self):
        """Retire la sentinelle. Sûr à appeler même si jamais armé."""
        self._armed = False
        try:
            if os.path.exists(self._sentinel_path):
                os.remove(self._sentinel_path)
        except OSError as e:
            logger.warning(f"[GUARD] Sentinelle non retirée : {e}")
        logger.info(f"[GUARD] Désarmé — {self._n_checks} vérifications effectuées.")
