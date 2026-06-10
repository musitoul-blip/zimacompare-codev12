"""
providers/_file_info.py - Helpers internes des providers.

[18] Factorisation des champs fichier communs aux différents
initialiseurs de résultat (ProviderManager._init_result et
SmartExtractor._init_result avaient le même bloc dupliqué).

Ce module est volontairement minimaliste : il extrait uniquement les
champs strictement statiques du fichier (chemin, nom, extension, taille,
date de modification). Les champs sémantiques propres au schéma CSV
(title, artist, album, etc., pré-initialisés à '') restent gérés par
SmartExtractor qui est le seul à connaître le schéma complet.
"""
from datetime import datetime
from pathlib import Path
from typing import Dict, Any


def build_file_info(filepath: Path) -> Dict[str, Any]:
    """Retourne le dict des métadonnées statiques d'un fichier.
    
    Champs fournis :
      - filepath        : chemin absolu (str)
      - filename        : nom du fichier
      - extension       : extension sans le point, en minuscules ('mp3')
      - directory       : chemin du parent (str)
      - parent_folder   : nom du dossier parent
      - size_mb         : taille en mégaoctets (float, 2 décimales)
      - modified_date   : datetime de modification au format 'YYYY-MM-DD HH:MM:SS'
    
    Note : ce helper N'AJOUTE PAS la clé 'error', les appelants la
    rajoutent eux-mêmes selon leur logique (chaîne vide pour
    SmartExtractor, idem ProviderManager).
    """
    stat = filepath.stat()
    return {
        'filepath':       str(filepath),
        'filename':       filepath.name,
        'extension':      filepath.suffix.lower().replace('.', ''),
        'directory':      str(filepath.parent),
        'parent_folder':  filepath.parent.name,
        'size_mb':        round(stat.st_size / (1024 * 1024), 2),
        'modified_date':  datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
    }
