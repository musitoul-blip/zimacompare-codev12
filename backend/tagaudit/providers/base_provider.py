"""
providers/base_provider.py - ZimaTAG Base Provider
Classe de base pour tous les providers d'extraction
"""
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, Set, Optional

class BaseProvider(ABC):
    """Classe de base pour les providers d'extraction de tags"""
    
    def __init__(self, name: str):
        self.name = name
        self.supported_formats: Set[str] = set()
    
    @abstractmethod
    def extract_tags(self, filepath: Path) -> Dict[str, str]:
        """Extrait les tags d'un fichier audio"""
        pass
    
    def supports(self, extension: str) -> bool:
        """Vérifie si le provider supporte ce format"""
        return extension.lower() in self.supported_formats
    
    def clean_value(self, value) -> str:
        """Nettoie une valeur de tag"""
        if value is None:
            return ''
        s = str(value).strip()
        s = ''.join(c for c in s if c.isprintable() or c in '\n\r\t')
        return s.strip()
    
    def format_duration(self, seconds: float) -> str:
        """Formate la durée en MM:SS"""
        if not seconds or seconds <= 0:
            return ''
        m, s = divmod(int(seconds), 60)
        return f"{m}:{s:02d}"
