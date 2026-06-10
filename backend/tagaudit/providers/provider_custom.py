"""
providers/provider_custom.py - ZimaTAG Custom Provider
Provider utilisant les parsers natifs ZimaTAG
"""
from pathlib import Path
from typing import Dict
from providers.base_provider import BaseProvider
from parsers import MP3Parser, FLACParser, M4AParser

class CustomProvider(BaseProvider):
    """Provider utilisant les parsers natifs ZimaTAG"""
    
    # Mapping clés provider -> clés standard
    KEY_MAPPING = {
        'Title': 'title', 'Artist': 'artist', 'Album': 'album',
        'Album Artist': 'albumartist', 'Composer': 'composer',
        'Year': 'year', 'Genre': 'genre', 'Track': 'track',
        'Total Tracks on Disc': 'tracktotal', 'Disc': 'disc',
        'Total Discs': 'disctotal', 'Encoder': 'encoder',
        'Duration (s)': 'duration_seconds', 'Bitrate (kbps)': 'bitrate',
        'Samplerate (Hz)': 'samplerate', 'Channels': 'channels',
        'Codec': 'codec'
    }
    
    def __init__(self):
        super().__init__("custom")
        self.supported_formats = {'.mp3', '.flac', '.m4a', '.mp4'}
        self._parsers = {
            '.mp3': MP3Parser,
            '.flac': FLACParser,
            '.m4a': M4AParser,
            '.mp4': M4AParser
        }
    
    def extract_tags(self, filepath: Path) -> Dict[str, str]:
        """Extrait tags avec parsers natifs"""
        result = {}
        ext = filepath.suffix.lower()
        
        parser_cls = self._parsers.get(ext)
        if not parser_cls:
            return result
        
        try:
            parser = parser_cls(filepath)
            parsed = parser.parse()
            
            # Tags
            tags = parsed.get('tags', {})
            result.update(self._map_tags(tags, ext))
            
            # Audio info
            audio = parsed.get('audio_info', {})
            if 'duration_seconds' in audio:
                result['duration_seconds'] = round(audio['duration_seconds'], 2)
                result['duration'] = self.format_duration(audio['duration_seconds'])
            if 'bitrate' in audio:
                result['bitrate'] = str(audio['bitrate'])
            if 'samplerate' in audio:
                result['samplerate'] = str(audio['samplerate'])
            if 'channels' in audio:
                result['channels'] = str(audio['channels'])
            if 'bitdepth' in audio:
                result['bitdepth'] = str(audio['bitdepth'])
            if 'id3_version' in audio:
                result['id3_version'] = audio['id3_version']
            
            # Codec
            result['codec'] = self._detect_codec(ext)
            
            # Cover info
            cover = parsed.get('cover_data')
            if cover:
                result['has_cover'] = 'Yes'
                result['cover_size'] = len(cover)
            
        except Exception:
            pass
        
        return result
    
    def _map_tags(self, tags: Dict, ext: str) -> Dict[str, str]:
        """Mappe les tags vers format standard"""
        result = {}
        
        # Mapping selon format
        if ext == '.mp3':
            mapping = {
                'TIT2': 'title', 'TPE1': 'artist', 'TALB': 'album',
                'TPE2': 'albumartist', 'TCOM': 'composer', 'TCON': 'genre',
                'YEAR': 'year', 'TRCK': 'track', 'TRCK_TOTAL': 'tracktotal',
                'TPOS': 'disc', 'TPOS_TOTAL': 'disctotal', 'TSSE': 'encoder'
            }
        elif ext == '.flac':
            mapping = {
                'TITLE': 'title', 'ARTIST': 'artist', 'ALBUM': 'album',
                'ALBUMARTIST': 'albumartist', 'COMPOSER': 'composer',
                'GENRE': 'genre', 'DATE': 'year', 'TRACKNUMBER': 'track',
                'TRACKTOTAL': 'tracktotal', 'TOTALTRACKS': 'tracktotal',
                'DISCNUMBER': 'disc', 'DISCTOTAL': 'disctotal',
                'TOTALDISCS': 'disctotal', 'ENCODER': 'encoder'
            }
        else:  # m4a
            mapping = {
                'TITLE': 'title', 'ARTIST': 'artist', 'ALBUM': 'album',
                'ALBUMARTIST': 'albumartist', 'COMPOSER': 'composer',
                'GENRE': 'genre', 'DATE': 'year', 'TRACKNUMBER': 'track',
                'TOTALTRACKS': 'tracktotal', 'DISCNUMBER': 'disc',
                'TOTALDISCS': 'disctotal', 'ENCODER': 'encoder'
            }
        
        for src, dst in mapping.items():
            if src in tags and tags[src]:
                result[dst] = self.clean_value(tags[src])
        
        return result
    
    def _detect_codec(self, ext: str) -> str:
        """Détecte le codec"""
        return {'.mp3': 'MP3', '.flac': 'FLAC', '.m4a': 'AAC', '.mp4': 'AAC'}.get(ext, '')
