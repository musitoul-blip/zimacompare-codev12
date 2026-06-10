"""
core/config.py - ZimaTAG Configuration
Paramètres centralisés de l'application

Corrections appliquées :
  [20] (partie persistance) : `to_dict()` inclut désormais
       `BATCH_SIZE`. Auparavant, `load_settings()` savait recharger
       cette clé depuis settings.json, mais `to_dict()` ne l'écrivait
       PAS, donc save() ne persistait jamais BATCH_SIZE. Cette
       asymétrie rendait toute modification de la sidebar UI éphémère
       (effet uniquement pour la session Streamlit en cours).
       
       Aucune autre modification dans ce fichier.
"""
from pathlib import Path
from dataclasses import dataclass, field
from typing import Set, Dict
import json


@dataclass
class ZimaConfig:
    """Configuration centralisée ZimaTAG"""
    
    # Chemins principaux
    APP_DATA: Path = Path("/app_data/tagaudit")
    DATA_DIR: Path = field(default_factory=lambda: Path("/app_data/tagaudit/data"))
    LOGS_DIR: Path = field(default_factory=lambda: Path("/app_data/tagaudit/logs"))
    CONFIG_DIR: Path = field(default_factory=lambda: Path("/app_data/tagaudit/config"))
    
    # Fichiers de données
    MASTER_CSV: str = "master_scan.csv"
    STATE_FILE: str = "scan_state.json"
    LOCK_FILE: str = "scan.lock"
    PRESCAN_FILE: str = "pre_scan_results.json"
    STRATEGY_FILE: str = "table_provider.tsv"
    TABLE_PROVIDER: str = "table_provider.tsv"
    
    # Formats supportés
    AUDIO_EXTENSIONS: Set[str] = field(default_factory=lambda: {'.mp3', '.flac', '.m4a', '.mp4'})
    
    # Performance Zimaboard
    BATCH_SIZE: int = 50
    FLUSH_INTERVAL: float = 2.0
    TARGET_SPEED: int = 80
    MEMORY_LIMIT_MB: int = 2048
    
    # CSV Settings
    CSV_SEPARATOR: str = ";"
    CSV_ENCODING: str = "utf-8"
    
    # Mapping des chemins Linux (natifs ZimaBoard) -> Windows (pour mp3tag, etc.)
    # Les exports destinés à un usage Windows (playlists .m3u, action mp3tag)
    # traduiront les chemins selon ce mapping. Le CSV et l'Excel conservent
    # les chemins Linux natifs.
    #
    # Ordre d'application : le mapping dont la clé est la plus longue est
    # appliqué en premier (match de préfixe le plus spécifique).
    #
    # Exemple de mapping typique (modifiable depuis la sidebar Streamlit) :
    #   /disks/HDD-Storage1/Media  ->  Z:
    #   /disks/HDD-Storage2/Media  ->  U:
    #   /disks/SSD_NAS/Media       ->  T:
    #
    # Si le partage Samba/SMB est monté directement à la racine du disque
    # (sans sous-dossier Media), utiliser :
    #   /disks/HDD-Storage1  ->  Z:
    PATH_MAPPINGS: Dict[str, str] = field(default_factory=lambda: {
        "/disks/HDD-Storage1/Media": "Z:",
        "/disks/HDD-Storage2/Media": "U:",
        "/disks/SSD_NAS/Media":      "T:",
    })
    
    # Seuils d'audit
    MIN_BITRATE_MP3: int = 192
    MIN_COVER_SIZE: int = 300
    MAX_COVER_SIZE: int = 1500
    
    def __post_init__(self):
        """Crée les répertoires nécessaires et recharge les settings persistés."""
        for d in [self.DATA_DIR, self.LOGS_DIR, self.CONFIG_DIR]:
            d.mkdir(parents=True, exist_ok=True)
        # Recharge les overrides utilisateur s'ils existent
        self.load_settings()
    
    @property
    def master_csv_path(self) -> Path:
        return self.DATA_DIR / self.MASTER_CSV
    
    @property
    def state_path(self) -> Path:
        return self.DATA_DIR / self.STATE_FILE
    
    @property
    def lock_path(self) -> Path:
        return self.DATA_DIR / self.LOCK_FILE
    
    @property
    def prescan_path(self) -> Path:
        return self.DATA_DIR / self.PRESCAN_FILE
    
    @property
    def strategy_path(self) -> Path:
        return self.CONFIG_DIR / self.STRATEGY_FILE
    
    def to_windows_path(self, linux_path: str) -> str:
        """Convertit un chemin Linux natif en chemin Windows via PATH_MAPPINGS.
        
        - Applique le mapping dont le prefixe est le plus long (plus spécifique).
        - Convertit les slashes `/` en backslashes `\\`.
        - Si aucun mapping ne matche, retourne le chemin original (avec juste
          le backslash comme séparateur, ce qui reste cohérent côté Windows).
        
        Exemples (avec les mappings par défaut) :
            /disks/HDD-Storage1/Media/GoogleMusic/album/track.flac
                -> Z:\\GoogleMusic\\album\\track.flac
            /disks/HDD-Storage2/Media/a/b.mp3
                -> U:\\a\\b.mp3
            /disks/SSD_NAS/Media/x.m4a
                -> T:\\x.m4a
            /inconnu/file.mp3
                -> \\inconnu\\file.mp3   (pas de mapping, séparateurs seuls)
        """
        if not linux_path:
            return linux_path
        p = str(linux_path)
        # Matches par ordre décroissant de longueur de clé (plus spécifique d'abord)
        for src in sorted(self.PATH_MAPPINGS.keys(), key=len, reverse=True):
            if p.startswith(src):
                dst = self.PATH_MAPPINGS[src].rstrip('\\').rstrip('/')
                # Le reste du chemin après le prefixe (commence forcément par '/')
                tail = p[len(src):]
                # Conversion des séparateurs
                tail = tail.replace('/', '\\')
                return dst + tail
        # Aucun mapping : juste convertir les séparateurs
        return p.replace('/', '\\')
    
    def to_dict(self) -> Dict:
        """Sérialise les settings configurables vers un dict.
        
        [20] BATCH_SIZE est désormais inclus pour permettre la persistance
        depuis la sidebar Streamlit. Les chemins APP_DATA/DATA_DIR/etc.
        ne sont pas inclus car ils sont fixés au démarrage et ne sont pas
        modifiables par l'utilisateur.
        """
        return {
            'app_data': str(self.APP_DATA),
            'batch_size': self.BATCH_SIZE,
            'target_speed': self.TARGET_SPEED,
            'audio_extensions': list(self.AUDIO_EXTENSIONS),
            'path_mappings': dict(self.PATH_MAPPINGS),
        }
    
    def save(self):
        config_file = self.CONFIG_DIR / "settings.json"
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(self.to_dict(), f, indent=2)
    
    def load_settings(self):
        """Recharge les settings persistés depuis settings.json.
        
        Seuls les paramètres configurables par l'utilisateur sont rechargés.
        Les chemins APP_DATA/DATA_DIR restent fixes (calculés au démarrage).
        À appeler en fin de __post_init__ si besoin de persistance.
        """
        config_file = self.CONFIG_DIR / "settings.json"
        if not config_file.exists():
            return
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            # Rechargement des paramètres sûrs
            if 'batch_size' in data and isinstance(data['batch_size'], int):
                self.BATCH_SIZE = data['batch_size']
            if 'target_speed' in data and isinstance(data['target_speed'], int):
                self.TARGET_SPEED = data['target_speed']
            if 'path_mappings' in data and isinstance(data['path_mappings'], dict):
                # Validation basique : clés et valeurs doivent être des strings
                mappings = {
                    str(k): str(v) for k, v in data['path_mappings'].items()
                    if isinstance(k, str) and isinstance(v, str)
                }
                if mappings:
                    self.PATH_MAPPINGS = mappings
        except Exception:
            # settings.json corrompu : on garde les valeurs par défaut
            pass


# Instance globale
config = ZimaConfig()
