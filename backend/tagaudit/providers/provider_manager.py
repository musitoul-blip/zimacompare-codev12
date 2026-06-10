"""
providers/provider_manager.py - ZimaTAG Provider Manager
Orchestration des providers d'extraction

Corrections appliquées :
  [18] Factorisation : _init_result utilise désormais le helper commun
       providers._file_info.build_file_info() pour éviter la duplication
       avec engine.smart_extractor.SmartExtractor._init_result. Source de
       vérité unique pour les champs statiques de fichier (filepath,
       filename, extension, directory, parent_folder, size_mb,
       modified_date).
       
       Comportement strictement identique à l'ancienne implémentation :
       mêmes clés, mêmes types de valeur, même format de date.
"""
from pathlib import Path
from typing import Dict, Optional
from providers.base_provider import BaseProvider
from providers.provider_custom import CustomProvider
from providers.provider_mp3_native import MP3NativeProvider
from providers.provider_mutagen import MutagenProvider
from providers.strategy_manager import StrategyManager
from providers._file_info import build_file_info
from core import logger


class ProviderManager:
    """Gestionnaire central des providers"""
    
    def __init__(self, strategy_file: Optional[Path] = None):
        self.strategy_manager = StrategyManager(strategy_file)
        self._providers: Dict[str, BaseProvider] = {}
        self._init_providers()
    
    def _init_providers(self):
        """Initialise tous les providers disponibles"""
        self._providers = {
            'custom': CustomProvider(),
            'mp3_native': MP3NativeProvider(),
            'mutagen': MutagenProvider()
        }
        logger.info(f"Providers initialisés: {list(self._providers.keys())}")
    
    def get_provider(self, name: str) -> Optional[BaseProvider]:
        """Récupère un provider par nom"""
        return self._providers.get(name)
    
    def extract(self, filepath: Path) -> Dict[str, str]:
        """Extrait les métadonnées avec stratégies optimales"""
        ext = filepath.suffix.lower()
        result = self._init_result(filepath)
        
        # Cache des résultats par provider
        provider_cache: Dict[str, Dict[str, str]] = {}
        
        # Récupère toutes les stratégies pour ce format
        strategies = self.strategy_manager.get_all_strategies(ext)
        
        for strat in strategies:
            provider = self._providers.get(strat.provider)
            if not provider:
                continue
            
            # Extraction avec cache
            if strat.provider not in provider_cache:
                try:
                    provider_cache[strat.provider] = provider.extract_tags(filepath)
                except Exception as e:
                    logger.debug(f"Erreur provider {strat.provider}: {e}")
                    provider_cache[strat.provider] = {}
            
            # Applique le tag si disponible
            prov_result = provider_cache.get(strat.provider, {})
            tag_value = prov_result.get(strat.tag_common, '')
            
            if tag_value and strat.tag_common not in result:
                result[strat.tag_common] = tag_value
        
        # Complète avec données du provider custom (fallback)
        if 'custom' in provider_cache:
            for key, val in provider_cache['custom'].items():
                if key not in result or not result[key]:
                    result[key] = val
        
        return result
    
    def _init_result(self, filepath: Path) -> Dict[str, str]:
        """Initialise le résultat avec infos fichier.
        
        [18] Délègue à providers._file_info.build_file_info() pour les
        champs statiques. Le champ 'error' (vide par défaut) est ajouté
        ici car il appartient à la sémantique d'extraction et non à
        l'inspection fichier.
        """
        result = build_file_info(filepath)
        result['error'] = ''
        return result
    
    def extract_single_tag(self, filepath: Path, tag: str) -> str:
        """Extrait un seul tag avec la stratégie optimale"""
        ext = filepath.suffix.lower()
        strat = self.strategy_manager.get_strategy(tag, ext)
        
        if not strat:
            return ''
        
        provider = self._providers.get(strat.provider)
        if not provider:
            return ''
        
        try:
            result = provider.extract_tags(filepath)
            return result.get(tag, '')
        except Exception:
            return ''
