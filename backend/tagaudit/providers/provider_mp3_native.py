"""
providers/provider_mp3_native.py - ZimaTAG MP3 Native Provider
Provider natif optimisé pour MP3 avec support ID3 complet

Corrections appliquées :
  [25] Refactoring : MP3NativeProvider hérite désormais de CustomProvider
       au lieu de réimplémenter quasi à l'identique son extract_tags. La
       duplication faisait risquer une divergence silencieuse entre les
       deux providers (par exemple si quelqu'un ajoutait un mapping de
       tag dans CustomProvider sans le porter dans MP3NativeProvider).
       
       Spécificités préservées de MP3NativeProvider :
         1. supported_formats restreint à {'.mp3'} : ce provider ne doit
            pas être utilisé pour FLAC ou M4A (sinon la stratégie qui le
            sélectionne pour un .flac aboutirait au mauvais comportement).
         2. _parsers restreint à {'.mp3': MP3Parser} : idem.
         3. Tag ID3v2.4 'TDRC' (Date Recording) mappé vers 'year', en
            plus du 'YEAR' standard ID3v2.3 hérité de CustomProvider.
            C'était la seule différence sémantique réelle entre les deux
            providers : l'extraction du year sur les MP3 taggués ID3v2.4.
         4. name="mp3_native" préservé (utilisé par le dispatcher de
            ProviderManager via le champ Provider du fichier de stratégies).
       
       Petites convergences (non-régressions) :
         - 'bitdepth' est désormais ajouté à result si présent dans
           audio_info. En pratique MP3Parser ne renseigne jamais ce champ,
           donc l'effet est nul, mais c'est cohérent avec CustomProvider.
         - Le test de présence du tag est désormais 'truthy' (non vide),
           comme dans CustomProvider. La version précédente acceptait des
           valeurs vides ; aucun parser ne produit ce cas en pratique.
"""
from typing import Dict
from providers.provider_custom import CustomProvider


class MP3NativeProvider(CustomProvider):
    """Provider natif MP3 avec support ID3v2 complet.
    
    Hérite de CustomProvider pour réutiliser intégralement la logique
    d'extraction (parsing, mapping, audio_info, codec, cover). Restreint
    le scope au seul format .mp3 et ajoute le mapping ID3v2.4 'TDRC'.
    """
    
    def __init__(self):
        # Initialise complètement l'état parent (name, supported_formats,
        # _parsers tous formats), puis on restreint.
        super().__init__()
        self.name = "mp3_native"
        # Restriction au seul .mp3 : les autres formats ne doivent pas
        # tomber sur ce provider (cf. table_provider.tsv).
        self.supported_formats = {'.mp3'}
        # Filtre le dispatcher de parsers — pas besoin de réimporter
        # MP3Parser, on garde simplement l'entrée mp3 du parent.
        self._parsers = {ext: cls for ext, cls in self._parsers.items()
                         if ext == '.mp3'}
    
    def _map_tags(self, tags: Dict, ext: str) -> Dict[str, str]:
        """Étend le mapping parent en ajoutant le support ID3v2.4 TDRC.
        
        TDRC (Recording Time) est le tag d'année dans ID3v2.4, qui a
        remplacé TYER/YEAR de ID3v2.3. Sans ce mapping, les MP3 taggués
        en ID3v2.4 perdraient leur année.
        
        Sémantique : si le parent a déjà extrait un 'year' (depuis 'YEAR'),
        TDRC l'écrase si TDRC est non-vide. Cela reproduit le comportement
        de l'ancien MP3NativeProvider, où TDRC apparaissait après YEAR
        dans le dict d'itération.
        """
        result = super()._map_tags(tags, ext)
        if ext == '.mp3' and tags.get('TDRC'):
            result['year'] = self.clean_value(tags['TDRC'])
        return result
